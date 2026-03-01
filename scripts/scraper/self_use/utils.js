const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomJitter(maxJitterMs) {
  const max = Number(maxJitterMs || 0);
  if (max <= 0) {
    return 0;
  }
  return Math.floor(Math.random() * (max + 1));
}

function normalizeDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function withTimeout(operation, timeoutMs, message) {
  const timeout = Number(timeoutMs || 0);
  if (!timeout || timeout <= 0) {
    return operation;
  }

  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(message || `Operation timeout after ${timeout}ms`);
          error.code = 'ETIMEDOUT';
          reject(error);
        }, timeout);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return String(value).toLowerCase() === 'true';
}

module.exports = {
  ensureDir,
  loadJson,
  saveJson,
  sleep,
  randomJitter,
  normalizeDomain,
  withTimeout,
  toBoolean,
};
