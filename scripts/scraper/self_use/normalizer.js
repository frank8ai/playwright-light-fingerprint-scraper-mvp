const { randomUUID } = require('crypto');
const { normalizeDomain } = require('./utils');

function safeString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function normalizeConfidence(value, fallback = 0.5) {
  const n = Number(value);
  if (Number.isFinite(n)) {
    return Math.max(0, Math.min(1, n));
  }
  return fallback;
}

function normalizeItem(item = {}, fallbackConfidence = 0.5) {
  const url = safeString(item.url);
  return {
    title: safeString(item.title),
    url,
    snippet: safeString(item.snippet),
    source: safeString(item.source) || normalizeDomain(url),
    capturedAt: safeString(item.capturedAt) || new Date().toISOString(),
    confidence: normalizeConfidence(item.confidence, fallbackConfidence),
  };
}

function buildSuccessResult(options = {}) {
  const requestId = options.requestId || randomUUID();
  const normalizedItems = (options.results || []).map((item) => normalizeItem(item, options.defaultConfidence || 0.6));
  const status = options.partial === true ? 'partial' : 'success';

  return {
    requestId,
    status,
    backendUsed: options.backendUsed || '',
    fallbackCount: Number(options.fallbackCount || 0),
    query: safeString(options.query),
    fromCache: options.fromCache === true,
    results: normalizedItems,
    metrics: {
      latencyMs: Number(options.latencyMs || 0),
      attempts: Number(options.attempts || 1),
    },
    error: {
      code: safeString(options.error && options.error.code),
      message: safeString(options.error && options.error.message),
      type: safeString(options.error && options.error.type) || 'unknown',
    },
  };
}

function buildFailedResult(options = {}) {
  const requestId = options.requestId || randomUUID();
  const error = options.error || { code: '', message: 'Task failed', type: 'unknown' };

  return {
    requestId,
    status: 'failed',
    backendUsed: options.backendUsed || '',
    fallbackCount: Number(options.fallbackCount || 0),
    query: safeString(options.query),
    fromCache: false,
    results: [],
    metrics: {
      latencyMs: Number(options.latencyMs || 0),
      attempts: Number(options.attempts || 0),
    },
    error: {
      code: safeString(error.code),
      message: safeString(error.message),
      type: safeString(error.type) || 'unknown',
    },
  };
}

function toCachePayload(normalizedResult) {
  return {
    status: normalizedResult.status,
    backendUsed: normalizedResult.backendUsed,
    fallbackCount: normalizedResult.fallbackCount,
    query: normalizedResult.query,
    results: normalizedResult.results,
    error: normalizedResult.error,
    cachedAt: new Date().toISOString(),
  };
}

function fromCachePayload(cachePayload, requestId, latencyMs) {
  if (!cachePayload) {
    return null;
  }

  return {
    requestId,
    status: cachePayload.status || 'success',
    backendUsed: cachePayload.backendUsed || '',
    fallbackCount: Number(cachePayload.fallbackCount || 0),
    query: cachePayload.query || '',
    fromCache: true,
    results: Array.isArray(cachePayload.results) ? cachePayload.results.map((item) => normalizeItem(item, 0.6)) : [],
    metrics: {
      latencyMs: Number(latencyMs || 0),
      attempts: 0,
    },
    error: {
      code: cachePayload.error && cachePayload.error.code ? String(cachePayload.error.code) : '',
      message: cachePayload.error && cachePayload.error.message ? String(cachePayload.error.message) : '',
      type: cachePayload.error && cachePayload.error.type ? String(cachePayload.error.type) : 'unknown',
    },
  };
}

module.exports = {
  buildSuccessResult,
  buildFailedResult,
  toCachePayload,
  fromCachePayload,
  normalizeItem,
};
