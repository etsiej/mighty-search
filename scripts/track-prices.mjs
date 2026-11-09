// Daily price tracker. Run: node scripts/track-prices.mjs [--dry] [--date YYYY-MM-DD]
//
// 1. Refresh today's prices for every product we already track.
// 2. Discover products that now carry a promo price and start tracking them.
// 3. Append a change point to a product's history only when its prices change.
// 4. Write data/deals.json (everything currently genuinely discounted) and data/history/meta.json.
//
// Only products that have been on a deal are tracked, so the catalogue builds up over time.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { SHARDS, shardOf, isDeal, recordPrice, judgeDeal } from '../src/price-history.js';

const ALGOLIA = {
    app: 'CQ00O09OXX',
    key: 'edc61cb5be5216c9cc02459f13e33729', // public search-only key (docs/adr/0001)
    host: 'cq00o09oxx-dsn.algolia.net',
    index: 'retail_products_relevance',
};
const DIMS = ['categoryPath.lvl0', 'categoryPath.lvl1', 'categoryPath.lvl2', 'categoryPath.lvl3', 'brandName'];
const PRICE_ATTRS = ['prices.nationalRRP', 'prices.nationalPromo'];
const DISCOVERY_FILTER = 'online:true AND prices.nationalPromo > 0';
const MIN_COVERAGE = 0.98;
const root = new URL('../', import.meta.url);

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
const today = dateArg || new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());

// ---------- Algolia ----------
async function algolia(path, body, attempt = 0) {
    const res = await fetch(`https://${ALGOLIA.host}${path}`, {
        method: 'POST',
        headers: { 'X-Algolia-API-Key': ALGOLIA.key, 'X-Algolia-Application-Id': ALGOLIA.app, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
        if (attempt >= 5) throw new Error(`Algolia ${res.status} after retries`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        return algolia(path, body, attempt + 1);
    }
    if (!res.ok) throw new Error(`Algolia ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

const search = (filters, facets = []) =>
    algolia(`/1/indexes/${ALGOLIA.index}/query`, {
        query: '', hitsPerPage: 1000, filters, facets, maxValuesPerFacet: 1000,
        attributesToRetrieve: PRICE_ATTRS, attributesToHighlight: [], attributesToSnippet: [],
    });

/** Every product matching DISCOVERY_FILTER, sliced by category/brand so each query stays under Algolia's 1000-result cap. */
async function discoverPromos() {
    const found = new Map();
    let truncated = 0;
    async function slice(constraints, dimIndex) {
        const filters = [DISCOVERY_FILTER, ...constraints].join(' AND ');
        const dim = DIMS[dimIndex];
        const res = await search(filters, dim ? [dim] : []);
        if (res.nbHits <= 1000) {
            for (const h of res.hits) found.set(h.objectID, h.prices);
            return;
        }
        if (!dim) {
            // Still over Algolia's 1000-result window and nothing left to slice by: bisect on the record timestamp.
            truncated += await bisect(filters, 0, 1e13);
            return;
        }
        const values = Object.keys(res.facets?.[dim] || {});
        await Promise.all(values.map((v) => slice([...constraints, `${dim}:"${v.replace(/"/g, '\\"')}"`], dimIndex + 1)));
        // products with no value for this dimension would be missed above; sweep them up
        const rest = await search([filters, ...values.map((v) => `NOT ${dim}:"${v.replace(/"/g, '\\"')}"`)].join(' AND '));
        for (const h of rest.hits) found.set(h.objectID, h.prices);
    }
    /** Collect everything matching `filters` whose timestamp is in (lo, hi]; returns how many could not be collected. */
    async function bisect(filters, lo, hi) {
        const res = await search(`${filters} AND timestamp > ${lo} AND timestamp <= ${hi}`);
        if (res.nbHits <= 1000) {
            for (const h of res.hits) found.set(h.objectID, h.prices);
            return 0;
        }
        if (hi - lo <= 1) return res.nbHits - res.hits.length; // identical timestamps: cannot split further
        const mid = Math.floor((lo + hi) / 2);
        return (await bisect(filters, lo, mid)) + (await bisect(filters, mid, hi));
    }
    const total = (await search(DISCOVERY_FILTER)).nbHits;
    await slice([], 0);
    return { found, total, truncated };
}

/** Current prices for specific products. Missing/removed products are simply absent from the result. */
async function fetchPrices(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500);
        const res = await algolia('/1/indexes/*/objects', {
            requests: batch.map((objectID) => ({ indexName: ALGOLIA.index, objectID, attributesToRetrieve: PRICE_ATTRS })),
        });
        res.results.forEach((r, k) => { if (r?.prices) out.set(batch[k], r.prices); });
    }
    return out;
}

