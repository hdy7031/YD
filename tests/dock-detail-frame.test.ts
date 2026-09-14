// Dock 详情画布几何（0.3 收口）：详情与状态牌共用同一个 floating 窗口。
//
// 这一组测试锁住的是"打开 / 收起详情时 Dock 不会漂"这条不变量：
//   * 牌面在屏幕上的矩形，在 collapsed 画布与 detail 画布里必须完全一致；
//   * 详情卡永远完整落在当前显示器工作区内，并且不与牌面重叠；
//   * 画布只在"与默认画布共享的那条边"之外生长（另一侧由卡片撑开）。
//
// 真实窗口行为（topmost / 拖动 / hover 生命周期）由 Electron 验收脚本覆盖，
// 那些只在真实窗口 + 真实指针下才有意义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companionDock, dockDetailFrame, dockSurfaceMetrics, type CompanionSize } from '../src/companion-layout.ts';

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const SIZES: CompanionSize[] = ['small', 'medium', 'large'];
const PAD = companionDock.shadowCanvas / 2;

/**
 * 状态牌在屏幕上的矩形。dock 给的是**牌面**相对窗口共享边的偏移
 * （渲染层据此把命中区 = 牌面 + 4px 阴影画布贴到同一条边上）。
 */
function plateOnScreen(bounds: { x: number; y: number; width: number; height: number }, plate: { width: number; height: number }, dock: { left?: number; top?: number; right?: number; bottom?: number }) {
  const x = dock.left !== undefined ? bounds.x + dock.left : bounds.x + bounds.width - (dock.right ?? 0) - plate.width;
  const y = dock.top !== undefined ? bounds.y + dock.top : bounds.y + bounds.height - (dock.bottom ?? 0) - plate.height;
  return { x, y, width: plate.width, height: plate.height };
}

/** 窗口 = 牌面 + 阴影画布；牌面宽度按测量结果（这里取最小宽度的两倍，模拟长内容）。 */
const canvasOf = (size: CompanionSize, people: number, measure?: { collapsed: number; hover: number }) => {
  const metrics = dockSurfaceMetrics(size, people, measure);
  return { width: metrics.canvasWidth, height: metrics.canvasHeight, plate: { width: metrics.defaultWidth, height: metrics.defaultHeight } };
};
/** 长内容：一屏典型的"今天下午有课"量级，宽度明显大于最小宽度。 */
const WIDE = { collapsed: 260, hover: 300 };

// Dock 可能停在屏幕的任何位置：右下角（默认）、左下、左上、右上、屏幕中间、副屏。
const POSITIONS: [string, { x: number; y: number }][] = [
  ['右下角', { x: 1600, y: 940 }],
  ['左下角', { x: 0, y: 940 }],
  ['左上角', { x: 0, y: 0 }],
  ['右上角', { x: 1600, y: 0 }],
  ['屏幕中间', { x: 820, y: 480 }],
  ['靠左中段', { x: 40, y: 300 }],
  ['靠下中段', { x: 800, y: 980 }],
];

test('详情画布：打开详情不改变牌面在屏幕上的位置', () => {
  for (const people of [1, 2]) {
    for (const size of SIZES) {
      const canvas = canvasOf(size, people, WIDE);
      for (const [label, position] of POSITIONS) {
        const bounds = { ...position, width: canvas.width, height: canvas.height };
        // 默认画布：牌面贴在窗口右 / 下 4px 处（renderer CSS 的实际情况）。
        const before = plateOnScreen(bounds, canvas.plate, { right: PAD, bottom: PAD });
        const frame = dockDetailFrame({ people, plate: canvas.plate, bounds, area: AREA });
        const after = plateOnScreen(frame.window, canvas.plate, frame.dock);
        assert.deepEqual(after, before, `${label} · ${size} · ${people} 人`);
      }
    }
  }
});

