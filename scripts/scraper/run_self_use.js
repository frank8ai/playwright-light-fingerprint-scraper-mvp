#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const { runOnce, parseArgs } = require('./run_once');
const { loadSelfUseConfig } = require('./self_use/config');
const { SelfUseOrchestrator } = require('./self_use/orchestrator');
const { normalizeError } = require('./self_use/errors');
const { buildSuccessResult, buildFailedResult } = require('./self_use/normalizer');
const { readRecordsFromRunOnce, mapRecordToNormalizedItem } = require('./self_use/adapters/common');
const { toBoolean } = require('./self_use/utils');

dotenv.config();

async function runLegacyDirect(input = {}) {
  const startedAt = Date.now();
  const requestId = input.requestId;

  try {
    const runResult = await runOnce({
      siteKey: input.site || 'site_a',
      startUrl: input.url,
      enableFingerprint: true,
      useStealth: false,
      headless: true,
    });

    const records = readRecordsFromRunOnce(runResult);
    const items = records.map((record) => mapRecordToNormalizedItem(record, 0.85));

    return buildSuccessResult({
      requestId,
      backendUsed: 'A',
      fallbackCount: 0,
      query: input.query || input.url || '',
      fromCache: false,
      results: items,
      partial: false,
      latencyMs: Date.now() - startedAt,
      attempts: 1,
      error: { code: '', message: '', type: 'unknown' },
    });
  } catch (error) {
    return buildFailedResult({
      requestId,
      backendUsed: 'A',
      fallbackCount: 0,
      query: input.query || input.url || '',
      attempts: 1,
      latencyMs: Date.now() - startedAt,
      error: normalizeError(error),
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config || path.resolve('config/self-use-scraper.json');
  const config = loadSelfUseConfig(configPath);

  const input = {
    taskType: args.taskType,
    query: args.query,
    url: args.url,
    site: args.site || 'site_a',
    accountId: args.account,
    outputMode: args.outputMode,
    topN: args.topN ? Number(args.topN) : undefined,
    maxSnippetChars: args.maxSnippetChars ? Number(args.maxSnippetChars) : undefined,
    preferBrowser: toBoolean(args.preferBrowser, false),
    artifactPointer: args.artifactPointer === undefined ? undefined : toBoolean(args.artifactPointer, true),
    requestId: args.requestId,
    debug: {
      forceBackendAFail: toBoolean(args.forceBackendAFail || process.env.SELF_USE_FORCE_BACKEND_A_FAIL, false),
    },
  };

  const legacyDirect = toBoolean(
    args.legacyDirect || process.env.SCRAPER_LEGACY_DIRECT,
    false
  );

  let result;
  if (legacyDirect && config.routing.legacyDirectEnabled) {
    result = await runLegacyDirect(input);
  } else {
    const orchestrator = new SelfUseOrchestrator({ config });
    result = await orchestrator.run(input);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === 'failed' ? 1 : 0;
}

if (require.main === module) {
  main().catch((error) => {
    const payload = {
      status: 'failed',
      error: normalizeError(error),
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  });
}
