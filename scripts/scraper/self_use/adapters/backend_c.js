const { normalizeDomain, withTimeout } = require('../utils');

function decodeEntities(input = '') {
  return String(input)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(input = '') {
  return decodeEntities(String(input).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function flattenTopics(topics = [], output = []) {
  for (const topic of topics) {
    if (!topic) {
      continue;
    }

    if (Array.isArray(topic.Topics)) {
      flattenTopics(topic.Topics, output);
      continue;
    }

    output.push(topic);
  }
  return output;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeoutMs || 10000));

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'SelfUseScraper/1.0 (+https://example.local)',
      },
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} from fallback API`);
      error.code = `HTTP_${response.status}`;
      throw error;
    }

    return response.json();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error('Backend C timeout');
      timeoutError.code = 'ETIMEDOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeoutMs || 10000));

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'SelfUseScraper/1.0 (+https://example.local)',
      },
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} while fetching URL snapshot`);
      error.code = `HTTP_${response.status}`;
      throw error;
    }

    return response.text();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error('Backend C timeout');
      timeoutError.code = 'ETIMEDOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseTitle(html = '') {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return '';
  }
  return stripTags(match[1]);
}

function parseMetaDescription(html = '') {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);

  if (!match) {
    return '';
  }
  return stripTags(match[1]);
}

class BackendCAdapter {
  constructor() {
    this.id = 'C';
  }

  async run(input = {}, context = {}) {
    const timeoutMs = context.config && context.config.timeouts ? context.config.timeouts.totalMs : 35000;

    const task = async () => {
      if (input.query) {
        return this.runQueryFallback(input, timeoutMs, context);
      }
      if (input.url) {
        return this.runUrlFallback(input, timeoutMs);
      }

      const error = new Error('Backend C needs query or url input');
      error.code = 'INVALID_INPUT_C';
      throw error;
    };

    return withTimeout(task(), timeoutMs, 'Backend C timeout');
  }

  async runQueryFallback(input, timeoutMs, context = {}) {
    const compactTopN = context.config && context.config.output
      ? Number(context.config.output.compactTopN || 3)
      : 3;
    const limit = Number(input.limit || compactTopN || 3);
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(String(input.query))}&format=json&no_html=1&skip_disambig=1`;
    const payload = await fetchJson(apiUrl, timeoutMs);

    const topics = flattenTopics(payload.RelatedTopics || []);
    const items = [];

    if (payload.AbstractURL || payload.AbstractText) {
      items.push({
        title: payload.Heading || input.query,
        url: payload.AbstractURL || '',
        snippet: payload.AbstractText || '',
      });
    }

    for (const topic of topics) {
      if (items.length >= limit) {
        break;
      }

      if (!topic.FirstURL && !topic.Text) {
        continue;
      }

      items.push({
        title: topic.Text ? String(topic.Text).split(' - ')[0] : topic.FirstURL,
        url: topic.FirstURL || '',
        snippet: topic.Text || '',
      });
    }

    const normalizedItems = items
      .filter((item) => item.url || item.snippet)
      .slice(0, limit)
      .map((item) => {
        const url = String(item.url || '').trim();
        return {
          title: stripTags(item.title || input.query),
          url,
          snippet: stripTags(item.snippet || ''),
          source: normalizeDomain(url),
          capturedAt: new Date().toISOString(),
          confidence: 0.45,
        };
      });

    if (normalizedItems.length === 0) {
      const error = new Error('No fallback search results from Backend C');
      error.code = 'NO_RESULTS_C_QUERY';
      throw error;
    }

    return {
      backend: this.id,
      partial: true,
      query: input.query,
      items: normalizedItems,
      raw: {
        apiUrl,
      },
    };
  }

  async runUrlFallback(input, timeoutMs) {
    const html = await fetchText(String(input.url), timeoutMs);
    const title = parseTitle(html);
    const snippet = parseMetaDescription(html);

    const item = {
      title: title || input.url,
      url: String(input.url),
      snippet: snippet || title || 'URL snapshot fetched without rich content.',
      source: normalizeDomain(String(input.url)),
      capturedAt: new Date().toISOString(),
      confidence: 0.4,
    };

    return {
      backend: this.id,
      partial: true,
      query: input.url,
      items: [item],
      raw: {
        fetchedBytes: Buffer.byteLength(html, 'utf8'),
      },
    };
  }
}

module.exports = {
  BackendCAdapter,
};
