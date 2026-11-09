import { buildRequests, stockAt, FACET_INDEX } from './src/filters.js';
import { buildCategoryTree, visibleCategoryRows, categoryCrumbs, departmentsFromFacet, bestCategoryPath } from './src/categories.js';
import { DEFAULT_STATE, parseHash, serializeState } from './src/url-state.js';
import { searchStores, findStore, shortName } from './src/stores.js';
import { esc, safeHighlight } from './src/html.js';
import { shardFile, isDeal, recordPrice, judgeDeal, chartSeries, daysBetween } from './src/price-history.js';
import { renderPriceChart } from './src/chart.js';

// Public, search-only Algolia key (the same one the retailer's own site ships). See docs/adr/0001.
const SITE_NAME = 'Mighty Search';

const CONFIG = {
    ALGOLIA_APP_ID: 'CQ00O09OXX',
    ALGOLIA_API_KEY: 'edc61cb5be5216c9cc02459f13e33729',
    ALGOLIA_HOST: 'cq00o09oxx-dsn.algolia.net',
    IMAGE_BASE: 'https://www.mitre10.co.nz',
    HITS_PER_PAGE: 24,
    SEARCH_DELAY: 300,
    STORE_KEY: 'mightysearch.store',
    ATTRIBUTES: [
        'name', 'brandName', 'prices', 'images', 'url', 'id', 'objectID', 'categoryNames',
        'deliveryCode', 'availableNationWide', 'clickAndCollect', 'homeDelivery',
        'storesWithStock', 'timestamp', 'legacySKU', 'weightOfProduct', 'weightUOM',
    ],
};

// ===== State =====
let s = { ...DEFAULT_STATE, brands: [] }; // search state; mirrored in location.hash
let stores = [];
let page = 0;
let totalHits = 0;
let searchToken = 0;
let renderedKey = null; // search state the results grid currently shows
const hitCache = new Map();
const facets = { categories: null, brands: {} };
let deals = []; // [id, rrp, promo, pct, kind], biggest discount first (data/deals.json)
let trackerMeta = null; // data/history/meta.json
const shardCache = new Map(); // shard file -> Promise<{id: history}>
const nzToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
let debounceTimer = null;
let dealsReady = Promise.resolve();
let dealsStripHits = []; // hits behind the home deals strip, re-rendered when the store changes
let stripPaused = false;
let renderedStripStore; // store the deals strip was last drawn for
let savedScroll = 0; // scroll position to restore when coming back from a product
let wantRestore = false; // set only for a genuine Back (button or browser), so other navigation starts at the top

const $ = (id) => document.getElementById(id);
const el = {
    searchInput: $('searchInput'), clearBtn: $('clearBtn'),
    resultsView: $('resultsView'), productView: $('productView'), emptyState: $('emptyState'),
    resultsTitle: $('resultsTitle'), resultsCount: $('resultsCount'), resultsGrid: $('resultsGrid'),
    loadMoreContainer: $('loadMoreContainer'), loadMoreBtn: $('loadMoreBtn'),
    sortSelect: $('sortSelect'), filterNationwide: $('filterNationwide'), filterInStock: $('filterInStock'),
    inStockLabel: $('inStockLabel'), backBtn: $('backBtn'), productDetail: $('productDetail'),
    categoryTree: $('categoryTree'), brandList: $('brandList'),
    clearCategories: $('clearCategories'), clearBrands: $('clearBrands'),
    storePicker: $('storePicker'), storeBtn: $('storeBtn'), storeLabel: $('storeLabel'),
    storePanel: $('storePanel'), storeSearch: $('storeSearch'), storeList: $('storeList'),
    storeClear: $('storeClear'), stockAsOf: $('stockAsOf'),
    breadcrumb: $('breadcrumb'), productBreadcrumb: $('productBreadcrumb'), departments: $('departments'), departmentGrid: $('departmentGrid'),
    dealsHome: $('dealsHome'), dealsStrip: $('dealsStrip'), seeAllDeals: $('seeAllDeals'),
    dealsPrev: $('dealsPrev'), dealsNext: $('dealsNext'),
    filterToggle: $('filterToggle'), filtersDone: $('filtersDone'),
};

