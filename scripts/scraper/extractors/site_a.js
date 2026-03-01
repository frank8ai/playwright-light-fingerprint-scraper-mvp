const { randomWait } = require('../lib/pacing');

async function extractSiteA(page, taskConfig = {}) {
  const siteConfig = taskConfig.siteConfig || {};
  const startUrl = taskConfig.startUrl;
  const navigation = siteConfig.navigation || {};
  const waitRules = siteConfig.wait_rules || {};

  await randomWait(siteConfig, process.env);

  await page.goto(startUrl, {
    waitUntil: navigation.wait_until || 'domcontentloaded',
    timeout: Number(navigation.timeout_ms || process.env.DEFAULT_TIMEOUT_MS || 30000),
  });

  if (waitRules.selector) {
    await page.waitForSelector(waitRules.selector, {
      timeout: Number(waitRules.timeout_ms || process.env.DEFAULT_TIMEOUT_MS || 30000),
    });
  }

  await randomWait(siteConfig, process.env);

  const selectors = siteConfig.selectors || {};
  const extracted = await page.evaluate((inputSelectors) => {
    function textFromNode(node) {
      if (!node) {
        return '';
      }
      const text = node.innerText || node.textContent || '';
      return text.trim();
    }

    function pickText(selectorList) {
      const list = Array.isArray(selectorList) ? selectorList : [];
      for (const selector of list) {
        const node = document.querySelector(selector);
        const text = textFromNode(node);
        if (text) {
          return text;
        }
      }
      return '';
    }

    function pickPublishedAt(selectorList) {
      const list = Array.isArray(selectorList) ? selectorList : [];
      for (const selector of list) {
        const node = document.querySelector(selector);
        if (!node) {
          continue;
        }

        const fromDatetime = node.getAttribute('datetime');
        if (fromDatetime) {
          return fromDatetime.trim();
        }

        const fromContent = node.getAttribute('content');
        if (fromContent) {
          return fromContent.trim();
        }

        const text = textFromNode(node);
        if (text) {
          return text;
        }
      }
      return '';
    }

    const title = pickText(inputSelectors.title) || document.title || '';
    const body = pickText(inputSelectors.body);
    const publishedAt = pickPublishedAt(inputSelectors.time);

    return {
      title,
      body,
      published_at: publishedAt,
      link: window.location.href,
    };
  }, selectors);

  return [extracted];
}

module.exports = {
  extractSiteA,
};
