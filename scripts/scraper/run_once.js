#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { launchPersistentContext, newPageWithDefaults } = require('./lib/browser');
const { loadOrCreateFingerprint, applyFingerprintToContext } = require('./lib/fingerprint');
const { ProxyManager } = require('./lib/proxy');
const { withRetry, classifyError, isRetriableError } = require('./lib/retry');
const { JsonlLogger, ensureDir, createTraceId, createTaskId } = require('./lib/logger');
const { cleanRecords } = require('./lib/cleaner');
const { dedupeRecords } = require('./lib/dedupe');
const { extractSiteA } = require('./extractors/site_a');

dotenv.config();

function parseArgs(argv = []) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function loadJson(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Missing config file: ${absPath}`);
  }
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function ensureBaseDirs() {
  [
    'data/raw',
    'data/clean',
    'data/snapshots',
    'logs',
    'data/profiles',
  ].forEach((dirPath) => ensureDir(path.resolve(dirPath)));
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return String(value).toLowerCase() === 'true';
}

function resolveExtractor(siteKey) {
  if (siteKey === 'site_a') {
    return extractSiteA;
  }
  throw new Error(`Unsupported site extractor: ${siteKey}`);
}

function pickAccount(accounts, accountId) {
  const enabled = accounts.filter((item) => item.enabled !== false);
  if (enabled.length === 0) {
    throw new Error('No enabled accounts in config/accounts.json');
  }
  if (!accountId) {
    return enabled[0];
  }
  const matched = enabled.find((item) => item.account_id === accountId);
  if (!matched) {
    throw new Error(`Account not found or disabled: ${accountId}`);
  }
  return matched;
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function runOnce(options = {}) {
  ensureBaseDirs();

  const cliArgs = options.cliArgs || {};
  const siteKey = options.siteKey || cliArgs.site || process.env.SITE_KEY || 'site_a';
  const siteConfig = options.siteConfig || loadJson(path.resolve(`config/sites/${siteKey}.json`));
  const accounts = options.accounts || loadJson(path.resolve('config/accounts.json'));
  const proxies = options.proxies || loadJson(path.resolve('config/proxies.json'));

  const logger = options.logger || new JsonlLogger({ logDir: path.resolve('logs') });
  const traceId = options.traceId || createTraceId();
  const taskId = options.taskId || createTaskId(siteKey);
  const account = options.account || pickAccount(accounts, options.accountId || cliArgs.account);
  const proxyManager = options.proxyManager || new ProxyManager(proxies, {
    cooldownMs: Number(process.env.PROXY_COOLDOWN_MS || 300000),
  });

  const extractor = resolveExtractor(siteKey);
  const startUrl = options.startUrl || cliArgs.url || (siteConfig.start_urls || [])[0];

  if (!startUrl) {
    throw new Error(`No start_url for site: ${siteKey}`);
  }

  const enableFingerprint = toBoolean(options.enableFingerprint ?? process.env.ENABLE_FINGERPRINT, true);
  const screenshotOnError = toBoolean(process.env.SCREENSHOT_ON_ERROR, true);

  const runStartedAt = Date.now();
  const backoffBase = Number(process.env.RETRY_BACKOFF_MS || 1000);
  const maxAttempts = Number(process.env.MAX_ATTEMPTS || process.env.MAX_RETRIES || 3);

  const rawSiteDir = path.resolve('data/raw', siteKey);
  const cleanSiteDir = path.resolve('data/clean', siteKey);
  ensureDir(rawSiteDir);
  ensureDir(cleanSiteDir);

  const result = await withRetry(
    async ({ attempt, maxAttempts: totalAttempts }) => {
      const attemptStartedAt = Date.now();
      let context;
      let page;
      let proxyConfig = null;

      try {
        proxyConfig = proxyManager.selectProxy(account);
        context = await launchPersistentContext(account, proxyConfig, {
          env: process.env,
          useStealth: options.useStealth,
          headless: options.headless,
        });

        if (enableFingerprint) {
          const fingerprint = loadOrCreateFingerprint({
            accountId: account.account_id,
            profileDir: account.profile_dir,
            site: siteKey,
            locale: process.env.BROWSER_LOCALE,
          });
          await applyFingerprintToContext(context, fingerprint);
        }

        page = await newPageWithDefaults(context, {
          locale: process.env.BROWSER_LOCALE,
        });

        const records = await extractor(page, {
          siteConfig,
          startUrl,
        });

        const normalized = records.map((record) => ({
          site: siteKey,
          account_id: account.account_id,
          fetched_at: new Date().toISOString(),
          ...record,
        }));

        const cleaned = cleanRecords(normalized);
        const dedupeResult = dedupeRecords(cleaned, {
          indexPath: path.resolve('data/clean/dedupe_index.json'),
        });

        const outputPayload = {
          trace_id: traceId,
          task_id: taskId,
          account_id: account.account_id,
          site: siteKey,
          start_url: startUrl,
          attempt,
          total_attempts: totalAttempts,
          extracted_count: cleaned.length,
          fresh_count: dedupeResult.freshRecords.length,
          skipped_count: dedupeResult.skipped,
          records: cleaned,
        };

        const rawPath = path.join(rawSiteDir, `${taskId}.json`);
        const cleanPath = path.join(cleanSiteDir, `${taskId}.json`);
        writeJson(rawPath, outputPayload);
        writeJson(cleanPath, {
          ...outputPayload,
          records: dedupeResult.freshRecords,
        });

        if (proxyConfig && proxyConfig.proxy_id) {
          proxyManager.markSuccess(proxyConfig.proxy_id);
        }

        logger.info({
          trace_id: traceId,
          task_id: taskId,
          account_id: account.account_id,
          site: siteKey,
          status: 'success',
          error_type: null,
          duration_ms: Date.now() - runStartedAt,
          attempt,
          proxy_id: proxyConfig ? proxyConfig.proxy_id : null,
          start_url: startUrl,
          raw_path: rawPath,
          clean_path: cleanPath,
          extracted_count: cleaned.length,
          fresh_count: dedupeResult.freshRecords.length,
        });

        return {
          success: true,
          trace_id: traceId,
          task_id: taskId,
          account_id: account.account_id,
          site: siteKey,
          extracted_count: cleaned.length,
          fresh_count: dedupeResult.freshRecords.length,
          duration_ms: Date.now() - runStartedAt,
          raw_path: rawPath,
          clean_path: cleanPath,
        };
      } catch (error) {
        const errorType = classifyError(error);
        let screenshotPath = null;

        if (page && screenshotOnError) {
          screenshotPath = path.resolve('data/snapshots', `${taskId}_attempt${attempt}.png`);
          try {
            await page.screenshot({ path: screenshotPath, fullPage: true });
          } catch {
            screenshotPath = null;
          }
        }

        if (proxyConfig && proxyConfig.proxy_id && isRetriableError(error)) {
          proxyManager.markFailure(proxyConfig.proxy_id);
        }

        logger.error({
          trace_id: traceId,
          task_id: taskId,
          account_id: account.account_id,
          site: siteKey,
          status: 'failed',
          error_type: errorType,
          duration_ms: Date.now() - attemptStartedAt,
          attempt,
          proxy_id: proxyConfig ? proxyConfig.proxy_id : null,
          start_url: startUrl,
          error_message: String(error.message || error),
          screenshot_path: screenshotPath,
        });

        error.errorType = errorType;
        error.screenshotPath = screenshotPath;
        throw error;
      } finally {
        if (context) {
          await context.close();
        }
      }
    },
    {
      maxAttempts,
      backoffScheduleMs: [backoffBase, backoffBase * 2, backoffBase * 4],
      shouldRetry: isRetriableError,
      onRetry: async ({ attempt, delayMs, error }) => {
        logger.info({
          trace_id: traceId,
          task_id: taskId,
          account_id: account.account_id,
          site: siteKey,
          status: 'retry',
          error_type: classifyError(error),
          duration_ms: Date.now() - runStartedAt,
          attempt,
          next_delay_ms: delayMs,
          error_message: String(error.message || error),
        });
      },
    }
  );

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await runOnce({
      cliArgs: args,
      accountId: args.account,
      startUrl: args.url,
      useStealth: args.useStealth,
      siteKey: args.site,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const payload = {
      success: false,
      error_type: classifyError(error),
      message: String(error.message || error),
      screenshot_path: error.screenshotPath || null,
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runOnce,
  parseArgs,
  loadJson,
};
