const path = require('path');
const { chromium: baseChromium } = require('playwright');
const { toPlaywrightProxy } = require('./proxy');

function isTrue(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return String(value).toLowerCase() === 'true';
}

async function resolveChromium(useStealth) {
  if (!useStealth) {
    return baseChromium;
  }

  const { chromium } = require('playwright-extra');
  const stealthPlugin = require('puppeteer-extra-plugin-stealth')();
  chromium.use(stealthPlugin);
  return chromium;
}

async function launchPersistentContext(accountConfig, proxyConfig, options = {}) {
  const env = options.env || process.env;
  const headless = isTrue(options.headless ?? env.HEADLESS, true);
  const useStealth = isTrue(options.useStealth ?? env.USE_STEALTH, false);
  const chromium = await resolveChromium(useStealth);

  const profileDir = path.resolve(accountConfig.profile_dir || `data/profiles/${accountConfig.account_id || 'default'}`);
  const proxy = toPlaywrightProxy(proxyConfig);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    proxy,
    locale: env.BROWSER_LOCALE || 'zh-CN',
    timezoneId: env.BROWSER_TIMEZONE || 'Asia/Shanghai',
    viewport: {
      width: 1366,
      height: 768,
    },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
    ],
  });

  const timeoutMs = Number(env.DEFAULT_TIMEOUT_MS || 30000);
  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(timeoutMs);

  return context;
}

async function newPageWithDefaults(context, options = {}) {
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  await page.setExtraHTTPHeaders({
    'accept-language': options.locale || process.env.BROWSER_LOCALE || 'zh-CN,zh;q=0.9,en;q=0.8',
  });
  return page;
}

module.exports = {
  launchPersistentContext,
  newPageWithDefaults,
};
