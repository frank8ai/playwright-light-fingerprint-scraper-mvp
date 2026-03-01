# Playwright Light Fingerprint Scraper v2.0 (Self-Use Stable Edition)

A stability-first scraping orchestrator built on top of the original Playwright MVP.

This `v2.0` release focuses on continuous availability for personal/agent workflows:

- Multi-backend fallback (`A -> B -> C`)
- Health routing with circuit breaker and half-open recovery
- Domain-scoped circuit breaker (backend health isolated by target domain)
- Retry with exponential backoff
- Short-term cache (`query/url` TTL)
- Compact output by default (`topN + short snippet`)
- Artifact pointer return (`summary + artifact path/hash`)
- Unified output schema across all backends
- Structured metrics and 24h report command
- Legacy direct path preserved

## Safety and Scope

Hard constraints enforced in code/config:

- No account-login automation (`allowLoginAutomation=false`, enforced at config load)
- No high-risk anti-platform bypass behavior
- Additive implementation only; legacy MVP remains runnable

## Architecture

`Single Entry -> Orchestrator -> Health Router -> Backends(A/B/C) -> Normalizer -> Cache -> Metrics/Logs`

- `A`: Existing Playwright Light Fingerprint (primary)
- `B`: Stable Playwright profile (fallback 1)
- `C`: Lightweight web/API fallback (fallback 2)

## Repository Structure

```text
scripts/scraper/
  run_once.js                 # legacy single-run
  run_batch.js                # legacy batch-run
  run_self_use.js             # v2 single entry
  health_check.js             # v2 health snapshot
  report_24h.js               # v2 24h report
  regression_test.js          # v2 regression runner
  self_use/
    orchestrator.js
    health_router.js
    cache.js
    metrics.js
    normalizer.js
    errors.js
    config.js
    adapters/
      backend_a.js
      backend_b.js
      backend_c.js
config/
  self-use-scraper.json
  regression-cases.json
README-SELF-USE.md
RUNBOOK.md
CHANGELOG.md
```

## Install

```bash
npm ci
npx playwright install chromium
cp .env.example .env
```

## Commands

Legacy (unchanged):

```bash
npm run scrape:once
npm run scrape:batch
```

v2 self-use stable:

```bash
npm run dev:scraper
npm run scraper:test -- --query "openclaw monetization tools"
npm run scraper:test -- --query "what is playwright" --outputMode compact
npm run scraper:test -- --query "what is playwright" --preferBrowser false
npm run scraper:health
npm run scraper:health -- --scope example.com
npm run scraper:report -- --hours 24
npm run scraper:regression -- --simulateAFailPct 40
```

Legacy direct switch through new entry (rollback lane):

```bash
SCRAPER_LEGACY_DIRECT=true npm run scraper:test -- --taskType url_snapshot --url "https://example.com"
```

Retry behavior note:

- In v2 hardening mode, retry is orchestrator-controlled.
- Backend adapters A/B run internal `run_once` with `maxAttempts=1` to avoid retry multiplication.
- Query pre-routing: question-like queries can be routed to backend C first to reduce browser startup cost.

Output behavior note:

- Default mode is `compact` for token savings.
- Full backend result is written to an artifact file and returned as pointer metadata (`artifact.path/hash`).
- If you need full inline response for debugging, run with `--outputMode full`.

## Unified Output Schema

All backends return one schema:

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
  },
  "outputMode": "compact|full",
  "summary": "string",
  "artifact": {
    "path": "absolute/path/to/artifact.json",
    "hash": "sha256",
    "resultCountFull": 0,
    "sizeBytes": 0
  }
}
```

## Docs

- Self-use setup and config details: `README-SELF-USE.md`
- Operations and failure SOP: `RUNBOOK.md`
- Release history and rollback notes: `CHANGELOG.md`
- Example output payload: `docs/output-example.json`

## Current v2.0 Validation Snapshot

From local regression runs (20 cases, A-failure injection enabled):

- Success rate: `100%`
- Fallback success when A fails: `100%`
- Latency: `P50 ~ 3.8s`, `P95 ~ 6.2s` (with occasional long-tail C fallback cases)

## License

MIT
