const normalise = (s) =>
    String(s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();

/** Filter stores by name, town or suburb; macron- and case-insensitive. */
export function searchStores(stores, text, limit = 50) {
    const q = normalise(text).trim();
    if (!q) return stores.slice(0, limit);
    return stores
        .filter((s) => normalise(`${s.name} ${s.town} ${s.suburb}`).includes(q))
        .slice(0, limit);
}

export function findStore(stores, id) {
    return stores.find((s) => s.id === Number(id)) || null;
}

/** "MEGA Whangārei" -> "Whangārei" */
export function shortName(store) {
    return store.name.replace(/^MEGA\s+/i, '');
}
