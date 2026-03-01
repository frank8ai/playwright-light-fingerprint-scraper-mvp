const { ERROR_TYPES } = require('./contracts');

function normalizeErrorType(rawError) {
  const message = String(rawError && rawError.message ? rawError.message : '').toLowerCase();
  const code = String(rawError && rawError.code ? rawError.code : '').toLowerCase();

  if (message.includes('timeout') || code.includes('timeout') || code === 'etimedout') {
    return 'timeout';
  }

  if (
    message.includes('captcha') ||
    message.includes('hcaptcha') ||
    message.includes('recaptcha')
  ) {
    return 'captcha';
  }

  if (
    message.includes('blocked') ||
    message.includes('forbidden') ||
    message.includes('access denied') ||
    message.includes('too many requests') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('403')
  ) {
    return 'blocked';
  }

  if (
    message.includes('selector') ||
    message.includes('dom') ||
    message.includes('waitforselector') ||
    message.includes('cannot read properties') ||
    message.includes('no results')
  ) {
    return 'dom_changed';
  }

  if (
    code.includes('econnreset') ||
    code.includes('enotfound') ||
    code.includes('econnrefused') ||
    code.includes('enetunreach') ||
    message.includes('net::err') ||
    message.includes('network') ||
    message.includes('connection')
  ) {
    return 'network';
  }

  return 'unknown';
}

function normalizeError(rawError) {
  const type = normalizeErrorType(rawError);
  const code = String((rawError && rawError.code) || '').trim();
  const message = String((rawError && rawError.message) || rawError || 'Unknown error').trim();

  return {
    code,
    message,
    type: ERROR_TYPES.includes(type) ? type : 'unknown',
  };
}

module.exports = {
  normalizeError,
  normalizeErrorType,
};
