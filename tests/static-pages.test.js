import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const index = read('index.html');
const about = read('about.html');
const app = read('app.js');
const css = read('style.css');

test('every page says prices are indicative only and the site is unofficial', () => {
    assert.match(index, /indicative only/i);
    assert.match(index, /not affiliated with or endorsed by/i);
    assert.match(index, /href="about\.html"/);
    assert.match(app, /Indicative price only/, 'product page price note');
    assert.match(app, /Indicative only, not for reuse/, 'tracker note');
    assert.match(about, /indicative only/i);
    assert.match(about, /do not copy, scrape or reuse the pricing data/i);
    assert.match(about, /not affiliated with, endorsed by or connected to/i);
});

test('the about page has a privacy note about searches going to Algolia', () => {
    assert.match(about, /Privacy/);
    assert.match(about, /Your searches go to Algolia/);
    assert.match(about, /IP address/);
    assert.match(about, /local storage/i);
    assert.match(about, /no accounts, no ads, no analytics/i);
});

test('the site uses the orange theme, not the old red', () => {
    assert.doesNotMatch(css, /#E3184A|#F2456E/i, 'old red brand colour is gone');
    assert.match(css, /--primary:\s*#C9440A/i, 'orange theme');
});

test('both pages link the same stylesheet version', () => {
    const v = (html) => html.match(/style\.css\?v=(\d+)/)?.[1];
    assert.ok(v(index), 'index.html has a version');
    assert.equal(v(about), v(index));
});