// ===== Helpers =====
const money = (n) => `$${Number(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const imageUrl = (path) => (path ? CONFIG.IMAGE_BASE + path : '');
const myStore = () => (s.storeId != null ? findStore(stores, s.storeId) : null);
const stateKey = () => serializeState({ ...s, product: null });

function priceHtml(prices, cls) {
    const rrp = prices?.nationalRRP;
    const promo = prices?.nationalPromo;
    if (!rrp && !promo) return '';
    const onPromo = promo && rrp && promo < rrp;
    return `<div class="${cls}">${onPromo ? `<span class="original-price">${money(rrp)}</span>` : ''}${money(onPromo ? promo : rrp || promo)}</div>`;
}

function discountBadge(prices) {
    const rrp = prices?.nationalRRP, promo = prices?.nationalPromo;
    return isDeal(rrp, promo) ? `<span class="deal-badge">-${Math.round((1 - promo / rrp) * 100)}%</span>` : '';
}

function stockBadge(hit) {
    const store = myStore();
    if (!store) return '';
    const inStock = stockAt(hit, store.id);
    return `<span class="stock-badge ${inStock ? 'in' : 'out'}">${inStock ? 'In stock' : 'Not in stock'} at ${esc(shortName(store))}</span>`;
}

function showView(name) {
    el.resultsView.style.display = name === 'results' ? 'block' : 'none';
    el.productView.style.display = name === 'product' ? 'block' : 'none';
    el.emptyState.style.display = name === 'empty' ? 'block' : 'none';
}

// ===== Algolia =====
async function algolia(path, options = {}) {
    const response = await fetch(`https://${CONFIG.ALGOLIA_HOST}${path}`, {
        ...options,
        headers: {
            'X-Algolia-API-Key': CONFIG.ALGOLIA_API_KEY,
            'X-Algolia-Application-Id': CONFIG.ALGOLIA_APP_ID,
            'Content-Type': 'application/json',
        },
    });
    if (!response.ok) throw new Error(`Algolia ${response.status}`);
    return response.json();
}

async function multiQuery(requests) {
    const data = await algolia('/1/indexes/*/queries', { method: 'POST', body: JSON.stringify({ requests }) });
    return data.results;
}

// ===== URL state =====
function writeHash({ push = false } = {}) {
    const hash = serializeState(s);
    if (hash === location.hash) return;
    const url = location.pathname + location.search + hash;
    if (push) history.pushState({ fromApp: true }, '', url);
    else history.replaceState(history.state, '', url);
}

function loadStoredStore() {
    try {
        const v = Number(localStorage.getItem(CONFIG.STORE_KEY));
        return Number.isFinite(v) && v > 0 ? v : null;
    } catch { return null; }
}

function saveStore(id) {
    try {
        if (id == null) localStorage.removeItem(CONFIG.STORE_KEY);
        else localStorage.setItem(CONFIG.STORE_KEY, String(id));
    } catch { /* storage unavailable (private mode etc.) */ }
}

function stateFromLocation() {
    const parsed = parseHash(location.hash);
    if (parsed.storeId == null) parsed.storeId = loadStoredStore();
    if (parsed.storeId != null && !findStore(stores, parsed.storeId)) parsed.storeId = null;
    if (parsed.storeId == null) parsed.inStock = false;
    return parsed;
}

// ===== Controller =====
/** Make the page reflect state `s`. */
async function refresh() {
    const restore = wantRestore;
    wantRestore = false;
    syncControls();
    if (s.product) {
        showView('product');
        await showProduct(s.product);
        return;
    }
    el.resultsView.classList.toggle('deals-mode', s.deals);
    if (s.deals) {
        showView('results');
        if (renderedKey === stateKey()) restoreScroll(restore);
        else await runDeals(0);
        return;
    }
    if (!s.query && !s.category) { // home: nothing to search or browse yet
        renderedKey = null;
        searchToken++;
        showView('empty');
        restoreScroll(restore);
        return;
    }
    showView('results');
    if (renderedKey === stateKey()) { restoreScroll(restore); return; } // coming back from a product: grid is already right
    await runSearch(0);
}

function restoreScroll(restore) {
    const y = savedScroll;
    savedScroll = 0;
    if (restore && y) requestAnimationFrame(() => window.scrollTo(0, y));
}

function change(patch, { push = false, resetFilters = false } = {}) {
    if (push && patch.product) savedScroll = window.scrollY; // remember where we were in the list
    else if (push) window.scrollTo(0, 0); // new page (department, deals): start at the top
    s = { ...s, ...patch };
    if (resetFilters) { s.category = null; s.brands = []; }
    writeHash({ push });
    refresh();
}

