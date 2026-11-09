import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, $, $$, text, cards, count, until, fire, chooseStore } from './helpers.js';

test('deep link: search + store + in-stock + sort render with facets', async () => {
    const w = await boot('#q=drill&store=31&stock=1&sort=price_asc');
    await until(() => cards(w) > 0, 'results');
    assert.equal(count(w), 892);
    assert.equal(text(w, '#storeLabel'), 'Thames');
    assert.ok($$(w, '#resultsGrid .card-delivery').every((c) => c.querySelector('.stock-badge.in')), 'every card is in stock at Thames');
    assert.ok($$(w, '.category-item').length > 3, 'category tree');
    assert.ok($$(w, '.brand-item').length > 3, 'brand list');
    const inStock = $(w, '#filterInStock');
    assert.ok(!inStock.disabled && inStock.checked);
});

test('category click narrows and shows children; brand filter applies', async () => {
    const w = await boot('#q=drill&store=31&stock=1');
    await until(() => cards(w) > 0, 'results');
    const before = count(w);
    $(w, '.category-item').click();
    await until(() => count(w) < before, 'category narrows');
    assert.match(w.location.hash, /cat=/);
    assert.ok($$(w, '.category-item[data-level="1"]').length > 0, 'children appear under the active category');

    const brand = $(w, '.brand-item input');
    brand.checked = true;
    fire(w, brand, 'change');
    await until(() => /brand=/.test(w.location.hash) && cards(w) > 0, 'brand filter');
});

test('product page shows the stock headline for my store; Back returns', async () => {
    const w = await boot('#q=drill&store=31');
    await until(() => cards(w) > 0, 'results');
    $(w, '#resultsGrid .product-card').click();
    await until(() => $(w, '#productView').style.display === 'block', 'product view');
    await until(() => /stock at Thames/.test(text(w, '#productDetail')), 'stock headline');
    assert.match(w.location.hash, /p=/);
    assert.doesNotMatch(w.document.title, /^Product/, 'title is the product name');
    assert.equal(text(w, '#backBtn'), '← Back');
});

test('nationwide narrows; in-stock is disabled without a store; load more appends', async () => {
    const w = await boot('#q=drill');
    await until(() => cards(w) === 24, 'first page');
    const all = count(w);
    assert.ok($(w, '#filterInStock').disabled);
    const nationwide = $(w, '#filterNationwide');
    nationwide.checked = true;
    fire(w, nationwide, 'change');
    await until(() => count(w) < all, 'nationwide narrows');
    nationwide.checked = false;
    fire(w, nationwide, 'change');
    await until(() => count(w) === all, 'back to all');
    $(w, '#loadMoreBtn').click();
    await until(() => cards(w) === 48, 'load more appends');
});

test('store picker finds macron names, persists, and updates badges', async () => {
    const w = await boot('#q=drill');
    await until(() => cards(w) > 0, 'results');
    $(w, '#storeBtn').click();
    const input = $(w, '#storeSearch');
    input.value = 'whangarei';
    fire(w, input);
    assert.match(text(w, '#storeList'), /Whang/);
    $(w, '#storeList li[data-id]').click();
    await until(() => $$(w, '.stock-badge').length > 0, 'badges for my store');
    assert.match(w.location.hash, /store=/);
    assert.ok(w.localStorage.getItem('mightysearch.store') !== null, 'store persisted');
});

test('HTML in the query is never injected as markup', async () => {
    const w = await boot('#q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    await until(() => text(w, '#resultsTitle').includes('Results for'), 'results header');
    assert.equal($(w, '#resultsTitle img'), null);
});

test('a failed load-more keeps the results and offers a retry', async () => {
    const w = await boot('#q=drill');
    await until(() => cards(w) === 24, 'first page');
    const realFetch = w.fetch;
    w.fetch = () => Promise.reject(new Error('offline'));
    $(w, '#loadMoreBtn').click();
    await until(() => /retry/.test(text(w, '#loadMoreBtn')), 'retry label');
    assert.equal(cards(w), 24);
    w.fetch = realFetch;
});

test('browser Back keeps the store I just chose', async () => {
    const w = await boot('#q=drill&store=31');
    await until(() => cards(w) > 0, 'results');
    $(w, '#resultsGrid .product-card').click();
    await until(() => $(w, '#productView').style.display === 'block', 'product view');
    await chooseStore(w, 'waihi');
    await until(() => /Waihi/.test(text(w, '#storeLabel')), 'store changed');
    w.history.back();
    await until(() => $(w, '#resultsView').style.display === 'block', 'back to results');
    assert.match(text(w, '#storeLabel'), /Waihi/);
});

test('product page breadcrumb is clickable and leads to that category', async () => {
    const w = await boot('#q=drill&store=31');
    await until(() => cards(w) > 0, 'results');
    $(w, '#resultsGrid .product-card').click();
    await until(() => $$(w, '#productBreadcrumb button.crumb').length >= 2, 'breadcrumb on the product page');
    const trail = $$(w, '#productBreadcrumb li').map((li) => li.textContent.trim());
    assert.equal(trail[0], 'All departments');
    assert.ok(trail.length >= 3, `has department and category levels: ${trail}`);
    assert.doesNotMatch(text(w, '.detail-meta'), /Category/, 'category is shown once, as the breadcrumb');

    const last = $$(w, '#productBreadcrumb button.crumb').pop();
    const name = last.textContent.trim();
    last.click();
    await until(() => cards(w) > 0 && text(w, '#resultsTitle') === name, `browse ${name}`);
    assert.match(w.location.hash, /cat=/);
    assert.doesNotMatch(w.location.hash, /p=|q=/);
});

test('product page "All departments" goes home', async () => {
    const w = await boot('#q=drill');
    await until(() => cards(w) > 0, 'results');
    $(w, '#resultsGrid .product-card').click();
    await until(() => $$(w, '#productBreadcrumb button.crumb').length >= 1, 'breadcrumb');
    $(w, '#productBreadcrumb button.crumb').click();
    await until(() => $(w, '#emptyState').style.display === 'block', 'home');
});
