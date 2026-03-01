const { randomUUID } = require('crypto');
const { loadSelfUseConfig } = require('./config');
const { normalizeError } = require('./errors');
const { buildSuccessResult, buildFailedResult, toCachePayload, fromCachePayload } = require('./normalizer');
const { SelfUseCache } = require('./cache');
const { MetricsLogger } = require('./metrics');
const { HealthRouter } = require('./health_router');
const { sleep, randomJitter } = require('./utils');
const { BackendAAdapter } = require('./adapters/backend_a');
const { BackendBAdapter } = require('./adapters/backend_b');
const { BackendCAdapter } = require('./adapters/backend_c');

class SelfUseOrchestrator {
  constructor(options = {}) {
    this.config = options.config || loadSelfUseConfig(options.configPath);

    this.metrics = options.metrics || new MetricsLogger({
      logDir: this.config.paths.metricsDir,
    });

    this.cache = options.cache || new SelfUseCache({
      enabled: this.config.cache.enabled,
      queryTtlSec: this.config.cache.queryTtlSec,
      urlTtlSec: this.config.cache.urlTtlSec,
      cacheDir: this.config.paths.cacheDir,
    });

    this.router = options.router || new HealthRouter({
      order: this.config.routing.order,
      failThreshold: this.config.routing.circuitBreaker.failThreshold,
      cooldownSec: this.config.routing.circuitBreaker.cooldownSec,
      halfOpenSuccessThreshold: this.config.routing.circuitBreaker.halfOpenSuccessThreshold,
      statePath: `${this.config.paths.runtimeDir}/health-router-state.json`,
      metrics: this.metrics,
    });

    this.adapters = options.adapters || {
      A: new BackendAAdapter(),
      B: new BackendBAdapter(),
      C: new BackendCAdapter(),
    };
  }

  _resolveTaskType(input = {}) {
    if (input.taskType) {
      return String(input.taskType);
    }
    if (input.url && !input.query) {
      return 'url_snapshot';
    }
    return 'query_search';
  }

  _resolveQueryLabel(input = {}) {
    return String(input.query || input.url || '').trim();
  }

  _pickCache(input = {}) {
    if (!this.config.cache.enabled) {
      return null;
    }
    if (input.query) {
      return {
        get: () => this.cache.getQuery(input),
        set: (payload) => this.cache.setQuery(input, payload),
      };
    }
    if (input.url) {
      return {
        get: () => this.cache.getUrl(input),
        set: (payload) => this.cache.setUrl(input, payload),
      };
    }
    return null;
  }

  async run(input = {}) {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const taskType = this._resolveTaskType(input);
    const query = this._resolveQueryLabel(input);
    const maxAttempts = Number(this.config.routing.maxAttempts || 3);
    const backoffMs = Array.isArray(this.config.routing.backoffMs) ? this.config.routing.backoffMs : [1000, 2000, 4000];

    const cacheAccess = this._pickCache({ ...input, taskType });
    if (cacheAccess) {
      const cachedPayload = cacheAccess.get();
      if (cachedPayload) {
        const cachedResult = fromCachePayload(cachedPayload, requestId, Date.now() - startedAt);
        this.metrics.logRequest({
          requestId,
          taskType,
          backendUsed: cachedResult.backendUsed,
          status: cachedResult.status,
          fromCache: true,
          fallbackCount: cachedResult.fallbackCount,
          latencyMs: cachedResult.metrics.latencyMs,
          attempts: 0,
          resultCount: cachedResult.results.length,
          errorType: cachedResult.error.type,
        });
        return cachedResult;
      }
    }

    const attemptedBackends = [];
    let lastError = null;
    let lastBackend = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const availableBackends = this.router.getRoutableBackends(this.config.routing.order);
      const backend = availableBackends.find((item) => !attemptedBackends.includes(item)) || availableBackends[0];

      if (!backend || !this.adapters[backend]) {
        break;
      }

      this.router.markAttempt(backend);
      const adapter = this.adapters[backend];
      const attemptStart = Date.now();
      lastBackend = backend;

      try {
        const rawResult = await adapter.run(input, {
          requestId,
          attempt,
          taskType,
          config: this.config,
          debug: input.debug || {},
        });

        const backendRouteIndex = this.config.routing.order.indexOf(backend);
        const fallbackCount = backendRouteIndex >= 0
          ? backendRouteIndex
          : Math.max(0, attemptedBackends.length);
        const result = buildSuccessResult({
          requestId,
          backendUsed: backend,
          fallbackCount,
          query: rawResult.query || query,
          fromCache: false,
          results: rawResult.items,
          partial: rawResult.partial === true,
          latencyMs: Date.now() - startedAt,
          attempts: attempt,
          error: { code: '', message: '', type: 'unknown' },
        });

        this.router.recordSuccess(backend, {
          latencyMs: Date.now() - attemptStart,
        });

        this.metrics.logAttempt({
          requestId,
          taskType,
          backend,
          attempt,
          latencyMs: Date.now() - attemptStart,
          resultCount: result.results.length,
          errorType: '',
          status: result.status,
        });

        this.metrics.logRequest({
          requestId,
          taskType,
          backendUsed: backend,
          status: result.status,
          fromCache: false,
          fallbackCount,
          latencyMs: result.metrics.latencyMs,
          attempts: result.metrics.attempts,
          resultCount: result.results.length,
          errorType: '',
        });

        if (cacheAccess) {
          cacheAccess.set(toCachePayload(result));
        }

        return result;
      } catch (error) {
        const normalizedError = normalizeError(error);
        lastError = normalizedError;
        attemptedBackends.push(backend);

        this.router.recordFailure(backend, normalizedError.type);

        this.metrics.logAttempt({
          requestId,
          taskType,
          backend,
          attempt,
          latencyMs: Date.now() - attemptStart,
          resultCount: 0,
          errorType: normalizedError.type,
          status: 'failed',
        });

        if (attempt < maxAttempts) {
          const backoff = Number(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] || 1000);
          const jitter = randomJitter(this.config.rateLimit.jitterMs);
          await sleep(backoff + jitter);
        }
      }
    }

    const failedResult = buildFailedResult({
      requestId,
      backendUsed: lastBackend,
      fallbackCount: this.config.routing.order.indexOf(lastBackend) >= 0
        ? this.config.routing.order.indexOf(lastBackend)
        : Math.max(0, attemptedBackends.length - 1),
      query,
      attempts: attemptedBackends.length,
      latencyMs: Date.now() - startedAt,
      error: lastError || { code: '', message: 'All backends failed', type: 'unknown' },
    });

    this.metrics.logRequest({
      requestId,
      taskType,
      backendUsed: failedResult.backendUsed,
      status: failedResult.status,
      fromCache: false,
      fallbackCount: failedResult.fallbackCount,
      latencyMs: failedResult.metrics.latencyMs,
      attempts: failedResult.metrics.attempts,
      resultCount: 0,
      errorType: failedResult.error.type,
    });

    return failedResult;
  }

  healthSnapshot() {
    return this.router.snapshot();
  }
}

module.exports = {
  SelfUseOrchestrator,
};