function syncControls() {
    if (document.activeElement !== el.searchInput) el.searchInput.value = s.query;
    el.clearBtn.style.display = s.query ? 'block' : 'none';
    el.sortSelect.value = s.sort;
    el.filterNationwide.checked = s.nationwide;
    const hasStore = s.storeId != null;
    el.filterInStock.disabled = !hasStore;
    el.filterInStock.checked = hasStore && s.inStock;
    el.inStockLabel.title = hasStore ? '' : 'Choose a store to filter by stock';
    const store = myStore();
    el.storeLabel.textContent = store ? shortName(store) : 'Choose store';
    el.storeClear.hidden = !store;
    el.clearCategories.style.display = s.category ? 'block' : 'none';
    el.clearBrands.style.display = s.brands.length ? 'block' : 'none';
    renderDealsStrip();
    document.title = s.product ? `Product – ${SITE_NAME}`
        : s.deals ? `Deals – ${SITE_NAME}`
        : s.query ? `${s.query} – ${SITE_NAME}`
        : s.category ? `${s.category.split(' > ').pop()} – ${SITE_NAME}`
        : SITE_NAME;
}

async function runSearch(pageNumber) {
    const token = ++searchToken;
    const key = stateKey();
    page = pageNumber;
    if (pageNumber === 0) {
        el.resultsGrid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        el.loadMoreContainer.style.display = 'none';
    } else {
        el.loadMoreBtn.disabled = true;
        el.loadMoreBtn.textContent = 'Loading…';
    }
    let moreFailed = false;
    try {
        const results = await multiQuery(buildRequests(s, {
            page: pageNumber,
            hitsPerPage: CONFIG.HITS_PER_PAGE,
            attributesToRetrieve: CONFIG.ATTRIBUTES,
            withFacets: pageNumber === 0,
        }));
        if (token !== searchToken) return; // a newer search superseded this one
        if (pageNumber === 0) {
            facets.categories = results[1].facets || {};
            facets.brands = results[2].facets?.brandName || {};
            renderCategoryTree();
            renderBrandList();
        }
        renderResults(results[0], pageNumber > 0);
        renderedKey = key;
    } catch (err) {
        if (token !== searchToken) return;
        console.error('Search error:', err);
        if (pageNumber > 0) { // keep what is already on screen
            moreFailed = true;
            el.loadMoreBtn.textContent = "Couldn't load more - tap to retry";
            return;
        }
        renderedKey = null;
        el.resultsGrid.innerHTML = `
            <div class="grid-message">
                <h3>Search failed</h3>
                <p>The search service didn't respond. <button class="btn-link" id="retryBtn">Try again</button></p>
            </div>`;
        $('retryBtn').addEventListener('click', () => runSearch(pageNumber));
    } finally {
        el.loadMoreBtn.disabled = false;
        if (!moreFailed) el.loadMoreBtn.textContent = 'Load More Results';
    }
}

// ===== Rendering: results =====
function cardHtml(hit) {
    const image = imageUrl(hit.images?.img300Wx300H);
    const brand = hit.brandName || '';
    const id = hit.objectID || hit.id;
    return `
        <div class="product-card" data-id="${esc(id)}" tabindex="0" role="link">
            <div class="card-image">${discountBadge(hit.prices)}${image
                ? `<img src="${esc(image)}" alt="${esc(hit.name)}" loading="lazy">`
                : '<span class="no-image">No image</span>'}</div>
            <div class="card-body">
                ${brand ? `<div class="card-brand">${esc(brand)}</div>` : ''}
                <div class="card-name">${safeHighlight(hit._highlightResult?.name?.value, hit.name)}</div>
                ${priceHtml(hit.prices, 'card-price')}
                <div class="card-delivery">
                    ${stockBadge(hit)}
                    ${hit.clickAndCollect?.length ? '<span class="delivery-badge cc">Click &amp; Collect</span>' : ''}
                    ${hit.homeDelivery?.length ? '<span class="delivery-badge hd">Home Delivery</span>' : ''}
                </div>
            </div>
        </div>`;
}

