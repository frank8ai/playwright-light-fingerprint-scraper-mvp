const path = require('path');
const { ensureDir, loadJson, saveJson } = require('./utils');

class SelfUseCache {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.queryTtlSec = Number(options.queryTtlSec || 1200);
    this.urlTtlSec = Number(options.urlTtlSec || 900);
    this.cacheDir = path.resolve(options.cacheDir || 'data/cache');
    this.cachePath = path.join(this.cacheDir, 'self-use-cache.json');

    ensureDir(this.cacheDir);
    this.state = loadJson(this.cachePath, {
      query: {},
      url: {},
    }) || { query: {}, url: {} };
  }

  _now() {
    return Date.now();
  }

  _getBucket(bucketName) {
    if (!this.state[bucketName]) {
      this.state[bucketName] = {};
    }
    return this.state[bucketName];
  }

  _get(bucketName, key) {
    if (!this.enabled || !key) {
      return null;
    }

    const bucket = this._getBucket(bucketName);
    const item = bucket[key];
    if (!item) {
      return null;
    }

    if (!item.expiresAt || this._now() > item.expiresAt) {
      delete bucket[key];
      this.save();
      return null;
    }

    return JSON.parse(JSON.stringify(item.payload));
  }

  _set(bucketName, key, payload, ttlSec) {
    if (!this.enabled || !key || !payload) {
      return;
    }

    const bucket = this._getBucket(bucketName);
    bucket[key] = {
      expiresAt: this._now() + Number(ttlSec || 0) * 1000,
      payload,
    };
    this.save();
  }

  save() {
    saveJson(this.cachePath, this.state);
  }

  cleanup() {
    const now = this._now();
    ['query', 'url'].forEach((bucketName) => {
      const bucket = this._getBucket(bucketName);
      Object.keys(bucket).forEach((key) => {
        const item = bucket[key];
        if (!item || !item.expiresAt || now > item.expiresAt) {
          delete bucket[key];
        }
      });
    });
    this.save();
  }

  buildQueryKey(input = {}) {
    const query = String(input.query || '').trim();
    const taskType = String(input.taskType || '').trim();
    const site = String(input.site || '').trim();
    const cacheVariant = String(input.cacheVariant || '').trim();
    return `${taskType}::${site}::${query}::${cacheVariant || 'default'}`;
  }

  buildUrlKey(input = {}) {
    const url = String(input.url || '').trim();
    const taskType = String(input.taskType || '').trim();
    const cacheVariant = String(input.cacheVariant || '').trim();
    return `${taskType}::${url}::${cacheVariant || 'default'}`;
  }

  getQuery(input) {
    return this._get('query', this.buildQueryKey(input));
  }

  setQuery(input, payload) {
    this._set('query', this.buildQueryKey(input), payload, this.queryTtlSec);
  }

  getUrl(input) {
    return this._get('url', this.buildUrlKey(input));
  }

  setUrl(input, payload) {
    this._set('url', this.buildUrlKey(input), payload, this.urlTtlSec);
  }
}

module.exports = {
  SelfUseCache,
};
