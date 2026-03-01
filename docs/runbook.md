# Scraper Runbook (V1)

## 1. 快速体检

```bash
cd /Users/yizhi/playwright-light-fingerprint-scraper
npm ci
npx playwright install chromium
cp .env.example .env
npm run phase:1
```

成功标志：

- 控制台返回 `"success": true`
- `data/raw/site_a/*.json` 有新文件
- `logs/scraper.jsonl` 有新增记录

## 2. 常见故障与处理

### 2.1 启动失败（浏览器未安装）

现象：报错包含 `Executable doesn't exist` 或浏览器路径错误。
处理：

```bash
npx playwright install chromium
```

### 2.2 任务超时

现象：`error_type=timeout`。
处理步骤：

1. 提高 `DEFAULT_TIMEOUT_MS`（如 45000）
2. 检查 `config/sites/site_a.json` 选择器是否失效
3. 查看 `data/snapshots/*.png` 判断页面是否加载异常

### 2.3 网络错误/代理不可用

现象：`error_type=network`，且重试后仍失败。
处理步骤：

1. 检查 `config/proxies.json` 的 `server/username/password`
2. 若临时波动，等待冷却后重试
3. 可先禁用代理验证抓取链路

### 2.4 提取结果为空

现象：`extracted_count>0` 但正文为空。
处理步骤：

1. 检查 `config/sites/site_a.json` 的 `selectors.body`
2. 如站点结构变化，更新 extractor 或 selector 列表

## 3. 日志定位

核心日志：

- `logs/scraper.jsonl`：全量结构化日志
- `logs/error.jsonl`：失败日志子集

关键字段：

- `trace_id/task_id`：一次任务链路
- `account_id/site`：定位账号与站点
- `status/error_type`：状态与错误分类
- `duration_ms`：时延

## 4. 稳定性验收

运行 30 次：

```bash
ENABLE_FINGERPRINT=true USE_STEALTH=false node scripts/scraper/run_batch.js --site site_a --runs 30
```

验收标准：

- `success_rate_pct >= 85`
- `max_failed_streak < 3`（否则需告警）

## 5. 定时执行（Cron）

示例（每15分钟跑3次批处理）：

```cron
*/15 * * * * cd /Users/yizhi/playwright-light-fingerprint-scraper && /usr/bin/env bash -lc 'source .env && node scripts/scraper/run_batch.js --site site_a --runs 3 >> logs/cron.log 2>&1'
```

## 6. 回滚策略

若新改动导致成功率明显下降：

1. `git log --oneline` 找到上一稳定提交
2. 切回稳定提交并复跑 `--runs 10` 冒烟
3. 在修复分支定位具体变更再重发
