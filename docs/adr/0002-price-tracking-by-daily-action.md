# Price history comes from a daily GitHub Action that commits JSON, and only tracks products that have been on a deal

Algolia only exposes current prices, so history has to be recorded by us. A scheduled GitHub Action (12:00 UTC, about 1am NZ) reads the retailer's public Algolia index, appends a change point to a product's history only when its prices change, and commits the files in `data/` so Pages serves them statically. We rejected a backend or database (breaks ADR 0001's "static site, nothing to run") and tracking all ~109k products (a much larger crawl and repo for little extra value, since "is this really a deal?" only matters for discounted products). Instead a product is tracked from the first day it carries a real discount (`prices.nationalPromo` below `prices.nationalRRP`), and the tracked set grows over time.

## Consequences

- A product's history starts the day we first see it on a deal, so we cannot say what it cost before then; judgements are only as good as the days tracked (see `MIN_DAYS_TO_JUDGE`).
- `prices.onNationalPromo` is unreliable (it missed real discounts), so discovery filters on `prices.nationalPromo > 0` and keeps only genuine discounts; "Everyday Low Price" items (promo equals list price) are ignored.
- Algolia returns at most 1000 hits per query, so discovery slices by category, then brand, then bisects on `timestamp`.
- Prices are national; individual stores may price differently.
- The history is only as continuous as the Action: GitHub pauses scheduled workflows on repos with no activity for 60 days, but the daily commits keep it active.
