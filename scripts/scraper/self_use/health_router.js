const path = require('path');
const { BACKENDS } = require('./contracts');
const { ensureDir, loadJson, saveJson } = require('./utils');

function defaultBackendState() {
  return {
    score: 100,
    consecutiveFailures: 0,
    circuitState: 'closed',
    openedAt: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastErrorType: '',
    halfOpenTrialInFlight: false,
    halfOpenSuccessCount: 0,
  };
}

function createBackendStateMap() {
  return {
    A: defaultBackendState(),
    B: defaultBackendState(),
    C: defaultBackendState(),
  };
}

class HealthRouter {
  constructor(options = {}) {
    this.failThreshold = Number(options.failThreshold || 3);
    this.cooldownSec = Number(options.cooldownSec || 600);
    this.halfOpenSuccessThreshold = Number(options.halfOpenSuccessThreshold || 1);
    this.order = Array.isArray(options.order) ? options.order : ['A', 'B', 'C'];
    this.statePath = path.resolve(options.statePath || 'data/runtime/health-router-state.json');
    this.metrics = options.metrics || null;

    ensureDir(path.dirname(this.statePath));
    const loaded = loadJson(this.statePath, null);
    this.state = loaded || {
      updatedAt: new Date().toISOString(),
      backends: createBackendStateMap(),
      scopes: {},
    };

    if (!this.state.backends || typeof this.state.backends !== 'object') {
      this.state.backends = createBackendStateMap();
    }
    if (!this.state.scopes || typeof this.state.scopes !== 'object') {
      this.state.scopes = {};
    }

    this._ensureBackendMap(this.state.backends);
    Object.keys(this.state.scopes).forEach((scopeKey) => {
      this._ensureBackendMap(this.state.scopes[scopeKey]);
    });

    this.save();
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    saveJson(this.statePath, this.state);
  }

  _ensureBackendMap(backendMap) {
    BACKENDS.forEach((backend) => {
      if (!backendMap[backend]) {
        backendMap[backend] = defaultBackendState();
      }
    });
  }

  _scopeKey(meta = {}) {
    const raw = String(meta.scope || 'global').trim().toLowerCase();
    if (!raw) {
      return 'global';
    }
    return raw.replace(/[^a-z0-9._:-]/g, '_').slice(0, 120);
  }

  _getScopeState(meta = {}) {
    const scopeKey = this._scopeKey(meta);
    if (scopeKey === 'global') {
      this._ensureBackendMap(this.state.backends);
      return {
        scopeKey,
        backends: this.state.backends,
      };
    }

    if (!this.state.scopes[scopeKey]) {
      this.state.scopes[scopeKey] = createBackendStateMap();
    }
    this._ensureBackendMap(this.state.scopes[scopeKey]);

    return {
      scopeKey,
      backends: this.state.scopes[scopeKey],
    };
  }

  _refreshCircuit(backend, meta = {}) {
    const { scopeKey, backends } = this._getScopeState(meta);
    const state = backends[backend] || defaultBackendState();
    if (state.circuitState !== 'open' || !state.openedAt) {
      return;
    }

    const openedTs = new Date(state.openedAt).getTime();
    if (Number.isNaN(openedTs)) {
      return;
    }

    const cooldownMs = this.cooldownSec * 1000;
    if (Date.now() - openedTs >= cooldownMs) {
      state.circuitState = 'half_open';
      state.halfOpenTrialInFlight = false;
      state.halfOpenSuccessCount = 0;
      this.save();
      if (this.metrics) {
        this.metrics.logEvent({
          eventType: 'circuit_half_open',
          backend,
          scope: scopeKey,
          score: state.score,
        });
      }
    }
  }

  getRoutableBackends(customOrder, meta = {}) {
    const { backends } = this._getScopeState(meta);
    const order = Array.isArray(customOrder) && customOrder.length > 0 ? customOrder : this.order;
    const routable = [];

    order.forEach((backend) => {
      if (!BACKENDS.includes(backend)) {
        return;
      }

      this._refreshCircuit(backend, meta);
      const state = backends[backend];
      if (state.circuitState === 'open') {
        return;
      }

      if (state.circuitState === 'half_open' && state.halfOpenTrialInFlight) {
        return;
      }

      routable.push(backend);
    });

    return routable;
  }

