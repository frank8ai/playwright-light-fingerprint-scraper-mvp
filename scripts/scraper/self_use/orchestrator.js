const { randomUUID, createHash } = require('crypto');
const path = require('path');
const { loadSelfUseConfig } = require('./config');
const { normalizeError } = require('./errors');
const { buildSuccessResult, buildFailedResult, toCachePayload, fromCachePayload } = require('./normalizer');
const { SelfUseCache } = require('./cache');
const { MetricsLogger } = require('./metrics');
const { HealthRouter } = require('./health_router');
const { sleep, randomJitter, normalizeDomain, loadJson, saveJson, ensureDir } = require('./utils');
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

  _resolveRouteScope(input = {}) {
    if (input.scope) {
      return String(input.scope).trim().toLowerCase();
    }

    const fromUrl = normalizeDomain(String(input.url || '').trim());
    if (fromUrl) {
      return fromUrl;
    }

    if (input.site) {
      const sitePath = path.resolve(`config/sites/${input.site}.json`);
      const siteConfig = loadJson(sitePath, null);
      const firstStartUrl = siteConfig && Array.isArray(siteConfig.start_urls)
        ? siteConfig.start_urls[0]
        : '';
      const fromSite = normalizeDomain(String(firstStartUrl || '').trim());
      if (fromSite) {
        return fromSite;
      }
    }

    return 'global';
  }

  _resolveOutputPolicy(input = {}) {
    const outputConfig = this.config.output || {};
    const mode = input.outputMode === 'full' || input.outputMode === 'compact'
      ? input.outputMode
      : outputConfig.mode;

    return {
      mode: mode === 'full' ? 'full' : 'compact',
      topN: Number(input.topN || outputConfig.compactTopN || 3),
      maxSnippetChars: Number(input.maxSnippetChars || outputConfig.maxSnippetChars || 180),
      summaryMaxChars: Number(input.summaryMaxChars || (outputConfig.artifactPointer && outputConfig.artifactPointer.summaryMaxChars) || 280),
      artifactEnabled: input.artifactPointer === false
        ? false
        : Boolean(outputConfig.artifactPointer && outputConfig.artifactPointer.enabled !== false),
      artifactDir: outputConfig.artifactPointer && outputConfig.artifactPointer.dir
        ? outputConfig.artifactPointer.dir
        : path.resolve('data/runtime/artifacts'),
    };
  }

  _isQuestionLikeQuery(query = '') {
    const text = String(query || '').trim().toLowerCase();
    if (!text) {
      return false;
    }

    const markers = (this.config.routing.preRoute && this.config.routing.preRoute.questionMarkers) || [];
    if (!Array.isArray(markers) || markers.length === 0) {
      return false;
    }

    return markers.some((marker) => marker && text.includes(String(marker).toLowerCase()));
  }

  _resolveRoutingOrder(input = {}, taskType = 'query_search', query = '') {
    const defaultOrder = Array.isArray(this.config.routing.order) && this.config.routing.order.length > 0
      ? [...this.config.routing.order]
      : ['A', 'B', 'C'];

    const preRoute = this.config.routing.preRoute || {};
    const allowQuestionFirst = preRoute.enabled !== false && preRoute.questionFirstToC !== false;
    const preferBrowser = input.preferBrowser === true || String(input.preferBrowser || '').toLowerCase() === 'true';

    if (!allowQuestionFirst || preferBrowser || taskType !== 'query_search') {
      return defaultOrder;
    }

    if (!this._isQuestionLikeQuery(query)) {
      return defaultOrder;
    }

    const orderWithoutC = defaultOrder.filter((item) => item !== 'C');
    return ['C', ...orderWithoutC];
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

  _buildCacheVariant(input = {}, outputPolicy = {}, routingOrder = []) {
    const mode = outputPolicy.mode === 'full' ? 'full' : 'compact';
    const topN = Number(outputPolicy.topN || 3);
    const maxSnippetChars = Number(outputPolicy.maxSnippetChars || 180);
    const preferBrowser = input.preferBrowser === true || String(input.preferBrowser || '').toLowerCase() === 'true';
    const routeKey = Array.isArray(routingOrder) && routingOrder.length > 0 ? routingOrder.join('>') : 'A>B>C';
    return `${mode}:${topN}:${maxSnippetChars}:${preferBrowser ? 'browser' : 'auto'}:${routeKey}`;
  }

  _writeArtifact(options = {}) {
    const requestId = options.requestId;
    if (!requestId || !options.enabled) {
      return null;
    }

    const artifactDir = path.resolve(options.artifactDir || 'data/runtime/artifacts');
    ensureDir(artifactDir);

    const artifactPath = path.join(artifactDir, `${requestId}.json`);
    const payload = {
      requestId,
      generatedAt: new Date().toISOString(),
      taskType: options.taskType || '',
      query: options.query || '',
      scope: options.scope || 'global',
      backendUsed: options.backendUsed || '',
      fallbackCount: Number(options.fallbackCount || 0),
      status: options.status || 'success',
      resultCountFull: Array.isArray(options.resultsFull) ? options.resultsFull.length : 0,
      resultsFull: options.resultsFull || [],
      backendRaw: options.backendRaw || {},
    };

    const serialized = JSON.stringify(payload);
    const hash = createHash('sha256').update(serialized).digest('hex');
    const finalPayload = {
      ...payload,
      hash,
    };

    saveJson(artifactPath, finalPayload);

    return {
      path: artifactPath,
      hash,
      resultCountFull: payload.resultCountFull,
      sizeBytes: Buffer.byteLength(serialized, 'utf8'),
    };
  }

  async run(input = {}) {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const taskType = this._resolveTaskType(input);
    const query = this._resolveQueryLabel(input);
    const routeScope = this._resolveRouteScope(input);
    const outputPolicy = this._resolveOutputPolicy(input);
    const routingOrder = this._resolveRoutingOrder(input, taskType, query);
    const maxAttempts = Number(this.config.routing.maxAttempts || 3);
    const backoffMs = Array.isArray(this.config.routing.backoffMs) ? this.config.routing.backoffMs : [1000, 2000, 4000];

    const cacheVariant = this._buildCacheVariant(input, outputPolicy, routingOrder);
    const cacheAccess = this._pickCache({ ...input, taskType, cacheVariant });
    if (cacheAccess) {
      const cachedPayload = cacheAccess.get();
      if (cachedPayload) {
        const cachedResult = fromCachePayload(cachedPayload, requestId, Date.now() - startedAt);
        this.metrics.logRequest({
          requestId,
          taskType,
          scope: routeScope,
          routeOrder: routingOrder.join('>'),
          backendUsed: cachedResult.backendUsed,
          status: cachedResult.status,
          fromCache: true,
          fallbackCount: cachedResult.fallbackCount,
          latencyMs: cachedResult.metrics.latencyMs,
          attempts: 0,
          resultCount: cachedResult.results.length,
          errorType: cachedResult.error.type,
          outputMode: cachedResult.outputMode || outputPolicy.mode,
          hasArtifact: Boolean(cachedResult.artifact && cachedResult.artifact.path),
        });
        return cachedResult;
      }
    }

    const attemptedBackends = [];
    let lastError = null;
    let lastBackend = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const availableBackends = this.router.getRoutableBackends(routingOrder, { scope: routeScope });
      const backend = availableBackends.find((item) => !attemptedBackends.includes(item)) || availableBackends[0];

      if (!backend || !this.adapters[backend]) {
        break;
      }

      this.router.markAttempt(backend, { scope: routeScope });
      const adapter = this.adapters[backend];
      const attemptStart = Date.now();
      lastBackend = backend;

      try {
        const adapterInput = {
          ...input,
          limit: input.limit || outputPolicy.topN,
        };

        const rawResult = await adapter.run(adapterInput, {
          requestId,
          attempt,
          taskType,
          config: this.config,
          debug: input.debug || {},
        });

        const backendRouteIndex = routingOrder.indexOf(backend);
        const fallbackCount = backendRouteIndex >= 0
          ? backendRouteIndex
          : Math.max(0, attemptedBackends.length);

        const artifact = this._writeArtifact({
          enabled: outputPolicy.artifactEnabled,
          artifactDir: outputPolicy.artifactDir,
          requestId,
          taskType,
          query: rawResult.query || query,
          scope: routeScope,
          backendUsed: backend,
          fallbackCount,
          status: rawResult.partial === true ? 'partial' : 'success',
          resultsFull: rawResult.items || [],
          backendRaw: rawResult.raw || {},
        });

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
          outputPolicy,
          summaryMaxChars: outputPolicy.summaryMaxChars,
          artifact,
        });

        this.router.recordSuccess(backend, {
          scope: routeScope,
          latencyMs: Date.now() - attemptStart,
        });

        this.metrics.logAttempt({
          requestId,
          taskType,
          scope: routeScope,
          routeOrder: routingOrder.join('>'),
          backend,
          attempt,
          latencyMs: Date.now() - attemptStart,
          resultCount: result.results.length,
          errorType: '',
          status: result.status,
          outputMode: result.outputMode,
        });

        this.metrics.logRequest({
          requestId,
          taskType,
          scope: routeScope,
          routeOrder: routingOrder.join('>'),
          backendUsed: backend,
          status: result.status,
          fromCache: false,
          fallbackCount,
          latencyMs: result.metrics.latencyMs,
          attempts: result.metrics.attempts,
          resultCount: result.results.length,
          errorType: '',
          outputMode: result.outputMode,
          hasArtifact: Boolean(result.artifact && result.artifact.path),
        });

        if (cacheAccess) {
          cacheAccess.set(toCachePayload(result));
        }

        return result;
      } catch (error) {
        const normalizedError = normalizeError(error);
        lastError = normalizedError;
        attemptedBackends.push(backend);

        this.router.recordFailure(backend, normalizedError.type, {
          scope: routeScope,
        });

        this.metrics.logAttempt({
          requestId,
          taskType,
          scope: routeScope,
          routeOrder: routingOrder.join('>'),
          backend,
          attempt,
          latencyMs: Date.now() - attemptStart,
          resultCount: 0,
          errorType: normalizedError.type,
          status: 'failed',
          outputMode: outputPolicy.mode,
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
      fallbackCount: routingOrder.indexOf(lastBackend) >= 0
        ? routingOrder.indexOf(lastBackend)
        : Math.max(0, attemptedBackends.length - 1),
      query,
      attempts: attemptedBackends.length,
      latencyMs: Date.now() - startedAt,
      error: lastError || { code: '', message: 'All backends failed', type: 'unknown' },
      outputMode: outputPolicy.mode,
    });

    this.metrics.logRequest({
      requestId,
      taskType,
      scope: routeScope,
      routeOrder: routingOrder.join('>'),
      backendUsed: failedResult.backendUsed,
      status: failedResult.status,
      fromCache: false,
      fallbackCount: failedResult.fallbackCount,
      latencyMs: failedResult.metrics.latencyMs,
      attempts: failedResult.metrics.attempts,
      resultCount: 0,
      errorType: failedResult.error.type,
      outputMode: failedResult.outputMode,
      hasArtifact: false,
    });

    return failedResult;
  }

  healthSnapshot(options = {}) {
    return this.router.snapshot(options);
  }
}

module.exports = {
  SelfUseOrchestrator,
};