// ---------- Storage ----------
const shardPath = (n) => new URL(`data/history/${String(n).padStart(3, '0')}.json`, root);

function loadHistory() {
    const shards = Array.from({ length: SHARDS }, (_, n) => {
        const p = shardPath(n);
        return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
    });
    return shards;
}

/** One product per line keeps git diffs small and readable. */
function writeShard(n, obj) {
    const ids = Object.keys(obj).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const body = ids.map((id) => `${JSON.stringify(id)}:${JSON.stringify(obj[id])}`).join(',\n');
    writeFileSync(shardPath(n), `{\n${body}\n}\n`);
}

// ---------- Main ----------
const shards = loadHistory();
const trackedIds = shards.flatMap((s) => Object.keys(s));
console.log(`Date ${today}. Tracking ${trackedIds.length} products.`);

const { found, total, truncated } = await discoverPromos();
const coverage = total ? found.size / total : 1;
console.log(`Discovery: ${found.size}/${total} products with a promo price (${(coverage * 100).toFixed(1)}%)${truncated ? `, ${truncated} truncated` : ''}.`);
if (coverage < MIN_COVERAGE) {
    console.error(`Coverage below ${MIN_COVERAGE * 100}%; refusing to write partial data.`);
    process.exit(1);
}

const current = await fetchPrices(trackedIds.filter((id) => !found.has(id)));
for (const [id, prices] of found) current.set(id, prices);

let added = 0, changed = 0;
const touched = new Set();
for (const [id, prices] of current) {
    const rrp = prices.nationalRRP ?? null;
    const promo = prices.nationalPromo ?? null;
    if (rrp == null) continue;
    const n = shardOf(id);
    const before = shards[n][id];
    if (!before && !isDeal(rrp, promo)) continue; // only start tracking on a real discount
    const after = recordPrice(before, today, rrp, promo);
    if (after !== before) {
        shards[n][id] = after;
        touched.add(n);
        before ? changed++ : added++;
    }
}
console.log(`Newly tracked: ${added}. Price changes recorded: ${changed}.`);

// deals.json: currently discounted tracked products, biggest discount first
const deals = [];
for (const s of shards) {
    for (const [id, history] of Object.entries(s)) {
        const [, rrp, promo] = history[history.length - 1];
        // Must also have been found by today's discovery pass, so removed/offline products never linger as deals.
        if (!isDeal(rrp, promo) || !found.has(id)) continue;
        const verdict = judgeDeal(history, today);
        deals.push([id, rrp, promo, Math.round((1 - promo / rrp) * 100), verdict.kind]);
    }
}
deals.sort((a, b) => b[3] - a[3] || (b[1] - b[2]) - (a[1] - a[2]) || a[0].localeCompare(b[0], 'en', { numeric: true }));
const trackedNow = shards.reduce((n, s) => n + Object.keys(s).length, 0);
const meta = { lastRun: today, tracked: trackedNow, deals: deals.length, shards: SHARDS };
console.log(`Deals now: ${deals.length}. Tracked total: ${trackedNow}.`);

if (dry) { console.log('--dry: nothing written.'); process.exit(0); }
mkdirSync(new URL('data/history/', root), { recursive: true });
for (const n of touched) writeShard(n, shards[n]);
writeFileSync(new URL('data/deals.json', root), JSON.stringify(deals) + '\n');
writeFileSync(new URL('data/history/meta.json', root), JSON.stringify(meta) + '\n');
console.log(`Wrote ${touched.size} shard file(s), deals.json, meta.json.`);
