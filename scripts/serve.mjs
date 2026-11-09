// Static file server for local development. Ctrl+C to stop; no background process to clean up.
//   node scripts/serve.mjs [dir] [--port 8080] [--slow]
// --slow adds /slow.png (answers after 5s) so a screenshot can wait for the page's own fetches.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

export function startServer({ dir, port = 0, slow = false }) {
    const root = resolve(dir);
    const server = createServer(async (req, res) => {
        const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (slow && path === '/slow.png') {
            setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(); }, 5000);
            return;
        }
        const file = normalize(join(root, path === '/' ? 'index.html' : path));
        if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(body);
        } catch {
            res.writeHead(404).end('Not found');
        }
    });
    return new Promise((done) => server.listen(port, () => done({ server, port: server.address().port })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const flag = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
    const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') || fileURLToPath(new URL('../', import.meta.url));
    const { port } = await startServer({ dir, port: Number(flag('--port')) || 8080, slow: args.includes('--slow') });
    console.log(`Serving ${resolve(dir)} at http://localhost:${port}/  (Ctrl+C to stop)`);
}
