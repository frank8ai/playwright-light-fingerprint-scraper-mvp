# Playwright 轻指纹抓取系统开发文档（V1）

## 文档目标

构建从 0 到 1 的“低成本、可扩展、可观测”抓取系统，技术路线：

- Playwright（自动化引擎）
- 持久化 Context（登录态复用）
- 轻指纹注入（基础反检测）
- 代理策略（稳定性提升）
- 节奏控制（降低风控触发）

## 范围与非范围

### V1 必做

- 单站点到多站点抓取流程
- 单账号到多账号任务编排
- 登录态持久化与会话隔离
- 数据提取、清洗、去重、增量
- 失败重试、截图、结构化日志

### V1 暂不做

- 大规模分布式调度（K8s/Spark）
- 复杂可视化后台
- 高对抗型高级反检测
- 商业指纹浏览器深度集成

## 成功标准

### 功能

- 至少支持 1 站点、3 账号
- 结果结构化落盘（JSON + JSONL）

### 稳定性

- 连续 30 次任务成功率 >= 85%
- 平均单任务耗时 < 120 秒（可按站点调）
- 连续失败 >= 3 次触发告警

### 成本

- 增量抓取覆盖率 >= 90%

## 分层架构

- 执行层：`run_once` / `run_batch`
- 浏览器层：Playwright `launchPersistentContext`
- 策略层：fingerprint / proxy / pacing / retry
- 提取层：`extractors/site_*.js`
- 存储层：`data/raw`, `data/clean`, `logs`, `data/snapshots`

## 核心流程

1. 读取配置（站点、账号、代理）
2. 启动持久化 Context
3. 应用轻指纹（可开关）
4. 导航并提取字段
5. 清洗 + 去重 + 增量判断
6. 写入数据与日志
7. 异常截图 + 重试
8. 关闭 Context

## 配置规范

- `.env`：运行时参数
- `config/accounts.json`：账号 + profile + proxy 绑定
- `config/proxies.json`：代理健康与冷却字段
- `config/sites/*.json`：站点 URL / selector / wait 规则

## 依赖策略

- 仅通过 npm 安装
- `package.json` 使用明确版本
- `package-lock.json` 固化完整依赖树
- optional stealth 默认关闭，仅 feature flag 开启

## 阶段交付

### Phase 1: baseline

- Playwright 持久化 + `run_once`
- 单页提取 + raw 输出 + 基础日志

### Phase 2: fingerprint

- 接入 `@apify/fingerprint-generator` + `@apify/fingerprint-injector`
- 指纹与账号 profile 绑定

### Phase 3: optional stealth + batch

- stealth feature flag（默认 off）
- `run_batch` + 成功率统计 + 连续失败告警标记
- cron-ready 命令模板

## 验收命令

```bash
npm run phase:1
npm run phase:2
npm run phase:3
```

## 运维建议

- 每日看 `logs/error.jsonl` 的失败 TOP 原因
- 先排查代理质量，再排查 selector 变更
- 高频失败站点优先降频或加随机等待区间