function renderResults(result, append) {
    const hits = result.hits || [];
    totalHits = result.nbHits || 0;
    hits.forEach((h) => hitCache.set(String(h.objectID || h.id), h));

    const crumbs = categoryCrumbs(s.category);
    el.resultsTitle.textContent = s.deals ? 'Deals' : s.query ? `Results for "${s.query}"` : crumbs[crumbs.length - 1].name;
    renderBreadcrumb(crumbs);
    el.filtersDone.textContent = `Show ${totalHits.toLocaleString('en-NZ')} products`;
    el.resultsCount.textContent = s.deals
        ? `${totalHits.toLocaleString('en-NZ')} products currently below their list price`
        : `${totalHits.toLocaleString('en-NZ')} products found`;
    if (!append) {
        const newest = Math.max(0, ...hits.map((h) => h.timestamp || 0));
        el.stockAsOf.textContent = myStore() && newest
            ? ` · stock data as of ${new Date(newest).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : '';
    }

    if (!append && !hits.length) {
        el.resultsGrid.innerHTML = `
            <div class="grid-message">
                <h3>No products found</h3>
                <p>Try a different search term, or clear some filters.</p>
            </div>`;
        el.loadMoreContainer.style.display = 'none';
        return;
    }
    const html = hits.map(cardHtml).join('');
    if (append) el.resultsGrid.insertAdjacentHTML('beforeend', html);
    else el.resultsGrid.innerHTML = html;

    const shown = el.resultsGrid.querySelectorAll('.product-card').length;
    const more = s.deals ? (page + 1) * CONFIG.HITS_PER_PAGE < totalHits : shown < totalHits;
    el.loadMoreContainer.style.display = more ? 'block' : 'none';
}

const HOME_ICON = '<svg class="crumb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>';

/**
 * "All departments › Power Tools › Drills". Every step is a button that goes to that level;
 * the last one is plain bold text when it is the page you are already on.
 */
function breadcrumbHtml(crumbs, { currentLast }) {
    const items = [{ name: 'All departments', path: '', home: true }, ...crumbs];
    return `<ol>${items.map((c, i) => {
        const isCurrent = currentLast && i === items.length - 1;
        const inner = `${c.home ? HOME_ICON : ''}<span>${esc(c.name)}</span>`;
        return `<li>${isCurrent
            ? `<span class="crumb crumb-current" aria-current="page">${inner}</span>`
            : `<button type="button" class="crumb" data-path="${esc(c.path)}">${inner}</button>`}</li>`;
    }).join('')}</ol>`;
}

function renderBreadcrumb(crumbs) {
    if (s.deals) { // "All departments › Deals"
        el.breadcrumb.innerHTML = breadcrumbHtml([{ name: 'Deals', path: '#deals' }], { currentLast: true });
        el.breadcrumb.hidden = false;
        return;
    }
    el.breadcrumb.innerHTML = breadcrumbHtml(crumbs, { currentLast: true });
    el.breadcrumb.hidden = !s.category;
}

function renderProductBreadcrumb(hit) {
    const path = bestCategoryPath(hit);
    el.productBreadcrumb.innerHTML = path ? breadcrumbHtml(categoryCrumbs(path), { currentLast: false }) : '';
    el.productBreadcrumb.hidden = !path;
}

// ===== Rendering: home =====
async function loadDepartments() {
    try {
        const [res] = await multiQuery([{
            indexName: FACET_INDEX,
            params: new URLSearchParams({
                query: '', hitsPerPage: '0', filters: 'online:true',
                facets: JSON.stringify(['categoryPath.lvl0']), maxValuesPerFacet: '100',
            }).toString(),
        }]);
        const departments = departmentsFromFacet(res.facets?.['categoryPath.lvl0']);
        if (!departments.length) return;
        el.departmentGrid.innerHTML = departments.map((d) => `
            <button type="button" class="department-tile" data-path="${esc(d.name)}">
                <span class="department-name">${esc(d.name)}</span>
                <span class="department-count">${d.count.toLocaleString('en-NZ')} products</span>
            </button>`).join('');
        el.departments.hidden = false;
    } catch (err) {
        console.error('Could not load departments:', err); // home just stays minimal
    }
}

// ===== Rendering: sidebar =====
function renderCategoryTree() {
    const roots = buildCategoryTree(facets.categories || {});
    const rows = visibleCategoryRows(roots, s.category);
    el.categoryTree.innerHTML = rows.map((n) => `
        <div class="category-item ${s.category === n.path ? 'active' : ''}" data-path="${esc(n.path)}" data-level="${n.depth}">
            ${'<span class="indent"></span>'.repeat(n.depth + 1)}
            <span class="name">${esc(n.name)}</span>
            <span class="count">${n.count.toLocaleString('en-NZ')}</span>
        </div>`).join('');
}

function renderBrandList() {
    const entries = Object.entries(facets.brands).sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const brand of s.brands) { // keep selected brands visible even at zero results
        if (!entries.some(([name]) => name === brand)) entries.push([brand, 0]);
    }
    el.brandList.innerHTML = entries.map(([brand, count]) => {
        const active = s.brands.includes(brand);
        return `
            <label class="brand-item ${active ? 'active' : ''}">
                <input type="checkbox" ${active ? 'checked' : ''} data-brand="${esc(brand)}">
                <span class="name">${esc(brand)}</span>
                <span class="count">${count.toLocaleString('en-NZ')}</span>
            </label>`;
    }).join('');
}

// ===== Rendering: product detail =====
async function showProduct(id) {
    let hit = hitCache.get(String(id));
    if (!hit) {
        el.productDetail.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        try {
            hit = await algolia(`/1/indexes/${FACET_INDEX}/${encodeURIComponent(id)}`);
            hitCache.set(String(id), hit);
        } catch {
            el.productDetail.innerHTML = '<div class="grid-message"><h3>Product not found</h3></div>';
            return;
        }
    }
    if (s.product !== id) return;
    renderProductDetail(hit);
    renderProductBreadcrumb(hit);
    document.title = `${hit.name || 'Product'} – ${SITE_NAME}`;
    window.scrollTo({ top: 0 });
}

function stockSection(hit) {
    const store = myStore();
    const ids = (hit.storesWithStock || []).map(Number);
    const names = ids.map((i) => findStore(stores, i)).filter(Boolean)
        .sort((a, b) => (a.id === store?.id ? -1 : b.id === store?.id ? 1 : a.name.localeCompare(b.name)));
    const asOf = hit.timestamp ? new Date(hit.timestamp).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

    const headline = store
        ? `<p class="stock-headline ${ids.includes(store.id) ? 'in' : 'out'}">${ids.includes(store.id) ? 'In stock' : 'Not in stock'} at ${esc(store.name)}</p>`
        : '<p class="stock-headline">Choose a store (top right) to see whether it is in stock near you.</p>';
    const list = names.length
        ? `<details class="stock-stores"><summary>In stock at ${names.length} store${names.length === 1 ? '' : 's'}</summary>
               <ul>${names.map((n) => `<li${n.id === store?.id ? ' class="mine"' : ''}>${esc(n.name)}</li>`).join('')}</ul></details>`
        : '<p class="stock-none">No stores currently list this product in stock.</p>';
    return `
        <div class="stock-section">
            ${headline}${list}
            <p class="stock-note">Stock levels are a snapshot${asOf ? ` from ${esc(asOf)}` : ''}, not live inventory. Check with the store before you travel.</p>
        </div>`;
}

function renderProductDetail(hit) {
    const image = imageUrl(hit.images?.img515Wx515H);
    const name = hit.name || '';
    const brand = hit.brandName || '';
    const weight = hit.weightOfProduct ? `${hit.weightOfProduct} ${hit.weightUOM || ''}` : '';
    const row = (label, value) => value ? `<div class="meta-row"><span class="meta-label">${label}</span><span class="meta-value">${esc(value)}</span></div>` : '';

    el.productDetail.innerHTML = `
        <div class="detail-image">${image
            ? `<img src="${esc(image)}" alt="${esc(name)}">`
            : '<span class="no-image">No image</span>'}</div>
        <div class="detail-info">
            ${brand ? `<div class="detail-brand">${esc(brand)}</div>` : ''}
            <h1>${esc(name)}</h1>
            ${priceHtml(hit.prices, 'detail-price')}
            <p class="price-note">Indicative price only. Confirm with the store before you buy.</p>
            ${stockSection(hit)}
            <section class="tracker" id="tracker" aria-labelledby="trackerHeading">
                <h2 id="trackerHeading">Price tracker</h2>
                <div id="trackerBody"><div class="loading"><div class="spinner"></div></div></div>
            </section>
            <div class="detail-meta">
                ${row('Delivery', hit.homeDelivery?.length ? 'Home Delivery Available' : hit.clickAndCollect?.length ? 'Click & Collect Only' : '')}
                ${row('Click & Collect', hit.clickAndCollect?.length ? `${hit.clickAndCollect.length} stores` : '')}
                ${row('Nationwide', hit.availableNationWide ? 'Yes' : 'No')}
                ${row('Weight', weight)}
                ${row('SKU', hit.legacySKU)}
            </div>
            <div class="detail-actions">
                <a href="${esc(CONFIG.IMAGE_BASE + (hit.url || ''))}" target="_blank" rel="noopener" class="btn-primary">View on the retailer's site</a>
                <button class="btn-secondary" id="printBtn">Print</button>
            </div>
        </div>`;
    $('printBtn').addEventListener('click', () => window.print());
    renderTracker(hit);
}

// ===== Price tracker =====
function loadShard(id) {
    const file = shardFile(id);
    if (!shardCache.has(file)) {
        shardCache.set(file, fetch(file).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
    }
    return shardCache.get(file);
}

const trackerNote = '<p class="stock-note">Indicative only, not for reuse: these are national list and promo prices, and individual stores can price differently. History starts the first day a product is seen on a deal.</p>';

async function renderTracker(hit) {
    const id = String(hit.objectID || hit.id);
    const body = $('trackerBody');
    const history = (await loadShard(id))[id] || null;
    if (s.product !== id || !body || !body.isConnected) return; // user moved on
    const rrp = hit.prices?.nationalRRP ?? null;
    const promo = hit.prices?.nationalPromo ?? null;
    const today = nzToday();

    if (!history) {
        body.innerHTML = isDeal(rrp, promo)
            ? `<p>This product is on a deal now but isn't tracked yet. It is added at the next daily check (around 1am NZ time), and its history builds from there.</p>${trackerNote}`
            : `<p>Not tracked yet. We start tracking a product's price the first time it goes on a deal, so history for this one will begin then.</p>${trackerNote}`;
        return;
    }
    // Fold in today's live price from the search index in case it changed since the last daily check.
    const live = rrp != null ? recordPrice(history, today, rrp, promo) : history;
    const verdict = judgeDeal(live, today);
    const first = live[0][0];
    const spanDays = daysBetween(first, today);
    const chart = spanDays >= 1
        ? renderPriceChart(chartSeries(live, today), today, money)
        : `<p class="tracker-wait">Tracking began today (${esc(first)}). The chart appears once there is more than a day of history.</p>`;
    const stale = trackerMeta?.lastRun && daysBetween(trackerMeta.lastRun, today) > 2;
    const checked = trackerMeta?.lastRun
        ? ` Last daily check: ${esc(trackerMeta.lastRun)}${stale ? ' (more than 2 days ago, so this may be out of date)' : ''}.`
        : '';
    body.innerHTML = `
        <p class="verdict verdict-${verdict.kind}">${esc(verdict.message)}</p>
        ${chart}
        <p class="stock-note">Tracked since ${esc(first)} (${spanDays + 1} day${spanDays === 0 ? '' : 's'}).${checked}</p>
        <details class="tracker-table"><summary>Show every price change</summary>
            <table><thead><tr><th>Date</th><th>List price</th><th>Promo price</th></tr></thead><tbody>
            ${[...live].reverse().map(([d, r, p]) => `<tr><td>${esc(d)}</td><td>${money(r)}</td><td>${p != null && p < r ? money(p) : '—'}</td></tr>`).join('')}
            </tbody></table></details>
        ${trackerNote}`;
}

