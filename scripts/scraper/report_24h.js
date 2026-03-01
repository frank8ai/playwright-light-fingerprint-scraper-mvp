#!/usr/bin/env node

const path = require('path');
const { parseArgs } = require('./run_once');
const { build24hReport } = require('./self_use/metrics');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const hours = Number(args.hours || 24);
  const report = build24hReport({
    hours,
    requestLogPath: path.resolve('logs/self-use-requests.jsonl'),
    eventLogPath: path.resolve('logs/self-use-events.jsonl'),
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
