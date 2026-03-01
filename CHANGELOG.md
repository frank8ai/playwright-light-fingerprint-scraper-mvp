# CHANGELOG

## v2.0.0 - 2026-03-01 - Self-Use Stable Edition

### Phase 1 - Architecture Skeleton + Contracts + Unified Interface

- Added self-use config: `config/self-use-scraper.json`.
- Added new orchestration modules under `scripts/scraper/self_use/`:
  - config loader with safety enforcement (`allowLoginAutomation=false`)
  - contracts/types (JSDoc)
  - error normalization taxonomy
  - output normalizer for unified schema
- Added new single entry: `scripts/scraper/run_self_use.js`.
- Preserved legacy path with `SCRAPER_LEGACY_DIRECT=true` switch.

Rollback:

- Use legacy scripts directly: `scrape:once`, `scrape:batch`.
- Or use `run_self_use.js` with legacy direct switch.

Risk:

- New entrypoint introduces additional decision layer; if misconfigured, request may fail before backend start.

### Phase 2 - A/B/C Adapters + Routing/Retry/Fallback

- Added backend adapters:
  - A: existing Playwright light fingerprint (`run_once.js`) wrapper
  - B: stable Playwright fallback wrapper (conservative config)
  - C: lightweight web-search/API and URL snapshot fallback
- Added health router:
  - score `0-100`
  - circuit breaker threshold and cooldown
  - half-open recovery
- Added orchestrator logic:
  - max attempts configurable (default 3)
  - retry backoff (1s/2s/4s)
  - ordered fallback A->B->C

Rollback:

- Disable orchestrator by using legacy direct switch.
- Remove newly added `self_use` folder without touching legacy implementation.

Risk:

- Backend C relies on external public API availability for fallback quality.

### Phase 3 - Cache + Metrics Logs + Health/Report Commands

- Added TTL cache with query/url buckets and `fromCache` support.
- Added structured observability logs:
  - attempts: `logs/self-use-attempts.jsonl`
  - requests: `logs/self-use-requests.jsonl`
  - events: `logs/self-use-events.jsonl`
- Added ops commands:
  - `scripts/scraper/health_check.js`
  - `scripts/scraper/report_24h.js`

Rollback:

- Turn off cache via config `cache.enabled=false`.
- Ignore new report/health commands and run legacy flow only.

Risk:

- Local file cache/state corruption can affect routing decisions (mitigated by simple JSON reset).

### Phase 4 - Regression + Docs + Command Surface

- Added regression runner: `scripts/scraper/regression_test.js`.
- Added 20-case sample set: `config/regression-cases.json`.
- Added required docs:
  - `README-SELF-USE.md`
  - `RUNBOOK.md`
  - `CHANGELOG.md`
- Updated `package.json` scripts with required commands.

Compatibility Notes:

- Existing MVP commands remain unchanged and compatible.
- Self-use orchestrator is additive and optional.

Known Issues:

- No dedicated lint/test framework exists yet in current repository.
- Regression quality depends on target-site/network stability and case realism.
