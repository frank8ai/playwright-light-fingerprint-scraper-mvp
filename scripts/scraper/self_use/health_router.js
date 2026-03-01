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
      backends: {
        A: defaultBackendState(),
        B: defaultBackendState(),
        C: defaultBackendState(),
      },
    };

    BACKENDS.forEach((backend) => {
      if (!this.state.backends[backend]) {
        this.state.backends[backend] = defaultBackendState();
      }
    });

    this.save();
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    saveJson(this.statePath, this.state);
  }

  _refreshCircuit(backend) {
    const state = this.state.backends[backend] || defaultBackendState();
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
          score: state.score,
        });
      }
    }
  }

  getRoutableBackends(customOrder) {
    const order = Array.isArray(customOrder) && customOrder.length > 0 ? customOrder : this.order;
    const routable = [];

    order.forEach((backend) => {
      if (!BACKENDS.includes(backend)) {
        return;
      }

      this._refreshCircuit(backend);
      const state = this.state.backends[backend];
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

  markAttempt(backend) {
    const state = this.state.backends[backend];
    if (!state) {
      return;
    }

    if (state.circuitState === 'half_open') {
      state.halfOpenTrialInFlight = true;
      this.save();
    }
  }

  recordSuccess(backend, meta = {}) {
    const state = this.state.backends[backend];
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
        score: state.score,
        latencyMs: Number(meta.latencyMs || 0),
      });
    }
  }

  recordFailure(backend, errorType = 'unknown') {
    const state = this.state.backends[backend];
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
        score: state.score,
        errorType,
        consecutiveFailures: state.consecutiveFailures,
      });
    }
  }

  snapshot() {
    BACKENDS.forEach((backend) => this._refreshCircuit(backend));

    return {
      updatedAt: this.state.updatedAt,
      order: this.order,
      circuitBreaker: {
        failThreshold: this.failThreshold,
        cooldownSec: this.cooldownSec,
        halfOpenSuccessThreshold: this.halfOpenSuccessThreshold,
      },
      backends: this.state.backends,
      routable: this.getRoutableBackends(this.order),
    };
  }
}

module.exports = {
  HealthRouter,
};