  markAttempt(backend, meta = {}) {
    const { backends } = this._getScopeState(meta);
    const state = backends[backend];
    if (!state) {
      return;
    }

    if (state.circuitState === 'half_open') {
      state.halfOpenTrialInFlight = true;
      this.save();
    }
  }

  recordSuccess(backend, meta = {}) {
    const { scopeKey, backends } = this._getScopeState(meta);
    const state = backends[backend];
    if (!state) {
      return;
    }

    state.score = Math.min(100, Number(state.score || 100) + 5);
    state.consecutiveFailures = 0;
    state.lastSuccessAt = new Date().toISOString();
    state.lastErrorType = '';

    if (state.circuitState === 'half_open') {
      state.halfOpenSuccessCount += 1;
      state.halfOpenTrialInFlight = false;
      if (state.halfOpenSuccessCount >= this.halfOpenSuccessThreshold) {
        state.circuitState = 'closed';
        state.openedAt = null;
        state.halfOpenSuccessCount = 0;
      }
    } else {
      state.circuitState = 'closed';
      state.openedAt = null;
      state.halfOpenSuccessCount = 0;
      state.halfOpenTrialInFlight = false;
    }

    this.save();

    if (this.metrics) {
      this.metrics.logEvent({
        eventType: 'backend_success',
        backend,
        scope: scopeKey,
        score: state.score,
        latencyMs: Number(meta.latencyMs || 0),
      });
    }
  }

  recordFailure(backend, errorType = 'unknown', meta = {}) {
    const { scopeKey, backends } = this._getScopeState(meta);
    const state = backends[backend];
    if (!state) {
      return;
    }

    const penalties = {
      timeout: 25,
      blocked: 30,
      captcha: 35,
      dom_changed: 15,
      network: 20,
      unknown: 10,
    };

    state.score = Math.max(0, Number(state.score || 100) - Number(penalties[errorType] || penalties.unknown));
    state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
    state.lastFailureAt = new Date().toISOString();
    state.lastErrorType = errorType;

    if (state.circuitState === 'half_open') {
      state.circuitState = 'open';
      state.openedAt = new Date().toISOString();
      state.halfOpenTrialInFlight = false;
      state.halfOpenSuccessCount = 0;
    } else if (state.consecutiveFailures >= this.failThreshold) {
      state.circuitState = 'open';
      state.openedAt = new Date().toISOString();
      state.halfOpenTrialInFlight = false;
      state.halfOpenSuccessCount = 0;
    }

    this.save();

    if (this.metrics) {
      this.metrics.logEvent({
        eventType: state.circuitState === 'open' ? 'circuit_open' : 'backend_failure',
        backend,
        scope: scopeKey,
        score: state.score,
        errorType,
        consecutiveFailures: state.consecutiveFailures,
      });
    }
  }

  snapshot(options = {}) {
    const scopeKey = this._scopeKey(options);
    BACKENDS.forEach((backend) => this._refreshCircuit(backend, { scope: scopeKey }));

    const { backends } = this._getScopeState({ scope: scopeKey });
    const scopes = {};

    Object.keys(this.state.scopes).forEach((key) => {
      BACKENDS.forEach((backend) => this._refreshCircuit(backend, { scope: key }));
      scopes[key] = {
        backends: this.state.scopes[key],
        routable: this.getRoutableBackends(this.order, { scope: key }),
      };
    });

    return {
      updatedAt: this.state.updatedAt,
      order: this.order,
      scope: scopeKey,
      circuitBreaker: {
        failThreshold: this.failThreshold,
        cooldownSec: this.cooldownSec,
        halfOpenSuccessThreshold: this.halfOpenSuccessThreshold,
      },
      backends,
      routable: this.getRoutableBackends(this.order, { scope: scopeKey }),
      scopes,
    };
  }
}

module.exports = {
  HealthRouter,
};
