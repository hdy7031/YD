// 本地渲染页（dist/index.html）的唯一加载入口。
//
// 为什么需要它：六个窗口（主界面 / 状态 Dock / 气泡 / 详情 / 提示 / 桌宠菜单）都加载
// 同一个本地文件，各自只带不同 hash。Electron 只提供 `loadFile(filePath,{hash})`
// 这一条受支持路径（它内部用 url.format 生成 file URL），因此**不要**手工拼
// `file://${path.join(...)}`：非 ASCII 路径（本仓库就是 `事物agent`）一旦拼错就是
// 无法解析的 URL，而 url.format 的结果在错误信息里同样长成 `file:///C:\...`。
//
// 这里只做一件事，而且是刻意保持最小：把"一次加载"变成"有界重试 + 单次超时"。
// 依据：本地页面加载偶发失败是 OS 层面的一次性失败（杀毒 / 索引 / 磁盘抖动时
// file:// 打开失败会以 `ERR_FAILED (-2)` 的形式被 Electron 报成拒绝），
// 而启动路径过去是"任意一个窗口加载失败 → 整个 YD 无法启动"。
//   * 重试：一次性失败不再把整个应用拖垮；
//   * 超时：把"永远 pending 的加载"（启动静默卡死）变成一次可见的失败；
//   * 日志：每次失败都留下文件证据，下一次出现时有据可查。
// 真正持久的失败（文件缺失 / 权限问题）在重试后仍然抛出，行为与原来一致。
import { logError } from './logging.ts';

export interface LocalPageTarget {
  loadFile(file: string, options?: { hash?: string }): Promise<void>;
  isDestroyed?(): boolean;
}

export interface LocalPageLoadOptions {
  /** 单次尝试的上限（毫秒）。健康的本地加载是几百毫秒级，15 秒只拦真正的停滞。 */
  attemptTimeoutMs?: number;
  /** 总尝试次数（首次 + 重试）。 */
  attempts?: number;
}

const ATTEMPT_TIMEOUT_MS = 15000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 150;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 加载一个本地渲染页；`hash` 决定渲染哪一块界面（'' / orb / bubble / mini / tip / menu）。
 * 失败会重试，重试仍失败则抛出**最后一次**的错误，调用方保持原有的可见失败处理。
 */
export async function loadLocalPage(target: LocalPageTarget, file: string, hash?: string, options: LocalPageLoadOptions = {}): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? ATTEMPTS);
  const timeout = Math.max(0, options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS);
  const describe = `${file}${hash ? '#' + hash : ''}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await attemptLoad(target, file, hash, timeout);
      return;
    } catch (error) {
      lastError = error;
      // 窗口已经被销毁（例如启动过程中用户退出）时不再重试。
      if (target.isDestroyed?.() === true) throw error;
      if (attempt < attempts) {
        logError(error, `本地页面加载失败，准备重试（第 ${attempt}/${attempts} 次）：${describe}`);
        await delay(RETRY_DELAY_MS * attempt);
      } else {
        logError(error, `本地页面加载失败（已重试 ${attempts} 次）：${describe}`);
      }
    }
  }
  throw lastError;
}

async function attemptLoad(target: LocalPageTarget, file: string, hash: string | undefined, timeoutMs: number): Promise<void> {
  const load = hash === undefined ? target.loadFile(file) : target.loadFile(file, { hash });
  if (timeoutMs <= 0) return load;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      load,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`本地页面加载超时（${timeoutMs}ms）：${file}${hash ? '#' + hash : ''}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // 已经宣布超时的那次加载如果稍后失败，不能让它的拒绝变成未处理异常。
    load.catch(() => {});
  }
}
