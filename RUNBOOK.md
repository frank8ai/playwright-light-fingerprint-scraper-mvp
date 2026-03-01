# RUNBOOK - Self-Use Stable Scraper

## Daily Checks

1. Health snapshot

```bash
npm run scraper:health
```

2. Recent report (24h)

```bash
npm run scraper:report -- --hours 24
```

3. Quick execution smoke

```bash
npm run scraper:test -- --query "playwright scraper health check"
```

## Circuit Breaker Recovery

### Automatic

- Open condition: same backend fails `>= failThreshold` (default 3).
- Cooldown: backend stays open for `cooldownSec` (default 600s).
- Half-open: after cooldown, one trial request is allowed.
- Close recovery: half-open success reaches threshold (default 1).

### Manual

- Inspect state:

```bash
cat data/runtime/health-router-state.json
```

- If emergency reset is needed (self-use only):

```bash
cp data/runtime/health-router-state.json data/runtime/health-router-state.backup.$(date +%s).json
cat > data/runtime/health-router-state.json <<'JSON'
{
  "updatedAt": "manual-reset",
  "backends": {
    "A": {"score": 100, "consecutiveFailures": 0, "circuitState": "closed", "openedAt": null, "lastFailureAt": null, "lastSuccessAt": null, "lastErrorType": "", "halfOpenTrialInFlight": false, "halfOpenSuccessCount": 0},
    "B": {"score": 100, "consecutiveFailures": 0, "circuitState": "closed", "openedAt": null, "lastFailureAt": null, "lastSuccessAt": null, "lastErrorType": "", "halfOpenTrialInFlight": false, "halfOpenSuccessCount": 0},
    "C": {"score": 100, "consecutiveFailures": 0, "circuitState": "closed", "openedAt": null, "lastFailureAt": null, "lastSuccessAt": null, "lastErrorType": "", "halfOpenTrialInFlight": false, "halfOpenSuccessCount": 0}
  }
}
JSON
```

## Failure SOP

### 1) Timeout (`error.type=timeout`)

- Check `timeouts.totalMs/pageLoadMs/actionMs` in `config/self-use-scraper.json`.
- Check target site response manually.
- If A keeps timing out, circuit breaker should move traffic to B/C automatically.
- Validate fallback is active in logs:

```bash
rg '"errorType":"timeout"|"fallbackCount":' logs/self-use-requests.jsonl logs/self-use-attempts.jsonl
```

### 2) DOM Changed (`error.type=dom_changed`)

- Update selectors in `config/sites/site_a.json`.
- Re-run single URL test:

```bash
npm run scraper:test -- --taskType url_snapshot --url "https://example.com" --site site_a
```

- If A/B still fail, C should return partial fallback data.

### 3) Captcha / Blocked (`error.type=captcha|blocked`)

- Reduce request pace: increase `rateLimit.minIntervalMs` and `jitterMs`.
- Prefer fallback chain by allowing A circuit to cool down.
- Avoid repeated aggressive retries against blocked targets.

## Rollback Options

### Phase-level rollback

- Keep using legacy commands:
  - `npm run scrape:once`
  - `npm run scrape:batch`
- Or bypass orchestrator with new entry:

```bash
SCRAPER_LEGACY_DIRECT=true npm run scraper:test -- --url "https://example.com" --taskType url_snapshot
```

### File-level rollback

- Revert specific added self-use files in one commit, leaving legacy untouched.

## Regression Command

```bash
npm run scraper:regression
```

Fallback stress mode (simulate A failures):

```bash
npm run scraper:regression -- --simulateAFailPct 40
```
