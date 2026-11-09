import { daysBetween } from './price-history.js';

const W = 640, H = 240;
const PAD = { l: 56, r: 16, t: 16, b: 32 };

const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/**
 * Step chart of a product's list price (dashed) and the price you pay (solid).
 * `points` come from chartSeries(); styling is by class so dark mode just works.
 */
export function renderPriceChart(points, today, money = (n) => `$${n.toFixed(2)}`) {
    if (!points?.length) return '';
    const first = points[0].date;
    const span = Math.max(1, daysBetween(first, today));
    const plotW = W - PAD.l - PAD.r;
    const plotH = H - PAD.t - PAD.b;

    const values = points.flatMap((p) => [p.rrp, p.price]).filter((v) => Number.isFinite(v));
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const pad = Math.max(0.5, (hi - lo) * 0.12, hi * 0.03);
    lo = Math.max(0, lo - pad);
    hi += pad;

    const x = (date) => PAD.l + (daysBetween(first, date) / span) * plotW;
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
    const step = (key) => points.map((p, i) => {
        const px = x(p.date).toFixed(1), py = y(p[key]).toFixed(1);
        return i === 0 ? `M${px},${py}` : `H${px}V${py}`;
    }).join('');

    const last = points[points.length - 1];
    const ticks = [lo + pad, hi - pad].filter((v, i, a) => i === 0 || Math.abs(v - a[0]) > 0.005);
    const grid = ticks.map((v) =>
        `<line class="chart-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>` +
        `<text class="chart-axis" x="${PAD.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${escText(money(v))}</text>`).join('');

    const label = `Price history from ${first} to ${today}. Now ${money(last.price)}.`;
    return `<svg class="price-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escText(label)}">
        <title>${escText(label)}</title>${grid}
        <path class="chart-rrp" d="${step('rrp')}"/>
        <path class="chart-price" d="${step('price')}"/>
        <circle class="chart-now" cx="${x(last.date).toFixed(1)}" cy="${y(last.price).toFixed(1)}" r="4"/>
        <text class="chart-axis" x="${PAD.l}" y="${H - 8}" text-anchor="start">${escText(first)}</text>
        <text class="chart-axis" x="${W - PAD.r}" y="${H - 8}" text-anchor="end">${escText(today)}</text>
    </svg>`;
}
