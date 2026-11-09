// Price history logic shared by the daily tracker job (Node) and the site (browser).
//
// A product's history is a list of change points, oldest first:
//   [["2026-11-09", 41.18, null], ["2026-11-20", 41.18, 32.99], ...]
// i.e. [date (NZ), list price (RRP), promo price or null]. A new entry is only
// stored when either price changes, so a flat price is one entry however long it lasts.

export const SHARDS = 128;
export const MIN_DAYS_TO_JUDGE = 14;
const DAY = 86400000;

/** Stable shard for a product id, so one product's history is a small file fetch. */
export function shardOf(id) {
    let h = 5381;
    for (const ch of String(id)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    return h % SHARDS;
}

export const shardFile = (id) => `data/history/${String(shardOf(id)).padStart(3, '0')}.json`;

/** A real discount: promo price strictly below the list price. */
export const isDeal = (rrp, promo) => rrp != null && promo != null && promo > 0 && promo < rrp;

/** What the customer actually pays at national pricing. */
export function effectivePrice(rrp, promo) {
    return isDeal(rrp, promo) ? promo : rrp ?? promo ?? null;
}

const toDay = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetween = (fromIso, toIso) => Math.round((toDay(toIso) - toDay(fromIso)) / DAY);

/** Returns the history with a new change point appended, or the same array if nothing changed. */
export function recordPrice(history, date, rrp, promo) {
    const last = history?.[history.length - 1];
    const p = promo ?? null;
    if (last && last[1] === rrp && last[2] === p) return history;
    if (last && last[0] === date) return [...history.slice(0, -1), [date, rrp, p]]; // re-run on the same day
    return [...(history || []), [date, rrp, p]];
}

/** Round to cents to keep float noise out of comparisons. */
const cents = (n) => Math.round(n * 100);

/**
 * Is the current promotion actually a good deal, judged on tracked history?
 * kind: none | unknown | always | inflated | best | not_best
 */
export function judgeDeal(history, today) {
    if (!history?.length) return { kind: 'unknown', days: 0, message: 'No price history yet.' };
    const last = history[history.length - 1];
    const [, rrp, promo] = last;
    const days = daysBetween(history[0][0], today) + 1;
    if (!isDeal(rrp, promo)) {
        return { kind: 'none', days, message: 'Not currently discounted.' };
    }
    const pct = Math.round((1 - promo / rrp) * 100);
    if (days < MIN_DAYS_TO_JUDGE) {
        return {
            kind: 'unknown', days, pct,
            message: `${pct}% below the list price. We've only tracked this for ${days} day${days === 1 ? '' : 's'}, so can't judge it yet (needs ${MIN_DAYS_TO_JUDGE}).`,
        };
    }
    const before = history.slice(0, -1);
    if (!before.length) {
        return { kind: 'always', days, pct, message: `${pct}% below the list price, and it has been this price for all ${days} days we've tracked.` };
    }
    // List price raised shortly before the discount? (the classic "was/now" trick)
    // Look at every price period that ended within 60 days of the discount starting.
    for (let i = before.length - 1; i >= 0; i--) {
        const endedOn = history[i + 1][0]; // when this period gave way to the next entry
        if (daysBetween(endedOn, last[0]) > 60) break;
        if (cents(before[i][1]) < cents(rrp)) {
            const was = before[i][1];
            return {
                kind: 'inflated', days, pct, raisedFrom: was,
                message: `The list price was raised from $${was.toFixed(2)} to $${rrp.toFixed(2)} not long before this discount started. The real saving is smaller than ${pct}%.`,
            };
        }
    }
    const lowest = before.reduce((best, [date, r, p]) => {
        const price = effectivePrice(r, p);
        return best === null || cents(price) < cents(best.price) ? { price, date } : best;
    }, null);
    if (cents(promo) <= cents(lowest.price)) {
        return { kind: 'best', days, pct, message: `Lowest price we've tracked in ${days} days.` };
    }
    return {
        kind: 'not_best', days, pct, lowest,
        message: `${pct}% off the list price, but it was $${lowest.price.toFixed(2)} on ${lowest.date}.`,
    };
}

/** Points for a step chart: one per change, plus today so the line runs to the present. */
export function chartSeries(history, today) {
    if (!history?.length) return [];
    const points = history.map(([date, rrp, promo]) => ({ date, rrp, price: effectivePrice(rrp, promo) }));
    const last = points[points.length - 1];
    if (last.date !== today) points.push({ ...last, date: today });
    return points;
}
