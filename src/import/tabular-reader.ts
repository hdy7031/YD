import ExcelJS from 'exceljs';
import {
  MAX_TABULAR_COLUMNS,
  MAX_TABULAR_FILE_BYTES,
  MAX_TABULAR_ROWS,
  MAX_TABULAR_SHEETS,
  type NormalizedCell,
  type NormalizedRow,
  type NormalizedSheet,
  type NormalizedTable,
  type TabularCellScalar,
  type TabularFormat,
} from './tabular.ts';

export type TabularReadErrorKind = 'file' | 'encoding' | 'workbook' | 'sheet' | 'resource';

export class TabularReadError extends Error {
  readonly kind: TabularReadErrorKind;

  constructor(kind: TabularReadErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TabularReadError';
    this.kind = kind;
  }
}

function fail(kind: TabularReadErrorKind, message: string, cause?: unknown): never {
  throw new TabularReadError(kind, message, cause === undefined ? undefined : { cause });
}

function emptyCell(): NormalizedCell {
  return { type: 'blank', value: null };
}

function isBlankCell(cell: NormalizedCell): boolean {
  return cell.type === 'blank' && !cell.formula;
}

function trimTrailing<T>(values: T[], blank: (value: T) => boolean): T[] {
  if (!values.length) return [];
  const result = values.slice();
  while (result.length > 1 && blank(result[result.length - 1])) result.pop();
  return result.length ? result : [values[0]];
}

function finishCsvRow(rows: string[][], fields: string[]): void {
  const row = trimTrailing(fields, value => value === '');
  rows.push(row);
  if (rows.length > MAX_TABULAR_ROWS) fail('resource', `CSV 数据行数超过 ${MAX_TABULAR_ROWS} 行上限。`);
}

