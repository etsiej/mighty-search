// Builds the slim stores-lite.json that the site loads from data/stores-source.json.
// Run: node scripts/build-stores.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const source = JSON.parse(readFileSync(new URL('../data/stores-source.json', import.meta.url), 'utf8'));
const stores = source.stores
    .filter((s) => s.storeDisplayFlag !== false)
    .map((s) => ({
        id: Number(s.name),
        // "<Brand> 10 Thames" -> "Thames": the site shows store names without the retailer's brand prefix
        name: String(s.displayName).replace(/^[A-Za-z]+ \d+\s+/, ''),
        town: s.address?.town || '',
        suburb: s.address?.suburb || '',
    }))
    .filter((s) => Number.isFinite(s.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-NZ'));

writeFileSync(new URL('../stores-lite.json', import.meta.url), JSON.stringify(stores));
console.log(`Wrote ${stores.length} stores`);
