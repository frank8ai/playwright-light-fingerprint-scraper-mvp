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

function trimToMaxChars(input, maxChars) {
  const text = safeString(input);
  const cap = Number(maxChars || 0);
  if (!cap || cap <= 0 || text.length <= cap) {
    return text;
  }
  if (cap <= 3) {
    return text.slice(0, cap);
  }
  return `${text.slice(0, cap - 3)}...`;
}

function applyOutputPolicy(items = [], outputPolicy = {}) {
  const mode = outputPolicy.mode === 'full' ? 'full' : 'compact';
  const topN = Math.max(1, Number(outputPolicy.topN || 3));
  const maxSnippetChars = Math.max(40, Number(outputPolicy.maxSnippetChars || 180));

  if (mode === 'full') {
    return {
      outputMode: 'full',
      results: items,
    };
  }

  const compacted = items.slice(0, topN).map((item) => ({
    ...item,
    title: trimToMaxChars(item.title, 120),
    snippet: trimToMaxChars(item.snippet, maxSnippetChars),
  }));

  return {
    outputMode: 'compact',
    results: compacted,
  };
}

function buildSummary(items = [], maxChars = 280) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  const text = items
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${safeString(item.title)} | ${safeString(item.source)} | ${safeString(item.snippet)}`)
    .join(' ; ');

  return trimToMaxChars(text, maxChars);
}

function buildSuccessResult(options = {}) {
  const requestId = options.requestId || randomUUID();
  const normalizedItems = (options.results || []).map((item) => normalizeItem(item, options.defaultConfidence || 0.6));
  const status = options.partial === true ? 'partial' : 'success';
  const output = applyOutputPolicy(normalizedItems, options.outputPolicy || {});

  const response = {
    requestId,
    status,
    backendUsed: options.backendUsed || '',
    fallbackCount: Number(options.fallbackCount || 0),
    query: safeString(options.query),
    fromCache: options.fromCache === true,
    results: output.results,
    metrics: {
      latencyMs: Number(options.latencyMs || 0),
      attempts: Number(options.attempts || 1),
    },
    error: {
      code: safeString(options.error && options.error.code),
      message: safeString(options.error && options.error.message),
      type: safeString(options.error && options.error.type) || 'unknown',
    },
    outputMode: output.outputMode,
    summary: buildSummary(output.results, Number(options.summaryMaxChars || 280)),
  };

  if (options.artifact) {
    response.artifact = {
      path: safeString(options.artifact.path),
      hash: safeString(options.artifact.hash),
      resultCountFull: Number(options.artifact.resultCountFull || normalizedItems.length),
      sizeBytes: Number(options.artifact.sizeBytes || 0),
    };
  }

  return response;
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
    outputMode: options.outputMode === 'full' ? 'full' : 'compact',
    summary: '',
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
    outputMode: normalizedResult.outputMode || 'compact',
    summary: normalizedResult.summary || '',
    artifact: normalizedResult.artifact || null,
    cachedAt: new Date().toISOString(),
  };
}

function fromCachePayload(cachePayload, requestId, latencyMs) {
  if (!cachePayload) {
    return null;
  }

  const response = {
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
    outputMode: cachePayload.outputMode === 'full' ? 'full' : 'compact',
    summary: safeString(cachePayload.summary),
  };

  if (cachePayload.artifact) {
    response.artifact = {
      path: safeString(cachePayload.artifact.path),
      hash: safeString(cachePayload.artifact.hash),
      resultCountFull: Number(cachePayload.artifact.resultCountFull || response.results.length),
      sizeBytes: Number(cachePayload.artifact.sizeBytes || 0),
    };
  }

  return response;
}

module.exports = {
  buildSuccessResult,
  buildFailedResult,
  toCachePayload,
  fromCachePayload,
  normalizeItem,
  applyOutputPolicy,
  buildSummary,
};
