# Playwright 轻指纹抓取系统开发计划（V1）

## 目标

构建一个低成本、可扩展、可观测的抓取 MVP：

- 单站点抓取 `title/body/published_at/link`
- 失败可追踪（截图 + JSONL 日志）
- 连续 30 次成功率目标 `>=85%`
- 可平滑扩展到多账号、多代理、定时调度

## 阶段划分（每阶段都可运行）

## Phase 1 - Baseline

范围：

- `run_once.js` 可执行
- `launchPersistentContext` + 每账号 profile 隔离
- `site_a` 基础提取（标题/正文/时间/链接）
- raw 落盘 + 结构化日志 + 失败截图

验收：

- 命令可运行：
  - `ENABLE_FINGERPRINT=false USE_STEALTH=false node scripts/scraper/run_once.js --site site_a`
- 输出 `data/raw/site_a/*.json`
- `logs/scraper.jsonl` 存在且字段完整

## Phase 2 - Fingerprint

范围：

- 接入 `@apify/fingerprint-generator` + `@apify/fingerprint-injector`
- 指纹与账号/profile 绑定，保证一致性
- 默认启用，可配置关闭

验收：

- 命令可运行：
  - `ENABLE_FINGERPRINT=true USE_STEALTH=false node scripts/scraper/run_once.js --site site_a`
- 账号 profile 中生成指纹缓存文件
- 第二次运行可复用指纹+登录态

## Phase 3 - Optional Stealth + Batch + Cron-ready

范围：

- `playwright-extra + stealth` 开关（默认 off）
- `run_batch.js` 批处理（账号轮转、代理冷却、重试）
- 成功率统计 + 连续失败告警标记
- cron 调度命令模板

验收：

- 命令可运行：
  - `ENABLE_FINGERPRINT=true USE_STEALTH=false node scripts/scraper/run_batch.js --site site_a --runs 30`
- 生成 `logs/batch_summary_<trace_id>.json`
- summary 中包含：`success_rate_pct / max_failed_streak / should_alert / target_met`

## 当前实现映射

- 执行层：`scripts/scraper/run_once.js`, `scripts/scraper/run_batch.js`
- 浏览器层：`scripts/scraper/lib/browser.js`
- 策略层：
  - 指纹：`lib/fingerprint.js`
  - 代理：`lib/proxy.js`
  - 节奏：`lib/pacing.js`
  - 重试：`lib/retry.js`
- 提取层：`extractors/site_a.js`
- 数据层：
  - raw：`data/raw`
  - clean：`data/clean`
  - 截图：`data/snapshots`
  - 日志：`logs/*.jsonl`
- 清洗与去重：`lib/cleaner.js`, `lib/dedupe.js`

## 风险与后续

- 站点选择器脆弱：需定期回归 `site_a.json`
- 代理池质量决定稳定性上限：建议接入健康探测与自动降级
- 反爬强站点可能仍触发风控：可考虑扩大等待分布、加人机验证处理流程

## 建议验收步骤（今天）

1. `npm install && npx playwright install chromium`
2. 先跑 Phase 1 验证最小链路
3. 再开启 Phase 2 验证指纹
4. 最后跑 Phase 3 的 `--runs 30` 统计成功率并查看 summary