// ===== Deals =====
async function fetchHits(ids) {
    const data = await algolia('/1/indexes/*/objects', {
        method: 'POST',
        body: JSON.stringify({ requests: ids.map((objectID) => ({ indexName: FACET_INDEX, objectID, attributesToRetrieve: CONFIG.ATTRIBUTES })) }),
    });
    return (data.results || []).filter(Boolean); // products removed from the index come back null
}

async function loadDeals() {
    try {
        const [dealsRes, metaRes] = await Promise.all([fetch('data/deals.json'), fetch('data/history/meta.json')]);
        if (dealsRes.ok) deals = await dealsRes.json();
        if (metaRes.ok) trackerMeta = await metaRes.json();
    } catch { /* tracker data unavailable: the site works without it */ }
    if (!deals.length) return;
    try {
        const featured = deals.filter((d) => d[3] >= 15).sort((a, b) => (b[1] - b[2]) - (a[1] - a[2])).slice(0, 12);
        dealsStripHits = await fetchHits((featured.length ? featured : deals.slice(0, 12)).map((d) => d[0]));
        dealsStripHits.forEach((h) => hitCache.set(String(h.objectID || h.id), h));
        renderDealsStrip();
        el.seeAllDeals.textContent = `See all ${deals.length.toLocaleString('en-NZ')} deals`;
        el.dealsHome.hidden = false;
    } catch (err) {
        console.error('Could not load deals:', err);
    }
}

