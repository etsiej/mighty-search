import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, $, $$, text, cards, until, chooseStore } from './helpers.js';

const deals = JSON.parse(readFileSync(new URL('../../data/deals.json', import.meta.url), 'utf8'));

test('home deals strip: 12 varied cards with discount badges and a see-all link', async () => {
    const w = await boot('');
    await until(() => cards(w, '#dealsStrip') === 12, 'strip cards');
    assert.ok($$(w, '#dealsStrip .product-card').every((c) => c.querySelector('.deal-badge')));
    assert.equal(new Set($$(w, '#dealsStrip .card-name').map((n) => n.textContent)).size, 12, 'not twelve copies of one product');
    assert.match(text(w, '#seeAllDeals'), new RegExp(`See all ${deals.length.toLocaleString('en-NZ')} deals`));
});

test('strip arrows scroll sideways', async () => {
    const w = await boot('');
    await until(() => cards(w, '#dealsStrip') === 12, 'strip cards');
    const calls = [];
    const strip = $(w, '#dealsStrip');
    strip.scrollBy = (o) => calls.push(o);
    Object.defineProperty(strip, 'clientWidth', { value: 800 });
    $(w, '#dealsNext').click();
    $(w, '#dealsPrev').click();
    assert.deepEqual(calls.map((c) => Math.sign(c.left)), [1, -1]);
});

test('changing store redraws the strip badges; clicking a strip card opens the product and Back returns home', async () => {
    const w = await boot('');
    await until(() => cards(w, '#dealsStrip') === 12, 'strip cards');
    assert.equal($$(w, '#dealsStrip .stock-badge').length, 0);
    await chooseStore(w, 'thames');
    await until(() => $$(w, '#dealsStrip .stock-badge').length === 12, 'strip badges for my store');

    $(w, '#dealsStrip .product-card').click();
    await until(() => $(w, '#productView').style.display === 'block', 'product view');
    assert.match(w.location.hash, /p=/);
    await until(() => /Price tracker/.test(text(w, '#tracker')), 'tracker section');
    assert.match(text(w, '.stock-section'), /Thames/);

    $(w, '#backBtn').click();
    await until(() => $(w, '#emptyState').style.display === 'block', 'home again');
    assert.doesNotMatch(w.location.hash, /p=/);
});

test('deals view lists every deal, paged, without the sidebar', async () => {
    const w = await boot('');
    await until(() => text(w, '#seeAllDeals').includes('See all'), 'see-all link');
    $(w, '#seeAllDeals').click();
    await until(() => cards(w) === 24, 'first page of deals');
    assert.equal(w.location.hash, '#deals=1');
    assert.equal(text(w, '#resultsTitle'), 'Deals');
    assert.match(text(w, '#resultsCount'), new RegExp(`${deals.length.toLocaleString('en-NZ')} products currently below`));
    assert.ok($(w, '#resultsView').classList.contains('deals-mode'));
    assert.deepEqual($$(w, '#breadcrumb li').map((li) => li.textContent.trim()), ['All departments', 'Deals']);
    $(w, '#loadMoreBtn').click();
    await until(() => cards(w) === 48, 'load more appends');

    $(w, '#resultsGrid .product-card').click();
    await until(() => $(w, '#productView').style.display === 'block', 'product view');
    $(w, '#backBtn').click();
    await until(() => text(w, '#resultsTitle') === 'Deals' && cards(w) === 48, 'back to the same list, no refetch');
});

test('tracker: one-day history says so; multi-day history draws a chart and verdict', async () => {
    const id = String(deals[0][0]);
    let w = await boot(`#p=${id}`);
    await until(() => /Price tracker/.test(text(w, '#tracker')) && !$(w, '#trackerBody .spinner'), 'tracker rendered');
    assert.match(text(w, '#trackerBody'), /Tracking began today|Tracked since/);

    const synthetic = { [id]: [['2026-09-01', 100, null], ['2026-10-01', 100, 90], ['2026-10-15', 100, null], ['2026-11-01', 100, 80]] };
    w = await boot(`#p=${id}`, { shards: synthetic });
    await until(() => $(w, '#trackerBody svg.price-chart'), 'chart');
    assert.doesNotMatch($(w, '#trackerBody').innerHTML, /NaN/);
    assert.ok(text(w, '.verdict').length > 10);
    assert.ok($$(w, '.tracker-table tbody tr').length >= 4);
});

test('an untracked product explains how tracking starts', async () => {
    const w = await boot('#p=385304', { shards: {} });
    await until(() => /tracked yet/.test(text(w, '#trackerBody')), 'untracked message');
});
