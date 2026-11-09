import { CATEGORY_SEPARATOR } from './filters.js';

/**
 * Turn Algolia's categoryPath.lvl0..3 facet counts into a tree.
 * Keys look like "Power Tools > Drills & Impact Drivers".
 */
export function buildCategoryTree(facets = {}) {
    const nodes = new Map();
    for (let depth = 0; depth <= 3; depth++) {
        const level = facets[`categoryPath.lvl${depth}`] || {};
        for (const [path, count] of Object.entries(level)) {
            const parts = path.split(CATEGORY_SEPARATOR);
            nodes.set(path, { path, name: parts[parts.length - 1], depth, count, children: [] });
        }
    }
    const roots = [];
    for (const node of nodes.values()) {
        const parentPath = node.path.split(CATEGORY_SEPARATOR).slice(0, -1).join(CATEGORY_SEPARATOR);
        const parent = nodes.get(parentPath);
        (parent ? parent.children : roots).push(node);
    }
    const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
    for (const node of nodes.values()) node.children.sort(byCount);
    return roots.sort(byCount);
}

/**
 * Rows for the sidebar. With no active category: the departments. Inside a
 * category: just the path down to it, then its sub-categories (or, at a leaf,
 * its siblings), so the list never buries where you are.
 */
export function visibleCategoryRows(roots, activePath) {
    if (!activePath) return [...roots];
    const parts = activePath.split(CATEGORY_SEPARATOR);
    const chain = [];
    let level = roots;
    for (let i = 0; i < parts.length; i++) {
        const path = parts.slice(0, i + 1).join(CATEGORY_SEPARATOR);
        const node = level.find((n) => n.path === path);
        if (!node) return [...roots]; // active category not in the facets (e.g. zero matches)
        chain.push(node);
        level = node.children;
    }
    const active = chain[chain.length - 1];
    const ancestors = chain.slice(0, -1);
    if (active.children.length) return [...ancestors, active, ...active.children];
    const parent = ancestors[ancestors.length - 1];
    return [...ancestors, ...(parent ? parent.children : roots)];
}

/** "A > B > C" -> [{name:"A",path:"A"},{name:"B",path:"A > B"},{name:"C",path:"A > B > C"}] */
export function categoryCrumbs(path) {
    if (!path) return [];
    const parts = path.split(CATEGORY_SEPARATOR);
    return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join(CATEGORY_SEPARATOR) }));
}

/** Department list (top-level categories) from a categoryPath.lvl0 facet, biggest first. */
export function departmentsFromFacet(facet = {}) {
    return Object.entries(facet)
        .filter(([name]) => name !== 'Other')
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * A product's deepest category as "A > B > C", in the same form as the categoryPath facet.
 * categoryPath itself cannot be read back from Algolia, but categoryNames carries
 * "ID|Name|/shop/a/b/c/ID" per level, and those URLs encode the hierarchy, so the chain stays
 * correct even when a product sits in several categories.
 */
export function bestCategoryPath(hit) {
    const levels = ['lvl0', 'lvl1', 'lvl2', 'lvl3'].map((lvl) =>
        (hit?.categoryNames?.[lvl] || []).map((raw) => {
            const [, name, url = ''] = String(raw).split('|');
            return { name, base: url.replace(/\/c\/[^/]+$/, '') };
        }).filter((e) => e.name));
    let depth = levels.length - 1;
    while (depth >= 0 && !levels[depth].length) depth--;
    if (depth < 0) return null;
    const chain = [levels[depth][0]];
    for (let d = depth - 1; d >= 0; d--) {
        const child = chain[0];
        const parent = levels[d].find((e) => e.base && child.base.startsWith(`${e.base}/`));
        if (!parent) break; // hierarchy not recoverable above this point; show what we have
        chain.unshift(parent);
    }
    return chain.map((e) => e.name).join(CATEGORY_SEPARATOR);
}
