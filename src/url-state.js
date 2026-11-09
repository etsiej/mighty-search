// Search state <-> location.hash, so searches are shareable and Back works.

export const DEFAULT_STATE = Object.freeze({
    query: '',
    category: null,
    brands: [],
    nationwide: false,
    inStock: false,
    sort: 'relevance',
    storeId: null,
    product: null,
    deals: false,
});

const SORTS = ['relevance', 'price_asc', 'price_desc'];

export function parseHash(hash) {
    const sp = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const store = Number(sp.get('store'));
    const sort = sp.get('sort');
    return {
        query: (sp.get('q') || '').trim(),
        category: sp.get('cat') || null,
        brands: sp.getAll('brand').filter(Boolean),
        nationwide: sp.get('nw') === '1',
        inStock: sp.get('stock') === '1',
        sort: SORTS.includes(sort) ? sort : 'relevance',
        storeId: sp.get('store') && Number.isFinite(store) ? store : null,
        product: sp.get('p') || null,
        deals: sp.get('deals') === '1',
    };
}

export function serializeState(state) {
    const sp = new URLSearchParams();
    if (state.query) sp.set('q', state.query);
    if (state.category) sp.set('cat', state.category);
    for (const b of state.brands || []) sp.append('brand', b);
    if (state.nationwide) sp.set('nw', '1');
    if (state.inStock) sp.set('stock', '1');
    if (state.sort && state.sort !== 'relevance') sp.set('sort', state.sort);
    if (state.storeId != null) sp.set('store', String(state.storeId));
    if (state.product) sp.set('p', state.product);
    if (state.deals) sp.set('deals', '1');
    const out = sp.toString();
    return out ? `#${out}` : '';
}
