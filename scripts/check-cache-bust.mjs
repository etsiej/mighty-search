// Fails when style.css / app.js / src/*.js change without bumping the ?v= on their links in index.html.
// GitHub Pages lets browsers cache these for 10 minutes, so an un-bumped deploy shows visitors a stale site.
//   node scripts/check-cache-bust.mjs           staged changes vs HEAD (pre-commit)
//   node scripts/check-cache-bust.mjs <base>    <base>..HEAD (CI)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const base = process.argv[2];
if (base !== undefined && (!base || /^0+$/.test(base))) { console.log('cache-bust check: no base commit, skipping.'); process.exit(0); }

let changed, before, after, aboutHtml;
try {
    if (base) {
        changed = git('diff', '--name-only', base, 'HEAD').split('\n');
        before = git('show', `${base}:index.html`);
        after = readFileSync('index.html', 'utf8');
    } else {
        changed = git('diff', '--cached', '--name-only').split('\n');
        before = git('show', 'HEAD:index.html');
        after = git('show', ':index.html');
    }
} catch (e) {
    console.log(`cache-bust check: skipped (${e.message.split('\n')[0]})`);
    process.exit(0);
}

// about.html shares style.css; a missing/untracked copy only skips that one comparison, never the whole check
try {
    aboutHtml = base ? readFileSync('about.html', 'utf8') : git('show', ':about.html');
} catch { aboutHtml = undefined; }

const version = (html, file) => html.match(new RegExp(`${file.replace('.', '\\.')}\\?v=(\\d+)`))?.[1];
const cssChanged = changed.includes('style.css');
const jsChanged = changed.some((f) => f === 'app.js' || /^src\/.+\.js$/.test(f));
const problems = [];
if (cssChanged && version(after, 'style.css') === version(before, 'style.css')) problems.push('style.css changed but ?v= on its <link> in index.html did not');
if (jsChanged && version(after, 'app.js') === version(before, 'app.js')) problems.push('app.js or src/*.js changed but ?v= on the app.js <script> in index.html did not');
if (aboutHtml && version(aboutHtml, 'style.css') !== version(after, 'style.css')) problems.push('about.html links a different style.css ?v= than index.html');
if (problems.length) {
    console.error(`Cache-bust check failed:\n  - ${problems.join('\n  - ')}\nRun: npm run bump   (then stage index.html)`);
    process.exit(1);
}
console.log('cache-bust check ok.');
