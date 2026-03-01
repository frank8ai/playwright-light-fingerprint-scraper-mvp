const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

function canonicalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return String(url || '');
  }
}

function loadIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveIndex(indexPath, index) {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

function dedupeRecords(records = [], options = {}) {
  const indexPath = options.indexPath || path.resolve('data/clean/dedupe_index.json');
  const index = loadIndex(indexPath);
  const freshRecords = [];
  let skipped = 0;

  for (const record of records) {
    const urlHash = sha256(canonicalizeUrl(record.link || ''));
    const contentHash = sha256(record.body || '');
    const key = `${urlHash}:${contentHash}`;

    if (index[key]) {
      skipped += 1;
      continue;
    }

    index[key] = {
      first_seen_at: new Date().toISOString(),
      url_hash: urlHash,
      content_hash: contentHash,
      link: record.link || '',
    };
    freshRecords.push(record);
  }

  saveIndex(indexPath, index);

  return {
    freshRecords,
    skipped,
    total: records.length,
  };
}

module.exports = {
  dedupeRecords,
  canonicalizeUrl,
  sha256,
};
