const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function createTraceId() {
  return randomUUID();
}

function createTaskId(prefix = 'task') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

class JsonlLogger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.resolve('logs');
    this.scraperLogPath = options.scraperLogPath || path.join(this.logDir, 'scraper.jsonl');
    this.errorLogPath = options.errorLogPath || path.join(this.logDir, 'error.jsonl');
    ensureDir(path.dirname(this.scraperLogPath));
    ensureDir(path.dirname(this.errorLogPath));
  }

  write(event) {
    const payload = {
      ts: nowIso(),
      ...event,
    };
    fs.appendFileSync(this.scraperLogPath, `${JSON.stringify(payload)}\n`, 'utf8');
    if (payload.status === 'failed') {
      fs.appendFileSync(this.errorLogPath, `${JSON.stringify(payload)}\n`, 'utf8');
    }
  }

  info(event) {
    this.write(event);
  }

  error(event) {
    this.write({ ...event, status: event.status || 'failed' });
  }
}

module.exports = {
  JsonlLogger,
  ensureDir,
  createTraceId,
  createTaskId,
};
