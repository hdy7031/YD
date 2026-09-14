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

module.exports = { configureIsolatedUserData };
