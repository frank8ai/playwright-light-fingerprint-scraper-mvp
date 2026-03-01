function cleanText(input) {
  if (!input) {
    return '';
  }

  return String(input)
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n[ ]+/g, '\n')
    .trim();
}

function cleanRecord(record = {}) {
  const title = cleanText(record.title || '');
  const body = cleanText(record.body || '');
  const publishedAt = cleanText(record.published_at || '');
  const link = cleanText(record.link || '');

  return {
    ...record,
    title,
    body,
    published_at: publishedAt,
    link,
    evidence_snippet: body.slice(0, 180),
  };
}

function cleanRecords(records = []) {
  return records.map((record) => cleanRecord(record));
}

module.exports = {
  cleanText,
  cleanRecord,
  cleanRecords,
};
