const { waitMs } = require('./pacing');

function classifyError(error) {
  const message = String(error && error.message ? error.message : '').toLowerCase();
  const code = String(error && error.code ? error.code : '').toLowerCase();

  if (message.includes('timeout') || code.includes('timeout')) {
    return 'timeout';
  }

  if (
    code.includes('econnreset') ||
    code.includes('enotfound') ||
    code.includes('econnrefused') ||
    code.includes('etimedout') ||
    message.includes('net::err') ||
    message.includes('connection') ||
    message.includes('network')
  ) {
    return 'network';
  }

  if (message.includes('403') || message.includes('401') || message.includes('forbidden') || message.includes('unauthorized')) {
    return 'permission';
  }

  if (message.includes('config') || message.includes('invalid') || message.includes('missing')) {
    return 'config';
  }

  if (message.includes('captcha')) {
    return 'captcha';
  }

  return 'unknown';
}

function isRetriableError(error) {
  const errorType = classifyError(error);
  return errorType === 'timeout' || errorType === 'network';
}

async function withRetry(operation, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 3);
  const backoffScheduleMs = options.backoffScheduleMs || [1000, 2000, 4000];
  const shouldRetry = options.shouldRetry || isRetriableError;
  const onRetry = options.onRetry || (async () => {});

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation({ attempt, maxAttempts });
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && shouldRetry(error);
      if (!canRetry) {
        throw error;
      }

      const delayMs = backoffScheduleMs[Math.min(attempt - 1, backoffScheduleMs.length - 1)] || 1000;
      await onRetry({ attempt, delayMs, error });
      await waitMs(delayMs);
    }
  }

  throw lastError;
}

module.exports = {
  withRetry,
  classifyError,
  isRetriableError,
};