test('详情画布：卡片完整落在工作区内，不与牌面重叠', () => {
  for (const people of [1, 2]) {
    for (const size of SIZES) {
      const canvas = canvasOf(size, people, WIDE);
      for (const [label, position] of POSITIONS) {
        const bounds = { ...position, width: canvas.width, height: canvas.height };
        const frame = dockDetailFrame({ people, plate: canvas.plate, bounds, area: AREA });
        const panel = frame.panel;
        const id = `${label} · ${size} · ${people} 人`;
        assert.ok(panel.left >= -1 && panel.top >= -1, `${id} 卡片左上角仍在窗口内`);
        assert.ok(frame.window.x + panel.left >= AREA.x - 1 && frame.window.y + panel.top >= AREA.y - 1, `${id} 卡片左上角落在工作区`);
        assert.ok(frame.window.x + panel.left + panel.width <= AREA.x + AREA.width + 1, `${id} 卡片右边不出屏`);
        assert.ok(frame.window.y + panel.top + panel.height <= AREA.y + AREA.height + 1, `${id} 卡片下边不出屏`);
        const plate = plateOnScreen(frame.window, canvas.plate, frame.dock);
        const overlaps = plate.x < frame.window.x + panel.left + panel.width && frame.window.x + panel.left < plate.x + plate.width
          && plate.y < frame.window.y + panel.top + panel.height && frame.window.y + panel.top < plate.y + plate.height;
        assert.equal(overlaps, false, `${id} 卡片压住牌面`);
      }
    }
  }
});

test('详情画布：卡片在 Dock 上方时窗口向上生长（右下角不动）', () => {
  const size: CompanionSize = 'medium', people = 2;
  const canvas = canvasOf(size, people, WIDE);
  const bounds = { x: 1600, y: 940, width: canvas.width, height: canvas.height };
  const frame = dockDetailFrame({ people, plate: canvas.plate, bounds, area: AREA });
  assert.equal(frame.placement, 'above');
  // 右下角与默认画布完全一致：牌面贴在窗口右下角 4px 处。
  assert.equal(frame.window.x + frame.window.width, bounds.x + bounds.width);
  assert.equal(frame.window.y + frame.window.height, bounds.y + bounds.height);
  assert.equal(frame.dock.right, PAD);
  assert.equal(frame.dock.bottom, PAD);
  // 画布宽度 = 卡片 + 两侧阴影画布。
  assert.equal(frame.window.width, frame.panel.width + PAD * 2);
});

test('详情画布：贴屏幕顶部时卡片向下展开，牌面贴窗口上边', () => {
  const size: CompanionSize = 'medium', people = 2;
  const canvas = canvasOf(size, people, WIDE);
  const bounds = { x: 1600, y: 0, width: canvas.width, height: canvas.height };
  const frame = dockDetailFrame({ people, plate: canvas.plate, bounds, area: AREA });
  assert.equal(frame.placement, 'below');
  // 上边与默认画布一致：牌面仍从上边 14px 处开始。
  assert.equal(frame.window.y, bounds.y);
  assert.equal(frame.dock.top, bounds.height - PAD - canvas.plate.height);
  assert.equal(frame.window.x + frame.window.width, bounds.x + bounds.width);
});

test('详情画布：靠屏幕左边的 Dock 让卡片向右展开', () => {
  const size: CompanionSize = 'medium', people = 2;
  const canvas = canvasOf(size, people, WIDE);
  const bounds = { x: 0, y: 600, width: canvas.width, height: canvas.height };
  const frame = dockDetailFrame({ people, plate: canvas.plate, bounds, area: AREA });
  // 窗口左边 = 默认画布左边，牌面仍然贴在这条边上。
  assert.equal(frame.window.x, bounds.x);
  assert.equal(frame.dock.left, bounds.width - PAD - canvas.plate.width);
  assert.ok(frame.panel.left + frame.window.x >= AREA.x);
  // 卡片必须整个在工作区里（向右展开也不会出屏）。
  assert.ok(frame.panel.left + frame.window.x + frame.panel.width <= AREA.x + AREA.width);
});

test('详情画布：Solo 卡片比 Together 更窄，且不是砍掉半边', () => {
  const size: CompanionSize = 'medium';
  const solo = dockDetailFrame({ people: 1, plate: canvasOf(size, 1, WIDE).plate, bounds: { x: 1600, y: 940, ...canvasOf(size, 1, WIDE) }, area: AREA });
  const together = dockDetailFrame({ people: 2, plate: canvasOf(size, 2, WIDE).plate, bounds: { x: 1600, y: 940, ...canvasOf(size, 2, WIDE) }, area: AREA });
  assert.ok(solo.panel.width < together.panel.width, 'Solo 卡片更窄');
  assert.ok(solo.panel.width >= 300 && solo.panel.width <= 340, `Solo 卡片宽度 ${solo.panel.width}`);
  assert.ok(together.panel.width >= 440 && together.panel.width <= 480, `Together 卡片宽度 ${together.panel.width}`);
});
