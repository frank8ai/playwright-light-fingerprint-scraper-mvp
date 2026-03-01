# Playwright 轻指纹抓取 MVP (Node.js)

本项目是一个可运行的抓取 MVP，目标是单站点抓取 `title/body/published_at/link`，并满足以下工程要求：

- `microsoft/playwright` + `launchPersistentContext`
- `@apify/fingerprint-suite`（`fingerprint-generator` + `fingerprint-injector`）
- 可选 `playwright-extra + stealth`（默认关闭）
- 代理策略（固定代理 / 失败切换 / 冷却）
- 重试策略（指数退避：1s/2s/4s，最多 3 次尝试）
- 节奏控制（随机等待 300-1200ms）
- 失败截图 + 结构化 JSONL 日志

## 目录

```text
scripts/scraper/
  run_once.js
  run_batch.js
  lib/
    browser.js
    fingerprint.js
    proxy.js
    pacing.js
    retry.js
    logger.js
    cleaner.js
    dedupe.js
  extractors/
    site_a.js
config/
  accounts.json
  proxies.json
  sites/site_a.json
data/
  raw/
  clean/
  snapshots/
logs/
.env.example
docs/dev-plan.md
docs/runbook.md
```

## 安装

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

一键启动（新机器）：

```bash
cp .env.example .env && npm run setup && npm run phase:1
```

说明：`npm run setup` 使用 `npm ci`，基于 `package-lock.json` 做可复现安装。

## 依赖来源与版本锁定

依赖统一通过 `npm` 获取，不手动下载仓库源码。

### 必选依赖

- `playwright@1.51.0`  
  GitHub: <https://github.com/microsoft/playwright>
- `@apify/fingerprint-generator@2.1.81`  
  GitHub: <https://github.com/apify/fingerprint-suite>  
  说明：在 `package.json` 中使用 npm alias 形式锁定为  
  `\"@apify/fingerprint-generator\": \"npm:fingerprint-generator@2.1.81\"`
- `@apify/fingerprint-injector@2.1.81`  
  GitHub: <https://github.com/apify/fingerprint-suite>  
  说明：在 `package.json` 中使用 npm alias 形式锁定为  
  `\"@apify/fingerprint-injector\": \"npm:fingerprint-injector@2.1.81\"`

### 可选依赖（默认关闭）

- `playwright-extra@4.3.6`  
  GitHub: <https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra>
- `puppeteer-extra-plugin-stealth@2.11.2`  
  GitHub: <https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth>

### 版本锁定策略

- `package.json` 使用明确版本，不使用 `latest`。
- 所有关键依赖固定到具体版本号。
- 使用 `package-lock.json` 固化完整依赖树。
- 在 CI/新机器优先使用 `npm ci` 进行可复现安装。

## 配置

1. `.env`：运行参数（是否 headless、重试、截图、fingerprint/stealth 开关）
2. `config/accounts.json`：账号与 profile 目录（每账号隔离）
3. `config/proxies.json`：代理池（支持 `health_score` + `cooldown_until`）
4. `config/sites/site_a.json`：站点入口 URL、选择器、等待规则

## 运行

### 阶段 1：Baseline（仅 Playwright 持久化 + run_once）

```bash
ENABLE_FINGERPRINT=false USE_STEALTH=false node scripts/scraper/run_once.js --site site_a
```

### 阶段 2：接入 fingerprint-suite

```bash
ENABLE_FINGERPRINT=true USE_STEALTH=false node scripts/scraper/run_once.js --site site_a
```

### 阶段 3：可选 stealth + batch + cron-ready

```bash
ENABLE_FINGERPRINT=true USE_STEALTH=false node scripts/scraper/run_batch.js --site site_a --runs 30
```

如果要开启 stealth：

```bash
USE_STEALTH=true node scripts/scraper/run_once.js --site site_a
```

## 输出

- 原始数据：`data/raw/<site>/<task_id>.json`
- 清洗/去重后数据：`data/clean/<site>/<task_id>.json`
- 失败截图：`data/snapshots/<task_id>_attemptN.png`
- 结构化日志：
  - `logs/scraper.jsonl`
  - `logs/error.jsonl`

### 日志字段（JSONL）

至少包含：

- `trace_id`
- `task_id`
- `account_id`
- `site`
- `status`
- `error_type`
- `duration_ms`

并额外记录 `attempt/proxy_id/start_url/error_message/screenshot_path` 等调试字段。

## 批处理成功率目标

`run_batch.js` 运行完成后会输出：

- `success_rate_pct`
- `max_failed_streak`
- `should_alert`（连续失败 >=3 时为 true）
- `target_met`（是否达到 >=85%）

并写入 `logs/batch_summary_<trace_id>.json`。

## Cron（示例）

每 15 分钟执行一次（可用于 OpenClaw 或系统 cron 调度）：

```cron
*/15 * * * * cd /Users/yizhi/playwright-light-fingerprint-scraper && /usr/bin/env bash -lc 'source .env && node scripts/scraper/run_batch.js --site site_a --runs 3 >> logs/cron.log 2>&1'
```

## 注意事项

- `config/proxies.json` 模板里的本地代理地址只是示例，需替换为真实可用代理。
- 首次使用某账号会在 `profile_dir` 创建浏览器 profile；后续运行会复用登录态。
- 若站点 DOM 改动，优先更新 `config/sites/site_a.json` 选择器。
