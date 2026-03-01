const fs = require('fs');
const path = require('path');
const { loadJson, normalizeDomain } = require('../utils');

function resolveSiteConfig(siteKey = 'site_a') {
  const sitePath = path.resolve(`config/sites/${siteKey}.json`);
  const siteConfig = loadJson(sitePath);
  if (!siteConfig) {
    const error = new Error(`Missing site config: ${sitePath}`);
    error.code = 'SITE_CONFIG_MISSING';
    throw error;
  }
  return siteConfig;
}

function resolveStartUrl(input = {}, siteConfig = {}) {
  if (input.url) {
    return String(input.url).trim();
  }

  if (input.query && siteConfig.search_url_template) {
    return String(siteConfig.search_url_template).replace('{query}', encodeURIComponent(String(input.query)));
  }

  if (Array.isArray(siteConfig.start_urls) && siteConfig.start_urls[0]) {
    return String(siteConfig.start_urls[0]);
  }

  const error = new Error('No start URL available for backend A/B');
  error.code = 'NO_START_URL';
  throw error;
}

function readRecordsFromRunOnce(runResult) {
  if (!runResult || !runResult.raw_path || !fs.existsSync(runResult.raw_path)) {
    return [];
  }

  const payload = loadJson(runResult.raw_path, {});
  if (!payload || !Array.isArray(payload.records)) {
    return [];
  }

  return payload.records;
}

function mapRecordToNormalizedItem(record = {}, fallbackConfidence = 0.7) {
  const url = String(record.link || '').trim();
  const body = String(record.body || '').trim();
  return {
    title: String(record.title || '').trim(),
    url,
    snippet: String(record.evidence_snippet || body.slice(0, 280)).trim(),
    source: normalizeDomain(url),
    capturedAt: String(record.fetched_at || new Date().toISOString()),
    confidence: fallbackConfidence,
  };
}

module.exports = {
  resolveSiteConfig,
  resolveStartUrl,
  readRecordsFromRunOnce,
  mapRecordToNormalizedItem,
};
