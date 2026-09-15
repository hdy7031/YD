// 本地渲染页加载入口（src/renderer-load.ts）的契约。
//
// 背景：六个窗口（主界面 / Dock / 气泡 / 详情 / 提示 / 菜单）都加载同一个 dist/index.html，
// 过去只要任意一个窗口的本地加载失败，`app.whenReady()` 的整条启动链就会抛错 →
// “YD 无法启动”。这里锁定新的最小契约：一次性失败会重试，重试成功则照常启动；
// 持续失败仍然抛出（不静默吞掉），停滞的加载按超时处理而不是永久挂起。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocalPage, type LocalPageTarget } from '../src/renderer-load.ts';
import { configureLogging } from '../src/logging.ts';

// 这些用例刻意制造加载失败：日志本身由 logging 契约覆盖，这里不重复打到测试输出。
configureLogging({ mirrorConsole: false });

const FILE = 'C:\\Users\\someone\\Desktop\\事物agent\\dist\\index.html';

/** 假的加载目标：按脚本依次给出成功 / 失败 / 停滞。 */
function target(script: ('ok' | string | 'stall')[]) {
  const calls: { hash?: string }[] = [];
  const loadFile = (_file: string, options?: { hash?: string }) => {
    const step = script[Math.min(calls.length, script.length - 1)];
    calls.push({ hash: options?.hash });
    if (step === 'ok') return Promise.resolve();
    if (step === 'stall') return new Promise<void>(() => {});
    return Promise.reject(new Error(step));
  };
  return { target: { loadFile } as LocalPageTarget, calls };
}

test('加载成功：只尝试一次，hash 原样传给 loadFile', async () => {
  const { target: page, calls } = target(['ok']);
  await loadLocalPage(page, FILE, 'mini');
  assert.deepEqual(calls, [{ hash: 'mini' }]);
});

test('不带 hash 时调用 loadFile(file) 而不是传空 options', async () => {
  const seen: (undefined | { hash?: string })[] = [];
  const page: LocalPageTarget = { loadFile: (_file, options) => { seen.push(options); return Promise.resolve(); } };
  await loadLocalPage(page, FILE);
  assert.deepEqual(seen, [undefined]);
});

test('一次性失败会重试并最终成功（不再拖垮整个启动）', async () => {
  const { target: page, calls } = target(['ERR_FAILED (-2) loading', 'ok']);
  await loadLocalPage(page, FILE, 'mini', { attemptTimeoutMs: 100 });
  assert.equal(calls.length, 2);
});

test('持续失败：尝试次数用满后抛出最后一次错误，不静默吞掉', async () => {
  const { target: page, calls } = target(['第一次失败', '第二次失败', '第三次失败']);
  await assert.rejects(
    () => loadLocalPage(page, FILE, 'mini', { attempts: 3, attemptTimeoutMs: 100 }),
    /第三次失败/,
  );
  assert.equal(calls.length, 3);
});

test('停滞的加载按超时处理：不会永久挂起启动链', async () => {
  const { target: page, calls } = target(['stall']);
  await assert.rejects(
    () => loadLocalPage(page, FILE, 'menu', { attempts: 2, attemptTimeoutMs: 30 }),
    /超时/,
  );
  assert.equal(calls.length, 2, '超时后仍然重试了一次');
});

test('窗口已销毁时立即放弃，不做无意义重试', async () => {
  const { target: base, calls } = target(['窗口已销毁']);
  const page: LocalPageTarget = { ...base, isDestroyed: () => true };
  await assert.rejects(() => loadLocalPage(page, FILE, 'tip', { attempts: 3, attemptTimeoutMs: 100 }), /窗口已销毁/);
  assert.equal(calls.length, 1);
});
