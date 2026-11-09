// Ask the retailer's Algolia index a question without writing throwaway code.
//   node scripts/probe.mjs 'online:true AND prices.nationalPromo > 0' --facets categoryPath.lvl0,brandName --hits 3
//   node scripts/probe.mjs --query drill --hits 5 --index retail_products_price_asc
const args = process.argv.slice(2);
const flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const filters = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) || 'online:true';
const index = flag('--index', 'retail_products_relevance');
const body = {
    query: flag('--query', ''), filters, hitsPerPage: Number(flag('--hits', 3)),
    facets: flag('--facets', '') ? flag('--facets').split(',') : [], maxValuesPerFacet: 1000,
    attributesToRetrieve: ['name', 'brandName', 'prices.nationalRRP', 'prices.nationalPromo', 'timestamp'],
    attributesToHighlight: [],
};
const res = await fetch(`https://cq00o09oxx-dsn.algolia.net/1/indexes/${index}/query`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'X-Algolia-API-Key': 'edc61cb5be5216c9cc02459f13e33729', 'X-Algolia-Application-Id': 'CQ00O09OXX', 'Content-Type': 'application/json' },
});
const data = await res.json();
if (!res.ok) { console.error(res.status, data.message); process.exit(1); }
console.log(`${index}  filters: ${filters}\nnbHits: ${data.nbHits}`);
for (const [facet, values] of Object.entries(data.facets || {})) {
    const top = Object.entries(values).sort((a, b) => b[1] - a[1]);
    console.log(`\n${facet} (${top.length} values)`);
    top.slice(0, 8).forEach(([v, n]) => console.log(`  ${String(n).padStart(6)}  ${v}`));
}
if (data.hits.length) console.log('\nhits');
for (const h of data.hits) console.log(`  ${h.objectID}  ${h.name}  (${h.brandName ?? '-'})  rrp ${h.prices?.nationalRRP}  promo ${h.prices?.nationalPromo}`);
