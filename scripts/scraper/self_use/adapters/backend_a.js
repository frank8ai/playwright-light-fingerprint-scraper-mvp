const { runOnce } = require('../../run_once');
const { withTimeout } = require('../utils');
const {
  resolveSiteConfig,
  resolveStartUrl,
  readRecordsFromRunOnce,
  mapRecordToNormalizedItem,
} = require('./common');

class BackendAAdapter {
  constructor(options = {}) {
    this.id = 'A';
    this.defaultSite = options.defaultSite || 'site_a';
  }

  async run(input = {}, context = {}) {
    if (context.debug && context.debug.forceBackendAFail) {
      const error = new Error('Backend A forced failure for regression test');
      error.code = 'FORCED_A_FAIL';
      throw error;
    }

    const siteKey = input.site || this.defaultSite;
    const siteConfig = resolveSiteConfig(siteKey);
    const startUrl = resolveStartUrl(input, siteConfig);

    const runPromise = runOnce({
      siteKey,
      siteConfig,
      startUrl,
      enableFingerprint: true,
      useStealth: false,
      headless: true,
      maxAttempts: 1,
    });

    const runResult = await withTimeout(
      runPromise,
      context.config && context.config.timeouts ? context.config.timeouts.totalMs : 35000,
      'Backend A timeout'
    );

    const records = readRecordsFromRunOnce(runResult);
    const items = records.map((record) => mapRecordToNormalizedItem(record, 0.85));

    if (items.length === 0) {
      const error = new Error('No results from Backend A');
      error.code = 'NO_RESULTS_A';
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
  BackendAAdapter,
};
