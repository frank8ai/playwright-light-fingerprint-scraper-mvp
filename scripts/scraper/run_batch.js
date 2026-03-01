#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { runOnce, parseArgs, loadJson } = require('./run_once');
const { JsonlLogger, createTraceId, createTaskId, ensureDir } = require('./lib/logger');
const { ProxyManager } = require('./lib/proxy');

dotenv.config();

function pickEnabledAccounts(accounts = []) {
  return accounts.filter((account) => account.enabled !== false);
}

async function runBatch(options = {}) {
  const cliArgs = options.cliArgs || {};
  const siteKey = options.siteKey || cliArgs.site || process.env.SITE_KEY || 'site_a';
  const runs = Number(options.runs || cliArgs.runs || 30);

  const siteConfig = options.siteConfig || loadJson(path.resolve(`config/sites/${siteKey}.json`));
  const accounts = options.accounts || loadJson(path.resolve('config/accounts.json'));
  const proxies = options.proxies || loadJson(path.resolve('config/proxies.json'));

  const enabledAccounts = pickEnabledAccounts(accounts);
  if (enabledAccounts.length === 0) {
    throw new Error('No enabled accounts for batch execution');
  }

  ensureDir(path.resolve('logs'));
  const logger = options.logger || new JsonlLogger({ logDir: path.resolve('logs') });
  const proxyManager = options.proxyManager || new ProxyManager(proxies, {
    cooldownMs: Number(process.env.PROXY_COOLDOWN_MS || 300000),
  });

  const batchTraceId = options.traceId || createTraceId();
  const startedAt = Date.now();
  const taskResults = [];
  let successCount = 0;
  let failedCount = 0;
  let failedStreak = 0;
  let maxFailedStreak = 0;

  for (let i = 0; i < runs; i += 1) {
    const account = enabledAccounts[i % enabledAccounts.length];
    const taskId = createTaskId(`${siteKey}_batch`);

    try {
      const result = await runOnce({
        siteKey,
        siteConfig,
        accounts,
        proxies,
        account,
        logger,
        proxyManager,
        traceId: batchTraceId,
        taskId,
      });
      taskResults.push(result);
      successCount += 1;
      failedStreak = 0;
    } catch (error) {
      failedCount += 1;
      failedStreak += 1;
      maxFailedStreak = Math.max(maxFailedStreak, failedStreak);
      taskResults.push({
        success: false,
        task_id: taskId,
        account_id: account.account_id,
        site: siteKey,
        error_type: error.errorType || 'unknown',
        message: String(error.message || error),
      });

      logger.error({
        trace_id: batchTraceId,
        task_id: taskId,
        account_id: account.account_id,
        site: siteKey,
        status: 'failed',
        error_type: error.errorType || 'unknown',
        duration_ms: 0,
        error_message: `batch_wrapper:${String(error.message || error)}`,
      });
    }
  }

  const successRate = runs > 0 ? Number(((successCount / runs) * 100).toFixed(2)) : 0;
  const summary = {
    trace_id: batchTraceId,
    site: siteKey,
    runs,
    success_count: successCount,
    failed_count: failedCount,
    success_rate_pct: successRate,
    duration_ms: Date.now() - startedAt,
    max_failed_streak: maxFailedStreak,
    should_alert: maxFailedStreak >= 3,
    target_met: successRate >= 85,
    generated_at: new Date().toISOString(),
    results: taskResults,
  };

  const summaryPath = path.resolve('logs', `batch_summary_${batchTraceId}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  logger.info({
    trace_id: batchTraceId,
    task_id: `batch_${siteKey}`,
    account_id: 'batch',
    site: siteKey,
    status: summary.target_met ? 'success' : 'failed',
    error_type: summary.target_met ? null : 'target_not_met',
    duration_ms: summary.duration_ms,
    success_rate_pct: summary.success_rate_pct,
    max_failed_streak: summary.max_failed_streak,
    should_alert: summary.should_alert,
    summary_path: summaryPath,
  });

  return {
    ...summary,
    summary_path: summaryPath,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await runBatch({
      cliArgs: args,
      siteKey: args.site,
      runs: args.runs,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        success: false,
        error_type: 'batch_error',
        message: String(error.message || error),
      }, null, 2)}\n`
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runBatch,
};
