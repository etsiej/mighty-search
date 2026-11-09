// Pure helpers that turn the app's search state into Algolia requests.

export const INDEX_BY_SORT = {
    relevance: 'retail_products_relevance',
    price_asc: 'retail_products_price_asc',
    price_desc: 'retail_products_price_desc',
};
export const FACET_INDEX = INDEX_BY_SORT.relevance;
export const CATEGORY_SEPARATOR = ' > ';

export function quote(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function indexFor(sort) {
    return INDEX_BY_SORT[sort] || INDEX_BY_SORT.relevance;
}

export function categoryFilter(path) {
    const depth = path.split(CATEGORY_SEPARATOR).length - 1;
    return `categoryPath.lvl${depth}:${quote(path)}`;
}

/**
 * Category facets only need the neighbourhood of the active category. Without
 * this scope Algolia returns just the biggest 1000 categories catalogue-wide,
 * and small sub-categories silently vanish from the sidebar.
 */
export function categoryScope(path) {
    if (!path) return null;
    const parts = path.split(CATEGORY_SEPARATOR);
    return parts.length > 1 ? parts.slice(0, -1).join(CATEGORY_SEPARATOR) : path;
}

/**
 * Build the Algolia `filters` string for a search state.
 * `omit` leaves a filter out so its own facet counts stay complete.
 */
export function buildFilters(state, omit = {}) {
    const parts = ['online:true'];
    if (state.nationwide) parts.push('availableNationWide:true');
    if (state.inStock && state.storeId != null) parts.push(`storesWithStock:${Number(state.storeId)}`);
    if (state.category && !omit.category) parts.push(categoryFilter(state.category));
    if (state.brands?.length && !omit.brands) {
        parts.push(`(${state.brands.map((b) => `brandName:${quote(b)}`).join(' OR ')})`);
    }
    return parts.join(' AND ');
}

function params(obj) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) {
        sp.set(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
    }
    return sp.toString();
}

/**
 * Requests for Algolia's multi-query endpoint: the result page, plus (on the
 * first page) category and brand facet counts that respect every filter except
 * their own, so the sidebar always agrees with the results.
 */
export function buildRequests(state, { page = 0, hitsPerPage, attributesToRetrieve, withFacets = true }) {
    const requests = [
        {
            indexName: indexFor(state.sort),
            params: params({
                query: state.query,
                page,
                hitsPerPage,
                filters: buildFilters(state),
                attributesToRetrieve,
                attributesToHighlight: ['name', 'brandName'],
                highlightPreTag: '<em>',
                highlightPostTag: '</em>',
            }),
        },
    ];
    if (withFacets) {
        requests.push(
            {
                indexName: FACET_INDEX,
                params: params({
                    query: state.query,
                    hitsPerPage: 0,
                    filters: [buildFilters(state, { category: true }), state.category && categoryFilter(categoryScope(state.category))]
                        .filter(Boolean).join(' AND '),
                    facets: ['categoryPath.lvl0', 'categoryPath.lvl1', 'categoryPath.lvl2', 'categoryPath.lvl3'],
                    maxValuesPerFacet: 1000,
                }),
            },
            {
                indexName: FACET_INDEX,
                params: params({
                    query: state.query,
                    hitsPerPage: 0,
                    filters: buildFilters(state, { brands: true }),
                    facets: ['brandName'],
                    maxValuesPerFacet: 100,
                }),
            },
        );
    }
    return requests;
}

/** True when the product has stock at the given store; null when no store chosen. */
export function stockAt(hit, storeId) {
    if (storeId == null) return null;
    return (hit.storesWithStock || []).map(Number).includes(Number(storeId));
}
