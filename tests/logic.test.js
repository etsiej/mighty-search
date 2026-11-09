import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilters, buildRequests, indexFor, stockAt, categoryFilter, categoryScope } from '../src/filters.js';
import { buildCategoryTree, visibleCategoryRows, categoryCrumbs, departmentsFromFacet, bestCategoryPath } from '../src/categories.js';
import { parseHash, serializeState, DEFAULT_STATE } from '../src/url-state.js';
import { searchStores, shortName } from '../src/stores.js';
import { esc, safeHighlight } from '../src/html.js';

const base = { ...DEFAULT_STATE, query: 'drill' };

test('default filters only require online products (no hidden nationwide filter)', () => {
    assert.equal(buildFilters(base), 'online:true');
});

test('nationwide, in stock, category and brands all combine', () => {
    const f = buildFilters({
        ...base, nationwide: true, inStock: true, storeId: 31,
        category: 'Power Tools > Drills & Impact Drivers', brands: ['Makita', 'Bosch'],
    });
    assert.equal(
        f,
        'online:true AND availableNationWide:true AND storesWithStock:31 AND ' +
        'categoryPath.lvl1:"Power Tools > Drills & Impact Drivers" AND (brandName:"Makita" OR brandName:"Bosch")',
    );
});

test('in stock without a chosen store adds no stock filter', () => {
    assert.equal(buildFilters({ ...base, inStock: true, storeId: null }), 'online:true');
});

