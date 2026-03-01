# Playwright Light Fingerprint Scraper - Self-Use Stable Edition

## 1. Architecture

Single Entry -> Orchestrator -> Health Router -> Backends(A/B/C) -> Normalizer -> Cache -> Metrics/Logs

- Backend A: existing Playwright Light Fingerprint path (`run_once.js`) as primary.
- Backend B: stable Playwright profile fallback (conservative wait/timeout/pacing).
- Backend C: lightweight web-search/API fallback (`DuckDuckGo Instant Answer API` or URL snapshot fetch).

Routing default: `A -> B -> C`.

Built-in reliability controls:

- Max attempts: default `3`
- Retry backoff: default `1s -> 2s -> 4s` (+ jitter)
- Circuit breaker:
  - fail threshold: `3`
  - cooldown: `600s`
  - half-open probe with success recovery
- Cache:
  - query cache TTL: `1200s`
  - url snapshot cache TTL: `900s`

Safety hardline:

- `allowLoginAutomation=false` is enforced at config-load time.
- If set to true, process exits with safety violation.

## 2. Quick Start

```bash
cd <project-root>
npm ci
npx playwright install chromium
cp .env.example .env
```

Run self-use orchestrator once (query mode):

```bash
npm run scraper:test -- --query "openclaw monetization tools" --site site_a
```

Run in URL snapshot mode:

```bash
npm run scraper:test -- --taskType url_snapshot --url "https://example.com" --site site_a
```

Legacy direct path (no orchestrator, keep MVP behavior):

```bash
SCRAPER_LEGACY_DIRECT=true npm run scraper:test -- --taskType url_snapshot --url "https://example.com" --site site_a
```

## 3. Commands

- Dev run:
  - `npm run dev:scraper`
- Single task test:
  - `npm run scraper:test -- --query "your query"`
  - `npm run scraper:test -- --url "https://target.url" --taskType url_snapshot`
- Health check:
  - `npm run scraper:health`
- 24h report:
  - `npm run scraper:report -- --hours 24`
- Regression:
  - `npm run scraper:regression`
  - with forced A failure simulation:
    - `npm run scraper:regression -- --simulateAFailPct 40`

## 4. Output Schema

All backends are normalized to one JSON schema:

```json
{
  "requestId": "uuid",
  "status": "success|partial|failed",
  "backendUsed": "A|B|C",
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
  "metrics": {
    "latencyMs": 0,
    "attempts": 1
  },
  "error": {
    "code": "",
    "message": "",
    "type": "timeout|blocked|dom_changed|captcha|network|unknown"
  }
}
```

## 5. Config Reference

Config file: `config/self-use-scraper.json`

- `routing.order`: backend priority order
- `routing.maxAttempts`: max execution attempts for one request
- `routing.backoffMs`: retry backoff schedule
- `routing.legacyDirectEnabled`: keep legacy bypass switch
- `routing.circuitBreaker.failThreshold`: consecutive failures before open circuit
- `routing.circuitBreaker.cooldownSec`: open-circuit cooldown window
- `routing.circuitBreaker.halfOpenSuccessThreshold`: required half-open successes to close circuit

- `timeouts.pageLoadMs`: page navigation timeout target
- `timeouts.actionMs`: selector/action timeout target
- `timeouts.totalMs`: max time budget per backend attempt

- `cache.enabled`: enable/disable TTL cache
- `cache.queryTtlSec`: query cache TTL
- `cache.urlTtlSec`: URL snapshot cache TTL

- `rateLimit.minIntervalMs`: stable pacing lower bound
- `rateLimit.jitterMs`: randomized jitter for retry pacing

- `safety.allowLoginAutomation`: **must remain false**

- `paths.runtimeDir`: runtime state directory (router state)
- `paths.cacheDir`: cache directory
- `paths.metricsDir`: metrics/log directory

## 6. Logs and Metrics

- Attempts log: `logs/self-use-attempts.jsonl`
- Request summary log: `logs/self-use-requests.jsonl`
- Circuit/backend events log: `logs/self-use-events.jsonl`

Minimum observability fields include:

- `requestId`
- `taskType`
- `backend/attempt`
- `latencyMs`
- `resultCount`
- `errorType`
- `fallbackCount`
- `fromCache`

## 7. FAQ

Q: Why is `status=partial` even when request succeeds?
A: Backend C is designed as lightweight fallback and may return less-rich data than A/B.

Q: How to avoid breaking existing MVP usage?
A: Keep using `npm run scrape:once` / `npm run scrape:batch` or set `SCRAPER_LEGACY_DIRECT=true` on new entry.

Q: Why does a backend disappear from routing?
A: Circuit breaker opened due to repeated failures. Check `npm run scraper:health` and `logs/self-use-events.jsonl`.

Q: Can login automation be enabled for higher success?
A: No. This build enforces `allowLoginAutomation=false`.

## 8. Runtime Truth / TODO placeholders

- `PROJECT_PATH=<project-root>`
- `PACKAGE_MANAGER=npm`
- `NODE_VERSION=v25.5.0`
- `START_CMD=npm run dev:scraper`
- `TEST_CMD=npm run scraper:test -- --query "..."`
- `LINT_CMD=TODO (no lint script in current repo)`
- `PRIMARY_ENTRY=scripts/scraper/run_self_use.js`
- `TARGET_SITES_TOP10=TODO`
- `DAILY_REQUEST_VOLUME=TODO`
- `CONCURRENCY_EXPECTED=TODO`
- `FAILURE_LOG_PATH=logs/error.jsonl`
- `OUTPUT_EXAMPLE_PATH=docs/output-example.json`
