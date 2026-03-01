class ProxyManager {
  constructor(proxyList = [], options = {}) {
    this.cooldownMs = Number(options.cooldownMs || process.env.PROXY_COOLDOWN_MS || 300000);
    this.proxies = proxyList
      .filter((item) => item && item.enabled !== false)
      .map((proxy) => ({
        ...proxy,
        health_score: Number(proxy.health_score ?? 100),
      }));
  }

  _isCoolingDown(proxy) {
    if (!proxy.cooldown_until) {
      return false;
    }
    const ts = new Date(proxy.cooldown_until).getTime();
    if (Number.isNaN(ts)) {
      return false;
    }
    return Date.now() < ts;
  }

  _activeCandidates() {
    return this.proxies
      .filter((proxy) => !this._isCoolingDown(proxy))
      .sort((a, b) => (b.health_score || 0) - (a.health_score || 0));
  }

  _findById(proxyId) {
    if (!proxyId) {
      return null;
    }
    return this.proxies.find((proxy) => proxy.proxy_id === proxyId) || null;
  }

  selectProxy(accountConfig = {}) {
    const mode = accountConfig.proxy_mode || 'failover';
    const preferred = this._findById(accountConfig.proxy_id);

    if (mode === 'fixed') {
      return preferred;
    }

    if (preferred && !this._isCoolingDown(preferred)) {
      return preferred;
    }

    const [candidate] = this._activeCandidates();
    return candidate || preferred || null;
  }

  markFailure(proxyId) {
    const proxy = this._findById(proxyId);
    if (!proxy) {
      return;
    }
    proxy.health_score = Math.max(0, Number(proxy.health_score || 100) - 20);
    proxy.cooldown_until = new Date(Date.now() + this.cooldownMs).toISOString();
  }

  markSuccess(proxyId) {
    const proxy = this._findById(proxyId);
    if (!proxy) {
      return;
    }
    proxy.health_score = Math.min(100, Number(proxy.health_score || 100) + 5);
    proxy.cooldown_until = null;
  }
}

function toPlaywrightProxy(proxyConfig) {
  if (!proxyConfig || !proxyConfig.server) {
    return undefined;
  }
  return {
    server: proxyConfig.server,
    username: proxyConfig.username || undefined,
    password: proxyConfig.password || undefined,
  };
}

module.exports = {
  ProxyManager,
  toPlaywrightProxy,
};
