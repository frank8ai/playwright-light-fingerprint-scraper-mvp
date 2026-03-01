function waitMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomInt(min, max) {
  const nMin = Number(min);
  const nMax = Number(max);
  return Math.floor(Math.random() * (nMax - nMin + 1)) + nMin;
}

function resolvePacingRange(siteConfig = {}, env = process.env) {
  const sitePacing = siteConfig.pacing || {};
  const minMs = Number(sitePacing.min_ms || env.PACING_MIN_MS || 300);
  const maxMs = Number(sitePacing.max_ms || env.PACING_MAX_MS || 1200);
  return {
    minMs: Math.min(minMs, maxMs),
    maxMs: Math.max(minMs, maxMs),
  };
}

async function randomWait(siteConfig = {}, env = process.env) {
  const { minMs, maxMs } = resolvePacingRange(siteConfig, env);
  const ms = randomInt(minMs, maxMs);
  await waitMs(ms);
  return ms;
}

module.exports = {
  waitMs,
  randomInt,
  resolvePacingRange,
  randomWait,
};
