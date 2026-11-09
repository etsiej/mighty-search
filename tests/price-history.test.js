import test from 'node:test';
import assert from 'node:assert/strict';
import { shardOf, shardFile, isDeal, effectivePrice, recordPrice, judgeDeal, chartSeries, SHARDS } from '../src/price-history.js';

test('shard is stable and in range', () => {
    assert.equal(shardOf('385304'), shardOf(385304));
    for (const id of ['1', '385304', '2033243', 'abc']) assert.ok(shardOf(id) >= 0 && shardOf(id) < SHARDS);
    assert.match(shardFile('385304'), /^data\/history\/\d{3}\.json$/);
});

test('a deal needs promo strictly below the list price', () => {
    assert.equal(isDeal(22.48, 22.48), false); // "Everyday low price" is not a discount
    assert.equal(isDeal(41.18, null), false);
    assert.equal(isDeal(41.18, 32.99), true);
    assert.equal(effectivePrice(41.18, 32.99), 32.99);
    assert.equal(effectivePrice(22.48, 22.48), 22.48);
    assert.equal(effectivePrice(41.18, null), 41.18);
});

test('recordPrice only appends on change', () => {
    let h = recordPrice([], '2026-11-09', 10, null);
    assert.deepEqual(h, [['2026-11-09', 10, null]]);
    assert.equal(recordPrice(h, '2026-11-10', 10, null), h);
    h = recordPrice(h, '2026-11-11', 10, 8);
    assert.deepEqual(h, [['2026-11-09', 10, null], ['2026-11-11', 10, 8]]);
    assert.deepEqual(recordPrice(h, '2026-11-11', 10, 7), [['2026-11-09', 10, null], ['2026-11-11', 10, 7]]);
});

test('judging needs enough history', () => {
    const h = [['2026-11-09', 100, null], ['2026-11-10', 100, 80]];
    const v = judgeDeal(h, '2026-11-12');
    assert.equal(v.kind, 'unknown'); assert.equal(v.pct, 20); assert.equal(v.days, 4);
    assert.equal(judgeDeal([], '2026-11-12').kind, 'unknown');
});

test('no current discount', () => {
    assert.equal(judgeDeal([['2026-01-01', 50, null]], '2026-11-12').kind, 'none');
    assert.equal(judgeDeal([['2026-01-01', 50, 50]], '2026-11-12').kind, 'none');
});

test('always on promo', () => {
    assert.equal(judgeDeal([['2026-01-01', 50, 40]], '2026-11-12').kind, 'always');
});

test('best price in tracked history', () => {
    const h = [['2026-01-01', 100, null], ['2026-03-01', 100, 90], ['2026-04-01', 100, null], ['2026-11-01', 100, 80]];
    const v = judgeDeal(h, '2026-11-12');
    assert.equal(v.kind, 'best'); assert.equal(v.pct, 20);
});

test('not the best price: says when it was cheaper', () => {
    const h = [['2026-01-01', 100, null], ['2026-03-01', 100, 70], ['2026-04-01', 100, null], ['2026-11-01', 100, 85]];
    const v = judgeDeal(h, '2026-11-12');
    assert.equal(v.kind, 'not_best'); assert.equal(v.lowest.price, 70); assert.equal(v.lowest.date, '2026-03-01');
});

test('inflated list price before a discount is called out', () => {
    const h = [['2026-01-01', 80, null], ['2026-10-20', 100, null], ['2026-11-01', 100, 80]];
    const v = judgeDeal(h, '2026-11-12');
    assert.equal(v.kind, 'inflated'); assert.equal(v.raisedFrom, 80);
});

test('chart series runs to today', () => {
    const s = chartSeries([['2026-11-01', 100, null], ['2026-11-05', 100, 80]], '2026-11-09');
    assert.deepEqual(s.map((p) => [p.date, p.price]), [['2026-11-01', 100], ['2026-11-05', 80], ['2026-11-09', 80]]);
    assert.deepEqual(chartSeries([], '2026-11-09'), []);
});

import { renderPriceChart } from '../src/chart.js';

test('chart renders step lines for changing and flat prices without NaN', () => {
    const changing = chartSeries([['2026-11-01', 100, null], ['2026-11-05', 100, 80]], '2026-11-09');
    const svg = renderPriceChart(changing, '2026-11-09');
    assert.match(svg, /class="chart-price"/); assert.match(svg, /class="chart-rrp"/);
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    const flat = renderPriceChart(chartSeries([['2026-11-01', 50, null]], '2026-11-09'), '2026-11-09');
    assert.doesNotMatch(flat, /NaN|undefined|Infinity/);
    assert.equal(renderPriceChart([], '2026-11-09'), '');
});