function renderDealsStrip() {
    if (!dealsStripHits.length || renderedStripStore === s.storeId) return;
    renderedStripStore = s.storeId;
    const left = el.dealsStrip.scrollLeft;
    el.dealsStrip.innerHTML = dealsStripHits.map(cardHtml).join(''); // badges depend on My store, so redraw on change
    el.dealsStrip.scrollLeft = left;
}

/** Slide the strip along by itself; pauses while you hover, focus or touch it, and never runs with reduced motion. */
function startStripAutoScroll() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setInterval(() => {
        const strip = el.dealsStrip;
        if (stripPaused || document.hidden || el.dealsHome.hidden || strip.offsetParent === null) return;
        const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 4;
        if (atEnd) strip.scrollTo?.({ left: 0, behavior: 'smooth' });
        else strip.scrollBy?.({ left: strip.clientWidth * 0.6, behavior: 'smooth' });
    }, 4000);
}

async function runDeals(pageNumber) {
    const token = ++searchToken;
    const key = stateKey();
    page = pageNumber;
    if (pageNumber === 0) {
        el.resultsGrid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        el.loadMoreContainer.style.display = 'none';
        if (!deals.length) await dealsReady;
    } else {
        el.loadMoreBtn.disabled = true;
        el.loadMoreBtn.textContent = 'Loading…';
    }
    let moreFailed = false;
    try {
        const ids = deals.slice(pageNumber * CONFIG.HITS_PER_PAGE, (pageNumber + 1) * CONFIG.HITS_PER_PAGE).map((d) => d[0]);
        const hits = ids.length ? await fetchHits(ids) : [];
        if (token !== searchToken) return;
        renderResults({ hits, nbHits: deals.length }, pageNumber > 0);
        const stale = trackerMeta?.lastRun && daysBetween(trackerMeta.lastRun, nzToday()) > 2;
        el.stockAsOf.textContent = trackerMeta?.lastRun ? ` · prices checked ${trackerMeta.lastRun}${stale ? ' (may be out of date)' : ''}` : '';
        renderedKey = key;
    } catch (err) {
        if (token !== searchToken) return;
        console.error('Deals error:', err);
        if (pageNumber > 0) {
            moreFailed = true;
            el.loadMoreBtn.textContent = "Couldn't load more - tap to retry";
            return;
        }
        renderedKey = null;
        el.resultsGrid.innerHTML = '<div class="grid-message"><h3>Could not load deals</h3></div>';
    } finally {
        el.loadMoreBtn.disabled = false;
        if (!moreFailed) el.loadMoreBtn.textContent = 'Load More Results';
    }
}

