const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function normalize(value) {
  return path.resolve(value).replace(/^\\\\\?\\/, '').toLowerCase();
}

function configureIsolatedUserData(label, directory) {
  const safeLabel = String(label || 'audit').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const userData = directory
    ? path.resolve(directory)
    : fs.mkdtempSync(path.join(os.tmpdir(), `yd-${safeLabel}-`));
  fs.mkdirSync(userData, { recursive: true });

  const production = process.env.APPDATA
    ? path.join(process.env.APPDATA, '事务助手')
    : '';
  if (production && normalize(userData) === normalize(production)) {
    throw new Error('Verifier refused to use the production YD userData directory');
  }

  const sessionData = path.join(userData, 'session');
  fs.mkdirSync(sessionData, { recursive: true });
  process.env.DAYHUB_TEST_DATA = userData;
  app.setPath('userData', userData);
  app.setPath('sessionData', sessionData);
  return userData;
}

// 合成工作区 fixture（Phase 5A）：生产 fresh install 只有一个人，因此需要双人的门禁
// 必须自己把 fixture 种进隔离 userData，而不是依赖生产默认值。
const WORKSPACE_FIXTURES = {
  // 双人门禁用"最小双人工作区"：业务集合全空，各门禁自己 import / 创建业务数据。
  together: 'v3-together-baseline.sqlite',
  solo: 'v3-solo-synthetic.sqlite',
};

/**
 * 把仓库里的合成 fixture 复制成该隔离 userData 的 dayhub.sqlite。
 * 目标已存在数据库时直接报错，避免悄悄覆盖别的种子数据。
 */
function seedWorkspace(userData, kind) {
  const file = WORKSPACE_FIXTURES[kind];
  if (!file) throw new Error(`未知的合成工作区类型：${kind}`);
  const source = path.join(__dirname, '..', 'tests', 'fixtures', file);
  if (!fs.existsSync(source)) throw new Error(`缺少合成 fixture：${source}`);
  const target = path.join(userData, 'dayhub.sqlite');
  if (fs.existsSync(target)) throw new Error(`userData 里已经有数据库，拒绝覆盖：${target}`);
  fs.copyFileSync(source, target);
  return target;
}

module.exports = { configureIsolatedUserData, seedWorkspace };
