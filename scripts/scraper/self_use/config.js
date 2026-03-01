const path = require('path');
const { loadJson } = require('./utils');

const DEFAULT_PATH = path.resolve('config/self-use-scraper.json');

function loadSelfUseConfig(configPath = DEFAULT_PATH) {
  const config = loadJson(path.resolve(configPath));
  if (!config) {
    throw new Error(`Missing self-use config: ${configPath}`);
  }

  if (!config.safety || config.safety.allowLoginAutomation !== false) {
    throw new Error('Safety violation: allowLoginAutomation must stay false.');
  }

  const routing = config.routing || {};
  const circuitBreaker = routing.circuitBreaker || {};
  const paths = config.paths || {};

  return {
    routing: {
      order: Array.isArray(routing.order) && routing.order.length > 0 ? routing.order : ['A', 'B', 'C'],
      maxAttempts: Number(routing.maxAttempts || 3),
      backoffMs: Array.isArray(routing.backoffMs) ? routing.backoffMs : [1000, 2000, 4000],
      legacyDirectEnabled: routing.legacyDirectEnabled !== false,
      circuitBreaker: {
        failThreshold: Number(circuitBreaker.failThreshold || 3),
        cooldownSec: Number(circuitBreaker.cooldownSec || 600),
        halfOpenSuccessThreshold: Number(circuitBreaker.halfOpenSuccessThreshold || 1),
      },
    },
    timeouts: {
      pageLoadMs: Number(config.timeouts && config.timeouts.pageLoadMs ? config.timeouts.pageLoadMs : 15000),
      actionMs: Number(config.timeouts && config.timeouts.actionMs ? config.timeouts.actionMs : 8000),
      totalMs: Number(config.timeouts && config.timeouts.totalMs ? config.timeouts.totalMs : 35000),
    },
    cache: {
      enabled: config.cache ? config.cache.enabled !== false : true,
      queryTtlSec: Number(config.cache && config.cache.queryTtlSec ? config.cache.queryTtlSec : 1200),
      urlTtlSec: Number(config.cache && config.cache.urlTtlSec ? config.cache.urlTtlSec : 900),
    },
    rateLimit: {
      minIntervalMs: Number(config.rateLimit && config.rateLimit.minIntervalMs ? config.rateLimit.minIntervalMs : 1200),
      jitterMs: Number(config.rateLimit && config.rateLimit.jitterMs ? config.rateLimit.jitterMs : 500),
    },
    safety: {
      allowLoginAutomation: false,
    },
    paths: {
      runtimeDir: path.resolve(paths.runtimeDir || 'data/runtime'),
      cacheDir: path.resolve(paths.cacheDir || 'data/cache'),
      metricsDir: path.resolve(paths.metricsDir || 'logs'),
    },
    raw: config,
  };
}

module.exports = {
  loadSelfUseConfig,
  DEFAULT_PATH,
};
