#!/usr/bin/env node

const path = require('path');
const { parseArgs } = require('./run_once');
const { loadSelfUseConfig } = require('./self_use/config');
const { SelfUseOrchestrator } = require('./self_use/orchestrator');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadSelfUseConfig(args.config || path.resolve('config/self-use-scraper.json'));
  const orchestrator = new SelfUseOrchestrator({ config });
  const health = orchestrator.healthSnapshot({
    scope: args.scope,
  });
  process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
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
