// Screenshots of the live-data site at phone and desktop widths, light and dark, into .shots/
//   npm run shots            (then LOOK at the 390px images before calling UI work done)
// Needs Firefox or Chrome/Chromium on PATH. Not a pass/fail check: it produces pictures to review.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const out = join(repo, '.shots');
const which = (bin) => { try { return execFileSync('which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const browser = ['firefox', 'chromium', 'chromium-browser', 'google-chrome'].map((b) => [b, which(b)]).find(([, p]) => p);
if (!browser) { console.error('No Firefox/Chrome/Chromium on PATH.'); process.exit(1); }
const [browserName, browserPath] = browser;

const PHONE = [390, 844], DESKTOP = [1300, 900];
const DEPT = '#cat=Power%20Tools%20%3E%20Drills%20%26%20Impact%20Drivers&store=31';
const SHOTS = [
    { name: 'home-desktop', hash: '', size: DESKTOP },
    { name: 'home-phone', hash: '', size: PHONE },
    { name: 'department-desktop', hash: DEPT, size: DESKTOP },
    { name: 'department-phone', hash: DEPT, size: [390, 1400] },
    { name: 'deals-phone', hash: '#deals=1&store=31', size: [390, 1400] },
    { name: 'product-desktop', hash: '#p=173438&store=31', size: [1300, 900] },
    { name: 'product-phone', hash: '#p=173438&store=31', size: [390, 1500] },
    { name: 'about-phone', path: 'about.html', hash: '', size: [390, 1600] },
    { name: 'home-desktop-dark', hash: '', size: DESKTOP, dark: true },
    { name: 'department-phone-dark', hash: DEPT, size: [390, 1400], dark: true },
];

/** A copy of the site that holds the page "loading" for 5s, so screenshots wait for the data fetches. */
function siteCopy(dark) {
    const dir = mkdtempSync(join(tmpdir(), 'mighty-shots-'));
    for (const f of ['index.html', 'about.html', 'app.js', 'style.css', 'src', 'stores-lite.json', 'data']) cpSync(join(repo, f), join(dir, f), { recursive: true });
    const html = readFileSync(join(dir, 'index.html'), 'utf8').replace('</body>', '<img src="/slow.png" width="1" height="1" style="position:absolute"></body>');
    writeFileSync(join(dir, 'index.html'), html);
    if (dark) { // headless browsers ignore the OS setting, so apply the dark rules unconditionally
        const css = readFileSync(join(dir, 'style.css'), 'utf8').replaceAll('@media (prefers-color-scheme: dark)', '@media all');
        writeFileSync(join(dir, 'style.css'), css);
    }
    return dir;
}

mkdirSync(out, { recursive: true });
const servers = {};
for (const dark of [false, true]) {
    const dir = siteCopy(dark);
    servers[dark] = { dir, ...(await startServer({ dir, slow: true })) };
}

const profile = mkdtempSync(join(tmpdir(), 'mighty-profile-'));
for (const shot of SHOTS) {
    const file = join(out, `${shot.name}.png`);
    const url = `http://localhost:${servers[Boolean(shot.dark)].port}/${shot.path ?? ''}${shot.hash}`;
    const [w, h] = shot.size;
    const args = browserName === 'firefox'
        ? ['--headless', '--profile', profile, `--window-size=${w},${h}`, '--screenshot', file, url]
        : ['--headless', '--no-sandbox', `--window-size=${w},${h}`, `--screenshot=${file}`, '--virtual-time-budget=9000', url];
    // async on purpose: the static server lives in this process, so blocking here would starve the browser
    const status = await new Promise((done) => {
        const child = spawn(browserPath, args, { stdio: 'ignore' });
        const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
        child.on('exit', (code) => { clearTimeout(timer); done(code); });
        child.on('error', () => { clearTimeout(timer); done(-1); });
    });
    console.log(status === 0 ? `ok   ${file}` : `FAIL ${shot.name} (exit ${status})`);
}
for (const { server, dir } of Object.values(servers)) { server.close(); rmSync(dir, { recursive: true, force: true }); }
rmSync(profile, { recursive: true, force: true });
console.log(`\nLook at ${out}/*.png, especially the *-phone images.`);
process.exit(0);
