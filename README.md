# Mighty Search

An unofficial product search for a New Zealand hardware retailer, for people whose browser protections break the official site's search. It is a static site: the browser queries the retailer's Algolia index directly (see `docs/adr/0001-static-site-direct-algolia.md`).

- Pick **your store** (top right) to see what is in stock there. Stock is a snapshot, not live inventory.
- Browse by department like the official site, or search; both are shareable links (the state lives in the URL hash).
- **Deals** and a **price tracker** on every product page. Prices are recorded daily for products that have been on a real discount (promo price below list price), so a product's history starts the day it is first seen on a deal.

## Develop

    npm install        # dev tools (jsdom, esbuild) and the pre-commit hook
    npm start          # serve at http://localhost:8080 (ES modules need http, not file://)
    npm test           # unit tests: filters, categories, URL state, price history, chart
    npm run test:e2e   # boots the real page in jsdom against the LIVE Algolia API (slower; needs network)
    npm run shots      # screenshots to .shots/ at phone/desktop, light/dark; look at them
    npm run probe -- 'online:true AND prices.nationalPromo > 0' --facets brandName
    npm run check      # what the pre-commit hook and CI run

The pre-commit hook runs the cache-bust check and the unit tests; skip once with `git commit --no-verify`. CI (`.github/workflows/ci.yml`) runs the same on every push and PR. The end-to-end suite is a manual workflow ("End-to-end (live API)" in the Actions tab) because it depends on the retailer's live index.

## Price tracking

`.github/workflows/track-prices.yml` runs `scripts/track-prices.mjs` every day at 12:00 UTC (1am NZDT, midnight NZST), then commits `data/history/*.json`, `data/history/meta.json` and `data/deals.json`. GitHub Pages republishes automatically. Run it by hand from the repo's **Actions** tab ("Run workflow") or locally:

    node scripts/track-prices.mjs --dry    # fetch and report, write nothing
    node scripts/track-prices.mjs          # update data/

See `docs/adr/0002-price-tracking-by-daily-action.md` for why it works this way.

## Update store list

`data/stores-source.json` is the full store export from the retailer's store API. It is **not committed** (it contains named staff and contact emails); keep your own local copy. After changing it:

    npm run build:stores    # regenerates stores-lite.json

## Deploy

Publish the repo root on GitHub Pages or Cloudflare Pages (no build step). Only these need to be served: `index.html`, `app.js`, `style.css`, `src/`, `stores-lite.json`, `data/`.

Browsers cache files for about 10 minutes on GitHub Pages. After changing `style.css`, `app.js` or `src/`, run `npm run bump` (increments the `?v=` on their links in `index.html`); the pre-commit hook and CI fail if you forget. Known limit: `src/*.js` imports are unversioned, so a returning visitor can briefly mix a new `app.js` with cached older `src/` files for up to 10 minutes after a deploy.