test('quotes in values are escaped', () => {
    assert.match(buildFilters({ ...base, brands: ['A"B'] }), /brandName:"A\\"B"/);
    assert.equal(categoryFilter('A'), 'categoryPath.lvl0:"A"');
});

test('facet requests omit only their own filter', () => {
    const s = { ...base, nationwide: true, category: 'Power Tools > Drills', brands: ['Makita'] };
    const [results, cats, brands] = buildRequests(s, { hitsPerPage: 24, attributesToRetrieve: ['name'] });
    const f = (r) => new URLSearchParams(r.params).get('filters');
    assert.match(f(results), /categoryPath.lvl1:"Power Tools > Drills"/); assert.match(f(results), /Makita/);
    // category facets drop the category filter itself but stay scoped to its parent, and keep other filters
    assert.doesNotMatch(f(cats), /Drills/); assert.match(f(cats), /categoryPath.lvl0:"Power Tools"/); assert.match(f(cats), /Makita/);
    assert.match(f(brands), /categoryPath/); assert.doesNotMatch(f(brands), /Makita/);
    assert.equal(buildRequests(s, { hitsPerPage: 24, attributesToRetrieve: [], withFacets: false }).length, 1);
});

test('sort picks the replica index', () => {
    assert.equal(indexFor('price_asc'), 'retail_products_price_asc');
    assert.equal(indexFor('name'), 'retail_products_relevance');
});

test('stockAt', () => {
    assert.equal(stockAt({ storesWithStock: [31] }, 31), true);
    assert.equal(stockAt({ storesWithStock: [31] }, 80), false);
    assert.equal(stockAt({}, 31), false);
    assert.equal(stockAt({ storesWithStock: [31] }, null), null);
});

test('category tree nests by path; sidebar shows the path and what is under it', () => {
    const tree = buildCategoryTree({
        'categoryPath.lvl0': { 'Power Tools': 10, Hardware: 5 },
        'categoryPath.lvl1': { 'Power Tools > Drills': 7, 'Power Tools > Saws': 3, 'Hardware > Screws': 5 },
        'categoryPath.lvl2': { 'Power Tools > Drills > Cordless': 4 },
    });
    const names = (rows) => rows.map((n) => n.name);
    assert.deepEqual(names(tree), ['Power Tools', 'Hardware']);
    assert.deepEqual(names(tree[0].children), ['Drills', 'Saws']);
    assert.deepEqual(names(visibleCategoryRows(tree, null)), ['Power Tools', 'Hardware']);
    assert.deepEqual(names(visibleCategoryRows(tree, 'Power Tools')), ['Power Tools', 'Drills', 'Saws']);
    assert.deepEqual(names(visibleCategoryRows(tree, 'Power Tools > Drills')), ['Power Tools', 'Drills', 'Cordless']);
    // leaf: ancestors, then its siblings
    assert.deepEqual(names(visibleCategoryRows(tree, 'Power Tools > Saws')), ['Power Tools', 'Drills', 'Saws']);
    // unknown path falls back to the departments
    assert.deepEqual(names(visibleCategoryRows(tree, 'Nope > Nada')), ['Power Tools', 'Hardware']);
});

test('url state round-trips', () => {
    const s = {
        query: 'cordless drill', category: 'Power Tools > Drills', brands: ['Makita', 'Black & Decker'],
        nationwide: true, inStock: true, sort: 'price_desc', storeId: 31, product: '385304', deals: false,
    };
    assert.deepEqual(parseHash(serializeState({ ...DEFAULT_STATE, deals: true })), { ...DEFAULT_STATE, deals: true });
    assert.deepEqual(parseHash(serializeState(s)), s);
    assert.equal(serializeState(DEFAULT_STATE), '');
    assert.deepEqual(parseHash(''), DEFAULT_STATE);
    assert.equal(parseHash('#sort=bogus&store=abc').sort, 'relevance');
    assert.equal(parseHash('#store=abc').storeId, null);
});

test('store search ignores case and macrons', () => {
    const stores = [
        { id: 66, name: 'MEGA Whangārei', town: 'Whangarei', suburb: 'Morningside' },
        { id: 31, name: 'Thames', town: 'Thames', suburb: '' },
    ];
    assert.deepEqual(searchStores(stores, 'whangarei').map((s) => s.id), [66]);
    assert.deepEqual(searchStores(stores, 'WHANGĀREI').map((s) => s.id), [66]);
    assert.equal(searchStores(stores, '').length, 2);
    assert.equal(shortName(stores[0]), 'Whangārei');
});

test('html escaping', () => {
    assert.equal(esc('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
    assert.equal(safeHighlight('<em>Dr</em>ill <script>', 'x'), '<em>Dr</em>ill &lt;script&gt;');
});

test('breadcrumb crumbs carry cumulative paths', () => {
    assert.deepEqual(categoryCrumbs(null), []);
    assert.deepEqual(categoryCrumbs('Power Tools > Drills'), [
        { name: 'Power Tools', path: 'Power Tools' },
        { name: 'Drills', path: 'Power Tools > Drills' },
    ]);
});

test('departments are sorted by size and drop "Other"', () => {
    assert.deepEqual(
        departmentsFromFacet({ Other: 9, Paint: 5, Hardware: 20, Bathroom: 5 }).map((d) => d.name),
        ['Hardware', 'Bathroom', 'Paint'],
    );
});

test('browsing a category with no keyword is a valid search state', () => {
    const f = buildFilters({ ...DEFAULT_STATE, category: 'Power Tools > Drills' });
    assert.equal(f, 'online:true AND categoryPath.lvl1:"Power Tools > Drills"');
    assert.deepEqual(parseHash(serializeState({ ...DEFAULT_STATE, category: 'Paint' })).category, 'Paint');
});

test('category facet scope is the parent, or the department itself', () => {
    assert.equal(categoryScope(null), null);
    assert.equal(categoryScope('Power Tools'), 'Power Tools');
    assert.equal(categoryScope('Power Tools > Drills > Cordless'), 'Power Tools > Drills');
});

test('product category path is rebuilt from categoryNames, following the URL hierarchy', () => {
    const hit = {
        categoryNames: {
            lvl0: ['RD4004|Homeware|/shop/home-storage/homeware/c/RD4004'],
            lvl1: ['RS2073|Kitchenware|/shop/home-storage/homeware/kitchenware/c/RS2073'],
            lvl2: ['RF5226|Water Coolers & Filters|/shop/home-storage/homeware/kitchenware/water-coolers-filters/c/RF5226'],
            lvl3: ['RC49300|Hydration|/shop/home-storage/homeware/kitchenware/water-coolers-filters/hydration/c/RC49300'],
        },
    };
    assert.equal(bestCategoryPath(hit), 'Homeware > Kitchenware > Water Coolers & Filters > Hydration');
    assert.equal(bestCategoryPath({}), null);
    // a product in two departments: only the chain that belongs together is used
    const multi = {
        categoryNames: {
            lvl0: ['A|Garden|/shop/garden/c/A', 'B|Outdoor|/shop/outdoor/c/B'],
            lvl1: ['C|Lighting|/shop/outdoor/lighting/c/C'],
        },
    };
    assert.equal(bestCategoryPath(multi), 'Outdoor > Lighting');
    // a department-level product
    assert.equal(bestCategoryPath({ categoryNames: { lvl0: ['A|Paint|/shop/paint/c/A'] } }), 'Paint');
});
