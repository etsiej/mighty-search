// Increment the ?v= cache-busting number on the style.css / app.js links in index.html,
// but only for the files that actually changed (so visitors don't re-download an untouched file).
// With nothing detected (clean tree), bumps both.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

let changed = [];
try {
    changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
} catch { /* not a git checkout: fall through and bump both */ }

const css = changed.includes('style.css');
const js = changed.some((f) => f === 'app.js' || /^src\/.+\.js$/.test(f));
const targets = css || js ? [css && 'style\\.css', js && 'app\\.js'].filter(Boolean) : ['style\\.css', 'app\\.js'];

let html = readFileSync('index.html', 'utf8');
const bumped = [];
html = html.replace(new RegExp(`((?:${targets.join('|')})\\?v=)(\\d+)`, 'g'), (match, head, n) => {
    bumped.push(`${head}${Number(n) + 1}`);
    return `${head}${Number(n) + 1}`;
});
if (!bumped.length) { console.error('No ?v= links found in index.html'); process.exit(1); }
writeFileSync('index.html', html);

// about.html shares style.css, so it must carry the same version
const cssVersion = html.match(/style\.css\?v=(\d+)/)?.[1];
if (cssVersion) {
    const about = readFileSync('about.html', 'utf8').replace(/style\.css\?v=\d+/, `style.css?v=${cssVersion}`);
    writeFileSync('about.html', about);
}
console.log(`Bumped: ${bumped.join(', ')}`);
