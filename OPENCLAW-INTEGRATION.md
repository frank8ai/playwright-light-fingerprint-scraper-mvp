# OpenClaw Integration Quick Guide (v2.0.3)

This guide is for wiring `playwright-light-fingerprint-scraper` into OpenClaw as a local tool.

Goal:

- return conclusions faster
- reduce downstream token usage
- keep fallback stability (`A -> B -> C`)

## 1) What This Tool Does

- Input: `query` or `url`
- Output: one unified JSON schema
- Default output mode: `compact` (token-saving)
- Full payload: written to local artifact file, returned as pointer

No login automation is implemented or allowed (`allowLoginAutomation=false`).

## 2) Local Command Contract

Project path:

- `/Users/yizhi/playwright-light-fingerprint-scraper`

Single query:

```bash
cd /Users/yizhi/playwright-light-fingerprint-scraper
npm run scraper:test -- --query "openclaw monetization tools"
```

URL snapshot:

```bash
npm run scraper:test -- --taskType url_snapshot --url "https://example.com"
```

Browser-first override (disable question pre-route):

```bash
npm run scraper:test -- --query "what is nodejs event loop" --preferBrowser true
```

Debug full inline output:

```bash
npm run scraper:test -- --query "what is nodejs event loop" --outputMode full
```

## 3) Recommended OpenClaw Usage Pattern

For each user request:

1. call this scraper command once
2. use response `summary` as primary context
3. if deeper evidence is needed, open `artifact.path` and read details
4. avoid injecting full `resultsFull` into every turn

This pattern is the main token saver.

## 4) Response Fields OpenClaw Should Read

Required fields:

- `status`
- `backendUsed`
- `fallbackCount`
- `results[]`
- `metrics.latencyMs`
- `error.type`

Token-saving fields:

- `outputMode` (`compact|full`)
- `summary`
- `artifact.path`
- `artifact.hash`

## 5) Minimal Routing Hints for Agent Logic

- If `status=success|partial`: answer using `summary` + top `results`
- If `status=failed`: surface `error.type`, then retry with:
  - `--preferBrowser true` for browser-heavy targets, or
  - a simplified query
- If `fallbackCount > 0`: mention "degraded path used" in internal trace (no need to expose to end user unless asked)

## 6) Health and Reporting Commands

Health:

```bash
npm run scraper:health
```

24h report:

```bash
npm run scraper:report -- --hours 24
```

Regression:

```bash
npm run scraper:regression -- --simulateAFailPct 40
```

## 7) Unified Output Example (trimmed)

```json
{
  "requestId": "uuid",
  "status": "success",
  "backendUsed": "A",
  "fallbackCount": 0,
  "query": "string",
  "fromCache": false,
  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string",
      "source": "domain",
      "capturedAt": "ISO-8601",
      "confidence": 0.0
    }
  ],
  "metrics": { "latencyMs": 0, "attempts": 1 },
  "error": { "code": "", "message": "", "type": "unknown" },
  "outputMode": "compact",
  "summary": "short summary text",
  "artifact": {
    "path": "/abs/path/to/artifact.json",
    "hash": "sha256",
    "resultCountFull": 3,
    "sizeBytes": 1234
  }
}
```

## 8) Non-Negotiable Safety

- `allowLoginAutomation` must remain `false`
- no account login flow automation
- no aggressive high-risk bypass behavior
