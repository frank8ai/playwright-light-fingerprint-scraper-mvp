const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FingerprintGenerator } = require('@apify/fingerprint-generator');
const { FingerprintInjector } = require('@apify/fingerprint-injector');

const generator = new FingerprintGenerator({
  browsers: [{ name: 'chrome', minVersion: 120 }],
  devices: ['desktop'],
  operatingSystems: ['windows', 'macos', 'linux'],
});

const injector = new FingerprintInjector();

function stableSeed(accountId, site) {
  const hex = crypto.createHash('sha1').update(`${accountId}:${site}`).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16);
}

function getFingerprintPath(profileDir, site) {
  return path.resolve(profileDir, `.fingerprint.${site}.json`);
}

function loadOrCreateFingerprint({ accountId, profileDir, site, locale }) {
  const fpPath = getFingerprintPath(profileDir, site);
  fs.mkdirSync(path.dirname(fpPath), { recursive: true });

  if (fs.existsSync(fpPath)) {
    return JSON.parse(fs.readFileSync(fpPath, 'utf8'));
  }

  const fingerprint = generator.getFingerprint({
    seed: stableSeed(accountId, site),
    locales: [locale || 'zh-CN'],
  });

  fs.writeFileSync(fpPath, JSON.stringify(fingerprint, null, 2), 'utf8');
  return fingerprint;
}

async function applyFingerprintToContext(context, fingerprint) {
  await injector.attachFingerprintToPlaywright(context, fingerprint);
}

module.exports = {
  loadOrCreateFingerprint,
  applyFingerprintToContext,
};