// ===== Store picker =====
function renderStoreList() {
    const matches = searchStores(stores, el.storeSearch.value);
    el.storeList.innerHTML = matches.length
        ? matches.map((st) => `
            <li role="option" data-id="${st.id}" aria-selected="${st.id === s.storeId}" class="${st.id === s.storeId ? 'selected' : ''}">
                <span>${esc(st.name)}</span><small>${st.name.toLowerCase().includes(st.town.toLowerCase()) ? '' : esc(st.town)}</small>
            </li>`).join('')
        : '<li class="empty">No stores match</li>';
}

function openStorePicker(open) {
    el.storePanel.hidden = !open;
    el.storeBtn.setAttribute('aria-expanded', String(open));
    if (open) {
        el.storeSearch.value = '';
        renderStoreList();
        el.storeSearch.focus();
    }
}

function chooseStore(id) {
    saveStore(id);
    openStorePicker(false);
    change({ storeId: id, inStock: id == null ? false : s.inStock });
}

// ===== Events =====
function initEvents() {
    el.searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = el.searchInput.value.trim();
        el.clearBtn.style.display = query ? 'block' : 'none';
        debounceTimer = setTimeout(() => {
            if (query !== s.query) change({ query, product: null, deals: false }, { resetFilters: true });
        }, CONFIG.SEARCH_DELAY);
    });
    el.searchInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        clearTimeout(debounceTimer);
        const query = el.searchInput.value.trim();
        if (query !== s.query) change({ query, product: null, deals: false }, { resetFilters: true });
    });
    el.clearBtn.addEventListener('click', () => {
        el.searchInput.value = '';
        change({ query: '', product: null, deals: false }, { resetFilters: true });
        el.searchInput.focus();
    });
    document.querySelector('.logo').addEventListener('click', () => {
        el.searchInput.value = '';
        change({ query: '', product: null, deals: false }, { resetFilters: true });
    });

    el.sortSelect.addEventListener('change', () => change({ sort: el.sortSelect.value }));
    el.filterNationwide.addEventListener('change', () => change({ nationwide: el.filterNationwide.checked }));
    el.filterInStock.addEventListener('change', () => change({ inStock: el.filterInStock.checked }));
    el.inStockLabel.addEventListener('click', () => {
        if (s.storeId == null) openStorePicker(true);
    });

    el.categoryTree.addEventListener('click', (e) => {
        const item = e.target.closest('.category-item');
        if (!item) return;
        const path = item.dataset.path;
        const parent = path.split(' > ').slice(0, -1).join(' > ') || null;
        change({ category: s.category === path ? parent : path });
    });
    el.clearCategories.addEventListener('click', () => change({ category: null }));
    const setFiltersOpen = (open) => {
        el.resultsView.classList.toggle('filters-open', open);
        el.filterToggle.setAttribute('aria-expanded', String(open));
    };
    el.filterToggle.addEventListener('click', () => setFiltersOpen(!el.resultsView.classList.contains('filters-open')));
    el.filtersDone.addEventListener('click', () => {
        setFiltersOpen(false);
        el.resultsTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const scrollStrip = (dir) => el.dealsStrip.scrollBy?.({ left: dir * el.dealsStrip.clientWidth * 0.8, behavior: 'smooth' });
    el.dealsPrev.addEventListener('click', () => scrollStrip(-1));
    el.dealsNext.addEventListener('click', () => scrollStrip(1));
    el.seeAllDeals.addEventListener('click', () => change({ deals: true, query: '', category: null, brands: [], product: null }, { push: true }));
    el.departmentGrid.addEventListener('click', (e) => {
        const tile = e.target.closest('.department-tile');
        if (tile) change({ category: tile.dataset.path, query: '', brands: [], product: null, deals: false }, { push: true });
    });
    // Breadcrumb steps are real navigation: they get history entries so Back undoes them.
    el.breadcrumb.addEventListener('click', (e) => {
        const crumb = e.target.closest('button.crumb');
        if (crumb) change({ category: crumb.dataset.path || null, deals: false, product: null }, { push: true });
    });
    el.productBreadcrumb.addEventListener('click', (e) => {
        const crumb = e.target.closest('button.crumb');
        if (crumb) change({ category: crumb.dataset.path || null, query: '', brands: [], deals: false, product: null }, { push: true });
    });
    el.brandList.addEventListener('change', (e) => {
        const brand = e.target.dataset.brand;
        if (brand == null) return;
        change({ brands: e.target.checked ? [...s.brands, brand] : s.brands.filter((b) => b !== brand) });
    });
    el.clearBrands.addEventListener('click', () => change({ brands: [] }));

    el.loadMoreBtn.addEventListener('click', () => (s.deals ? runDeals(page + 1) : runSearch(page + 1)));

    const openCard = (card) => card && change({ product: card.dataset.id }, { push: true });
    for (const list of [el.resultsGrid, el.dealsStrip]) {
        list.addEventListener('click', (e) => openCard(e.target.closest('.product-card')));
        list.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') openCard(e.target.closest('.product-card'));
        });
    }
    const pause = (on) => () => { stripPaused = on; };
    el.dealsHome.addEventListener('pointerenter', pause(true));
    el.dealsHome.addEventListener('pointerleave', pause(false));
    el.dealsHome.addEventListener('focusin', pause(true));
    el.dealsHome.addEventListener('focusout', pause(false));
    el.dealsStrip.addEventListener('touchstart', pause(true), { passive: true });
    el.dealsStrip.addEventListener('touchend', () => setTimeout(pause(false), 6000), { passive: true });
    startStripAutoScroll();
    el.dealsStrip.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG') e.target.parentElement.innerHTML = '<span class="no-image">No image</span>';
    }, true);
    el.resultsGrid.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG') e.target.parentElement.innerHTML = '<span class="no-image">No image</span>';
    }, true);
    el.productDetail.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG') e.target.parentElement.innerHTML = '<span class="no-image">No image</span>';
    }, true);

    el.backBtn.addEventListener('click', () => {
        wantRestore = true;
        if (history.state?.fromApp) history.back();
        else change({ product: null });
    });
    window.addEventListener('popstate', () => {
        wantRestore = true;
        const store = s.storeId; // My store is a setting, not part of navigation
        s = { ...stateFromLocation(), storeId: store };
        if (store == null) s.inStock = false;
        writeHash();
        refresh();
    });

    // Store picker
    el.storeBtn.addEventListener('click', () => openStorePicker(el.storePanel.hidden));
    el.storeSearch.addEventListener('input', renderStoreList);
    el.storeSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') openStorePicker(false);
        if (e.key === 'Enter') {
            const first = el.storeList.querySelector('li[data-id]');
            if (first) chooseStore(Number(first.dataset.id));
        }
    });
    el.storeList.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-id]');
        if (li) chooseStore(Number(li.dataset.id));
    });
    el.storeClear.addEventListener('click', () => chooseStore(null));
    document.addEventListener('click', (e) => {
        if (!el.storePicker.contains(e.target) && !el.inStockLabel.contains(e.target)) openStorePicker(false);
    });
}

// ===== Init =====
async function init() {
    try {
        stores = await (await fetch('stores-lite.json')).json();
    } catch (err) {
        console.error('Could not load stores:', err);
        el.storeBtn.disabled = true;
        el.storeLabel.textContent = 'Stores unavailable';
    }
    s = stateFromLocation();
    initEvents();
    writeHash();
    dealsReady = loadDeals();
    refresh();
    loadDepartments();
}

init();
