# Static site that queries the retailer's Algolia index directly

The app is plain static files hosted on a free static host (GitHub or Cloudflare Pages), with the browser calling the retailer's Algolia index directly using the search-only (`acl: ["search"]`) key their own site exposes. We rejected our own backend proxy and the OCC API: Algolia already sends `Access-Control-Allow-Origin: *`, so no proxy is needed for CORS; the OCC product search returned nothing; and Algolia is the only source of per-Store stock (`storesWithStock`). A search-only key is designed to be public, so embedding it is not a leak.

## Consequences

- All visitors' searches count against the retailer's Algolia quota, and The retailer could rotate the key or restrict origins, which would break the site. Accepted; the footer keeps the "unofficial" disclaimer.
- Stock is a snapshot from the index, not live inventory, so the UI must say so.
- `proxy.js` is deleted; `stores.json` ships as a static file.
