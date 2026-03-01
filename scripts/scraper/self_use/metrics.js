const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils');

function appendJsonl(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

class MetricsLogger {
  constructor(options = {}) {
    const logDir = options.logDir || path.resolve('logs');
    ensureDir(logDir);
    this.attemptLogPath = options.attemptLogPath || path.join(logDir, 'self-use-attempts.jsonl');
    this.requestLogPath = options.requestLogPath || path.join(logDir, 'self-use-requests.jsonl');
    this.eventLogPath = options.eventLogPath || path.join(logDir, 'self-use-events.jsonl');
  }

  logAttempt(payload = {}) {
    appendJsonl(this.attemptLogPath, {
      ts: new Date().toISOString(),
      ...payload,
    });
  }

  logRequest(payload = {}) {
    appendJsonl(this.requestLogPath, {
      ts: new Date().toISOString(),
      ...payload,
    });
  }

  logEvent(payload = {}) {
    appendJsonl(this.eventLogPath, {
      ts: new Date().toISOString(),
      ...payload,
    });
  }
}

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
  const data = [];
  for (const line of lines) {
    try {
      data.push(JSON.parse(line));
    } catch {
      // ignore broken lines to keep report robust
    }
  }
  return data;
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function withinHours(ts, hours) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return Date.now() - date.getTime() <= Number(hours || 24) * 3600 * 1000;
}

function build24hReport(options = {}) {
  const hours = Number(options.hours || 24);
  const requestLogPath = options.requestLogPath || path.resolve('logs/self-use-requests.jsonl');
  const eventLogPath = options.eventLogPath || path.resolve('logs/self-use-events.jsonl');

  const requests = parseJsonl(requestLogPath).filter((item) => withinHours(item.ts, hours));
  const events = parseJsonl(eventLogPath).filter((item) => withinHours(item.ts, hours));

  const total = requests.length;
  const success = requests.filter((item) => item.status === 'success' || item.status === 'partial').length;
  const degraded = requests.filter((item) => Number(item.fallbackCount || 0) > 0).length;
  const cacheHits = requests.filter((item) => item.fromCache === true).length;
  const outputAwareRequests = requests.filter((item) => item.outputMode === 'compact' || item.outputMode === 'full');
  const artifactAwareRequests = requests.filter((item) => Object.prototype.hasOwnProperty.call(item, 'hasArtifact'));
  const compactCount = requests.filter((item) => item.outputMode === 'compact').length;
  const artifactCount = requests.filter((item) => item.hasArtifact === true).length;
  const latencies = requests
    .map((item) => Number(item.latencyMs || 0))
    .filter((item) => Number.isFinite(item) && item >= 0);

  const errorTypeCounts = {};
  requests
    .filter((item) => item.errorType)
    .forEach((item) => {
      const key = String(item.errorType || 'unknown');
      errorTypeCounts[key] = Number(errorTypeCounts[key] || 0) + 1;
    });

  const circuitOpenCount = events.filter((item) => item.eventType === 'circuit_open').length;

  return {
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    totalRequests: total,
    successRate: total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0,
    fallbackRate: total > 0 ? Number(((degraded / total) * 100).toFixed(2)) : 0,
    cacheHitRate: total > 0 ? Number(((cacheHits / total) * 100).toFixed(2)) : 0,
    compactModeRate: outputAwareRequests.length > 0 ? Number(((compactCount / outputAwareRequests.length) * 100).toFixed(2)) : 0,
    artifactPointerRate: artifactAwareRequests.length > 0 ? Number(((artifactCount / artifactAwareRequests.length) * 100).toFixed(2)) : 0,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      avg: latencies.length > 0 ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : 0,
    },
    circuitOpenCount,
    errorTypeCounts,
  };
}

module.exports = {
  MetricsLogger,
  build24hReport,
  parseJsonl,
  percentile,
};