/** RFC 4180-style comma parser: quoted commas, escaped quotes and newlines are preserved. */
export function parseCSVRecords(input: string): string[][] {
  if (typeof input !== 'string' || input.length === 0) fail('file', 'CSV 文件为空。');
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let atFieldStart = true;

  const pushField = () => {
    row.push(field);
    field = '';
    atFieldStart = true;
    afterQuote = false;
  };
  const pushRow = () => {
    pushField();
    finishCsvRow(rows, row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (afterQuote) {
      if (character === ',') {
        pushField();
      } else if (character === '\r' || character === '\n') {
        pushRow();
        if (character === '\r' && text[index + 1] === '\n') index += 1;
      } else {
        fail('file', 'CSV 引号后的字段格式无效。');
      }
      continue;
    }
    if (character === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (character === ',') {
      pushField();
    } else if (character === '\r' || character === '\n') {
      pushRow();
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      field += character;
      atFieldStart = false;
    }
  }
  if (inQuotes) fail('file', 'CSV 文件包含未闭合的引号。');
  if (field.length > 0 || row.length > 0 || afterQuote) pushRow();
  if (!rows.length) fail('file', 'CSV 文件没有可读取的记录。');
  return rows;
}

function csvCell(value: string): NormalizedCell {
  return value === '' ? emptyCell() : { type: 'string', value };
}

export function readCSVTable(input: string): NormalizedTable {
  const records = parseCSVRecords(input);
  let columnCount = 0;
  const rows: NormalizedRow[] = records.map((record, index) => {
    const cells = record.map(csvCell);
    columnCount = Math.max(columnCount, cells.length);
    if (columnCount > MAX_TABULAR_COLUMNS) fail('resource', `CSV 列数超过 ${MAX_TABULAR_COLUMNS} 列上限。`);
    return { rowNumber: index + 1, cells };
  });
  return {
    format: 'csv',
    sheets: [{ name: 'CSV', hidden: false, rows, rowCount: rows.length, columnCount }],
  };
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, '0');
}

function spreadsheetDate(value: Date, numFmt: unknown): NormalizedCell {
  // ExcelJS represents Excel serial dates as UTC instants. Reading UTC parts
  // keeps both the 1900 and 1904 serial systems deterministic and avoids the
  // host machine's timezone changing a spreadsheet wall-clock value.
  const date = `${value.getUTCFullYear().toString().padStart(4, '0')}-${twoDigits(value.getUTCMonth() + 1)}-${twoDigits(value.getUTCDate())}`;
  const hasTimeFormat = /(?:h+|s+|am\/pm)/i.test(String(numFmt ?? ''));
  const hasTime = hasTimeFormat || value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0 || value.getUTCSeconds() !== 0;
  const time = `${twoDigits(value.getUTCHours())}:${twoDigits(value.getUTCMinutes())}${value.getUTCSeconds() ? `:${twoDigits(value.getUTCSeconds())}` : ''}`;
  return { type: 'date', value: hasTime ? `${date}T${time}` : date };
}

function valueFromFormula(raw: unknown, cell: { result?: unknown }): { value: unknown; formula: boolean; cached: boolean } {
  const object = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
  const formula = !!object && (typeof object.formula === 'string' || typeof object.sharedFormula === 'string');
  if (!formula) return { value: raw, formula: false, cached: false };
  if (Object.prototype.hasOwnProperty.call(object, 'result') && object.result !== undefined) return { value: object.result, formula: true, cached: true };
  if (cell.result !== undefined) return { value: cell.result, formula: true, cached: true };
  return { value: null, formula: true, cached: false };
}

function excelCell(cell: { value: unknown; result?: unknown; type?: unknown; numFmt?: unknown }): NormalizedCell {
  const resolved = valueFromFormula(cell.value, cell);
  const formulaFlags = resolved.formula ? { formula: true, cached: resolved.cached } : {};
  const raw = resolved.value;
  if (raw === undefined || raw === null || raw === '') return { ...emptyCell(), ...formulaFlags };
  if (raw instanceof Date) return { ...spreadsheetDate(raw, cell.numFmt), ...formulaFlags };
  if (typeof raw === 'string') return { type: 'string', value: raw, ...formulaFlags };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { type: 'number', value: raw, ...formulaFlags } : { type: 'error', value: '非有限数字', ...formulaFlags };
  if (typeof raw === 'boolean') return { type: 'boolean', value: raw, ...formulaFlags };
  if (typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    if (typeof object.error === 'string') return { type: 'error', value: object.error, ...formulaFlags };
    if (Array.isArray(object.richText)) {
      const text = object.richText.map(part => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string' ? (part as Record<string, unknown>).text : '').join('');
      return text ? { type: 'string', value: text, ...formulaFlags } : { ...emptyCell(), ...formulaFlags };
    }
    if (typeof object.text === 'string') return { type: 'string', value: object.text, ...formulaFlags };
  }
  return { type: 'error', value: '单元格类型不受支持', ...formulaFlags };
}

async function readXLSXTable(bytes: Uint8Array): Promise<NormalizedTable> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer, {
      // The importer only needs cell values. These nodes are deliberately not
      // projected into the normalized table; ExcelJS does not calculate formulas
      // or follow external links during load.
      ignoreNodes: ['drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'extLst'],
    });
  } catch (error) {
    fail('workbook', '无法读取 XLSX 工作簿，请确认文件未损坏且为普通 .xlsx 文件。', error);
  }
  if (workbook.worksheets.length > MAX_TABULAR_SHEETS) fail('resource', `工作簿超过 ${MAX_TABULAR_SHEETS} 个工作表上限。`);
  const sheets: NormalizedSheet[] = [];
  for (const worksheet of workbook.worksheets) {
    // ExcelJS's actualRowCount is the number of non-empty rows, not the
    // highest source row number. Sparse sheets still need their source row
    // identities preserved so a header followed by a blank row is parsed
    // correctly.
    const rowCount = Math.max(0, worksheet.rowCount || 0);
    // As with actualRowCount, ExcelJS's actualColumnCount is the number of
    // non-empty columns, not the highest source column index. Use the sheet
    // extent so sparse columns keep their A/B/... identity for mapping.
    const columnCount = Math.max(0, worksheet.columnCount || 0);
    if (rowCount > MAX_TABULAR_ROWS) fail('resource', `工作表“${worksheet.name}”行数超过 ${MAX_TABULAR_ROWS} 行上限。`);
    if (columnCount > MAX_TABULAR_COLUMNS) fail('resource', `工作表“${worksheet.name}”列数超过 ${MAX_TABULAR_COLUMNS} 列上限。`);
    const rows: NormalizedRow[] = [];
    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const cells = trimTrailing(
        Array.from({ length: columnCount }, (_, index) => excelCell(worksheet.getCell(rowNumber, index + 1))),
        isBlankCell,
      );
      rows.push({ rowNumber, cells });
      // Keep a blank row before a header, but do not retain arbitrary styled
      // blank rows at the end of a worksheet in the renderer payload.
    }
    while (rows.length && rows[rows.length - 1].cells.every(isBlankCell)) rows.pop();
    const effectiveColumns = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
    sheets.push({
      name: worksheet.name,
      hidden: worksheet.state === 'hidden' || worksheet.state === 'veryHidden',
      rows,
      rowCount: rows.length,
      columnCount: effectiveColumns,
    });
  }
  if (!sheets.some(sheet => !sheet.hidden)) fail('sheet', '工作簿没有可见工作表可供导入。');
  return { format: 'xlsx', sheets };
}

export async function readTabularFile(bytes: Uint8Array, format: TabularFormat): Promise<NormalizedTable> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) fail('file', '表格文件为空或无法读取。');
  if (bytes.length > MAX_TABULAR_FILE_BYTES) fail('resource', `表格文件超过 ${MAX_TABULAR_FILE_BYTES / 1024 / 1024} MB 上限。`);
  if (format === 'csv') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      fail('encoding', '当前文件编码无法识别，请保存为 UTF-8 CSV 后重试。', error);
    }
    return readCSVTable(text);
  }
  if (format === 'xlsx') return readXLSXTable(bytes);
  fail('file', '不支持的表格格式。');
}

export { readXLSXTable };
