const { runOnce } = require('../../run_once');
const path = require('path');
const { withTimeout } = require('../utils');
const {
  resolveSiteConfig,
  resolveStartUrl,
  readRecordsFromRunOnce,
  mapRecordToNormalizedItem,
} = require('./common');
const { loadJson } = require('../utils');

function pickBaseAccount(accountId) {
  const accountsPath = path.resolve('config/accounts.json');
  const accounts = loadJson(accountsPath, []);
  const enabledAccounts = Array.isArray(accounts)
    ? accounts.filter((item) => item && item.enabled !== false)
    : [];

  if (enabledAccounts.length === 0) {
    const error = new Error('No enabled accounts in config/accounts.json');
    error.code = 'NO_ENABLED_ACCOUNT_B';
    throw error;
  }

  if (!accountId) {
    return enabledAccounts[0];
  }

  const matched = enabledAccounts.find((item) => item.account_id === accountId);
  if (!matched) {
    const error = new Error(`Account not found or disabled for backend B: ${accountId}`);
    error.code = 'ACCOUNT_NOT_FOUND_B';
    throw error;
  }
  return matched;
}

function buildStableAccount(baseAccount) {
  const profileRoot = baseAccount.profile_dir || `data/profiles/${baseAccount.account_id || 'default'}`;
  return {
    ...baseAccount,
    account_id: `${baseAccount.account_id || 'default'}_stable`,
    profile_dir: path.join(profileRoot, 'stable'),
  };
}

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
    const baseAccount = pickBaseAccount(input.accountId);
    const stableAccount = buildStableAccount(baseAccount);

    const runPromise = runOnce({
      siteKey,
      siteConfig: stableSiteConfig,
      startUrl,
      account: stableAccount,
      enableFingerprint: false,
      useStealth: false,
      headless: true,
      maxAttempts: 1,
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
