import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, $, $$, text, cards, count, until, fire } from './helpers.js';

test('home lists departments (without "Other") and hides results', async () => {
    const w = await boot('');
    await until(() => $$(w, '.department-tile').length > 20, 'department tiles');
    assert.ok(!$$(w, '.department-name').some((n) => n.textContent === 'Other'));
    assert.equal($(w, '#resultsView').style.display, 'none');
});

test('department tile browses with no keyword; breadcrumb and sidebar navigate', async () => {
    const w = await boot('');
    await until(() => $$(w, '.department-tile').length > 20, 'department tiles');
    $$(w, '.department-tile').find((x) => x.dataset.path === 'Power Tools').click();
    await until(() => cards(w) > 0, 'department results');
    assert.match(w.location.hash, /cat=Power\+Tools/);
    assert.doesNotMatch(w.location.hash, /q=/);
    assert.equal(text(w, '#resultsTitle'), 'Power Tools');
    assert.ok(count(w) > 1000);
    await until(() => $$(w, '.category-item[data-level="1"]').length > 3, 'sub-categories');

    $$(w, '.category-item[data-level="1"]')[0].click();
    await until(() => $$(w, '#breadcrumb li').length === 3, 'three-step trail for the sub-category');

    $$(w, '#breadcrumb button.crumb').find((c) => c.textContent.trim() === 'Power Tools').click();
    await until(() => text(w, '#resultsTitle') === 'Power Tools' && $$(w, '#breadcrumb li').length === 2 && cards(w) > 0, 'up one level');

    $$(w, '#breadcrumb button.crumb').find((c) => c.textContent.trim() === 'All departments').click();
    await until(() => $(w, '#emptyState').style.display === 'block', 'home again');
    assert.doesNotMatch(w.location.hash, /cat=/);
});

test('small sub-categories are not cut off by facet limits', async () => {
    const w = await boot('#cat=Power%20Tools%20%3E%20Drills%20%26%20Impact%20Drivers');
    await until(() => $$(w, '.category-item').length > 3, 'category rows');
    assert.match(text(w, '#categoryTree'), /Electric Drills/);
});

test('department deep link works with store stock', async () => {
    const w = await boot('#cat=Paint&store=31&stock=1');
    await until(() => cards(w) > 0, 'results');
    assert.ok($$(w, '.stock-badge.in').length > 0);
});

test('typing a query leaves browse mode', async () => {
    const w = await boot('#cat=Paint');
    await until(() => cards(w) > 0, 'results');
    const input = $(w, '#searchInput');
    input.value = 'brush';
    fire(w, input);
    await until(() => /Results for "brush"/.test(text(w, '#resultsTitle')), 'search results');
    assert.doesNotMatch(w.location.hash, /cat=/);
});

test('results breadcrumb: current level is plain text, every ancestor is a button', async () => {
    const w = await boot('#cat=Power%20Tools%20%3E%20Drills%20%26%20Impact%20Drivers');
    await until(() => cards(w) > 0, 'results');
    const trail = $$(w, '#breadcrumb li').map((li) => li.textContent.trim());
    assert.deepEqual(trail, ['All departments', 'Power Tools', 'Drills & Impact Drivers']);
    assert.equal($$(w, '#breadcrumb button.crumb').length, 2, 'ancestors are buttons');
    assert.equal($(w, '#breadcrumb .crumb-current').textContent.trim(), 'Drills & Impact Drivers');
    assert.equal($(w, '#breadcrumb .crumb-current').tagName, 'SPAN');
});
