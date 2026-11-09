# Coding standards

Read by the reviewer. Mechanical rules live in checks (`npm run check`, CI), not here.

- **Escape every interpolation.** A value placed into an HTML template string goes through `esc()` (or `safeHighlight()` for Algolia highlights). Product names, brands, query text, URL-hash values and fetched JSON are all untrusted.
- **Logic goes in `src/`, with a unit test.** `src/` is pure (no DOM, no `fetch`); `app.js` only reads state, calls `src/`, and touches the DOM. A bug fixed in `src/` gets a regression test in `tests/`.
- **Every interactive element gets an end-to-end test of its click path** in `tests/e2e/`. A card, tile, arrow or toggle with no test is how the deals strip shipped without a click handler.
- **New CSS works at 390px and in dark mode.** Colours come from the `:root` variables; a literal hex colour needs a matching override in the dark block. Run `npm run shots` and look at the phone images.
- **User state travels in the URL hash**, via `src/url-state.js`; My store is the exception and lives in `localStorage`, so navigation never changes it.
- **Domain words follow `GLOSSARY.md`** (Store, Nationwide, My store, In stock, List price, Deal, Tracked product).
