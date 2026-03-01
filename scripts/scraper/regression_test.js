#!/usr/bin/env node

const path = require('path');
const { parseArgs } = require('./run_once');
const { loadJson } = require('./self_use/utils');
const { loadSelfUseConfig } = require('./self_use/config');
const { SelfUseOrchestrator } = require('./self_use/orchestrator');
const { percentile } = require('./self_use/metrics');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadSelfUseConfig(args.config || path.resolve('config/self-use-scraper.json'));
  const useCache = String(args.useCache || 'false').toLowerCase() === 'true';
  config.cache.enabled = useCache;
  const orchestrator = new SelfUseOrchestrator({ config });

  const casesPath = path.resolve(args.cases || 'config/regression-cases.json');
  const cases = loadJson(casesPath, []);
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`No regression cases found in ${casesPath}`);
  }

  const simulateAFailPct = Number(args.simulateAFailPct || 0);
  const results = [];

  for (let i = 0; i < cases.length; i += 1) {
    const testCase = cases[i] || {};
    const shouldForceAFail = simulateAFailPct > 0 && (Math.random() * 100) < simulateAFailPct;
    const runResult = await orchestrator.run({
      taskType: testCase.taskType,
      query: testCase.query,
      url: testCase.url,
      site: testCase.site || 'site_a',
      debug: {
        forceBackendAFail: shouldForceAFail,
      },
    });

    results.push({
      id: testCase.id || `case_${i + 1}`,
      status: runResult.status,
      backendUsed: runResult.backendUsed,
      fallbackCount: runResult.fallbackCount,
      latencyMs: runResult.metrics.latencyMs,
      forcedAFailure: shouldForceAFail,
      errorType: runResult.error.type,
    });
  }

  const total = results.length;
  const successCount = results.filter((item) => item.status === 'success' || item.status === 'partial').length;
  const forcedAFailCases = results.filter((item) => item.forcedAFailure);
  const forcedAFailSuccess = forcedAFailCases.filter((item) => item.status === 'success' || item.status === 'partial').length;
  const latencies = results.map((item) => item.latencyMs).filter((item) => Number.isFinite(item));

  const summary = {
    generatedAt: new Date().toISOString(),
    casesPath,
    total,
    successRate: total > 0 ? Number(((successCount / total) * 100).toFixed(2)) : 0,
    fallbackSuccessRateWhenAForcedFail: forcedAFailCases.length > 0
      ? Number(((forcedAFailSuccess / forcedAFailCases.length) * 100).toFixed(2))
      : null,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
    simulateAFailPct,
    useCache,
    results,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      message: String(error.message || error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
