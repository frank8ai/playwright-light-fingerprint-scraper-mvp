const { runOnce } = require('../../run_once');
const { withTimeout } = require('../utils');
const {
  resolveSiteConfig,
  resolveStartUrl,
  readRecordsFromRunOnce,
  mapRecordToNormalizedItem,
} = require('./common');

class BackendBAdapter {
  constructor(options = {}) {
    this.id = 'B';
    this.defaultSite = options.defaultSite || 'site_a';
  }

  buildStableSiteConfig(sourceConfig, contextConfig = {}) {
    const stable = JSON.parse(JSON.stringify(sourceConfig || {}));
    const timeouts = contextConfig.timeouts || {};
    const rateLimit = contextConfig.rateLimit || {};

    stable.navigation = stable.navigation || {};
    stable.navigation.wait_until = 'load';
    stable.navigation.timeout_ms = Number(timeouts.pageLoadMs || stable.navigation.timeout_ms || 20000);

    stable.wait_rules = stable.wait_rules || {};
    stable.wait_rules.timeout_ms = Number(timeouts.actionMs || stable.wait_rules.timeout_ms || 8000);

    stable.pacing = stable.pacing || {};
    stable.pacing.min_ms = Number(rateLimit.minIntervalMs || stable.pacing.min_ms || 1200);
    stable.pacing.max_ms = Number((rateLimit.minIntervalMs || 1200) + (rateLimit.jitterMs || 500));

    return stable;
  }

  async run(input = {}, context = {}) {
    const siteKey = input.site || this.defaultSite;
    const siteConfig = resolveSiteConfig(siteKey);
    const stableSiteConfig = this.buildStableSiteConfig(siteConfig, context.config || {});
    const startUrl = resolveStartUrl(input, stableSiteConfig);

    const runPromise = runOnce({
      siteKey,
      siteConfig: stableSiteConfig,
      startUrl,
      enableFingerprint: false,
      useStealth: false,
      headless: true,
    });

    const runResult = await withTimeout(
      runPromise,
      context.config && context.config.timeouts ? context.config.timeouts.totalMs : 35000,
      'Backend B timeout'
    );

    const records = readRecordsFromRunOnce(runResult);
    const items = records.map((record) => mapRecordToNormalizedItem(record, 0.7));

    if (items.length === 0) {
      const error = new Error('No results from Backend B');
      error.code = 'NO_RESULTS_B';
      throw error;
    }

    return {
      backend: this.id,
      partial: false,
      query: input.query || input.url || startUrl,
      items,
      raw: {
        runResult,
      },
    };
  }
}

module.exports = {
  BackendBAdapter,
};
