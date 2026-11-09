## Orientation

- Run, test, track and deploy: `README.md`. Domain words: `GLOSSARY.md`. Why it is built this way: `docs/adr/`. Review rules: `CODING_STANDARDS.md`.
- `src/` is pure logic with unit tests; `app.js` is the DOM; `data/` is written by the daily price job, never by hand.
- `data/stores-source.json` is git-ignored on purpose (named staff and emails). Never commit it.
- The retailer's Algolia index has traps (unreliable promo flag, `online` is filter-only): read `docs/adr/0002-price-tracking-by-daily-action.md` and use `npm run probe` before changing the crawl.
- After UI work, run `npm run shots` and look at the 390px images. After touching `style.css`, `app.js` or `src/`, run `npm run bump`.
- The agent shell cannot push (no credentials); the user runs `! git push origin main`.

## Agent skills

### Issue tracker

Issues are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
