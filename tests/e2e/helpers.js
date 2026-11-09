// Boots the real index.html + app.js in jsdom against the LIVE Algolia API.
// app.js is bundled with esbuild, so new modules under src/ are picked up automatically.
import { afterEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
let bundled;
const openWindows = new Set();

// The app starts timers (strip auto-scroll); a window left open keeps Node alive after the tests pass.
afterEach(() => {
    for (const w of openWindows) w.close();
    openWindows.clear();
});

async function appBundle() {
    bundled ??= (await build({
        entryPoints: [fileURLToPath(new URL('app.js', root))],
        bundle: true, format: 'iife', write: false, logLevel: 'silent',
    })).outputFiles[0].text;
    return bundled;
}

/**
 * @param hash   location hash to start from, e.g. '#q=drill&store=31'
 * @param shards if set, every data/history/NNN.json fetch returns this object (not meta.json)
 */
export async function boot(hash = '', { shards = null } = {}) {
    const html = readFileSync(new URL('index.html', root), 'utf8').replace(/<script[^>]*><\/script>/g, '');
    const w = new JSDOM(html, { url: `http://localhost/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true }).window;
    w.fetch = (url, options) => {
        url = String(url);
        if (url.startsWith('http')) return fetch(url, options);
        if (shards && /^data\/history\/\d+\.json/.test(url)) return Promise.resolve({ ok: true, json: async () => shards });
        const file = new URL(url.split('?')[0], root);
        return Promise.resolve(existsSync(file)
            ? { ok: true, json: async () => JSON.parse(readFileSync(file, 'utf8')) }
            : { ok: false, json: async () => ({}) });
    };
    w.scrollTo = () => {}; // jsdom has no layout
    openWindows.add(w);
    w.eval(await appBundle());
    return w;
}

export const $ = (w, selector) => w.document.querySelector(selector);
export const $$ = (w, selector) => [...w.document.querySelectorAll(selector)];
export const text = (w, selector) => $(w, selector)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
export const cards = (w, scope = '#resultsGrid') => $$(w, `${scope} .product-card`).length;
export const count = (w) => parseInt(text(w, '#resultsCount').replace(/,/g, ''), 10);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `condition()` is truthy; reports what it was waiting for if it never is. */
export async function until(condition, what = 'condition', { timeout = 20000, interval = 50 } = {}) {
    const start = Date.now();
    for (;;) {
        const value = await condition();
        if (value) return value;
        if (Date.now() - start > timeout) throw new Error(`Timed out waiting for: ${what}`);
        await sleep(interval);
    }
}

export const fire = (w, el, type = 'input') => el.dispatchEvent(new w.Event(type, { bubbles: true }));

/** Choose a store through the real picker UI. */
export async function chooseStore(w, query) {
    $(w, '#storeBtn').click();
    const input = $(w, '#storeSearch');
    input.value = query;
    fire(w, input);
    $(w, '#storeList li[data-id]').click();
}
