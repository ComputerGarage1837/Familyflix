// Read-only local preview of the production bundle with synthetic public server endpoints.
// No requests are forwarded to Jellyfin, and no real authentication is accepted.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const installed = 'C:\\Program Files\\Jellyfin\\Server\\jellyfin-web';
const preserved = new Set(['config.json', 'manifest.json', 'robots.txt', 'familyflix-watchlist-v4.js', 'familyflix-watchlist-v4.css']);
const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.wasm':'application/wasm' };
const serverId = '55555555aaaa4bbb8ccc111111111111';
http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:51725');
    const pathname = decodeURIComponent(url.pathname);
    function json(value, status = 200) {
        response.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
        response.end(JSON.stringify(value));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ Message:'Synthetic preview is read-only' }, 405);
    if (/\/System\/Info\/Public$/i.test(pathname)) return json({
        Id:serverId, Version:'10.11.5', ProductName:'Jellyfin Server', ServerName:'Family Flix Preview',
        LocalAddress:'http://127.0.0.1:51725', StartupWizardCompleted:true
    });
    if (/\/Users\/Public$/i.test(pathname)) return json([
        { Id:'11111111222243338444555555555551', Name:'Test Alex', ServerId:serverId, HasPassword:true },
        { Id:'11111111222243338444555555555552', Name:'Test Blair', ServerId:serverId, HasPassword:true }
    ]);
    if (/\/Branding\/Configuration$/i.test(pathname)) return json({ LoginDisclaimer:'Isolated production preview — synthetic users only.' });
    if (/\/Branding\/Css$/i.test(pathname)) { response.writeHead(200, { 'Content-Type':'text/css' }); return response.end(''); }
    if (/\/QuickConnect\/Enabled$/i.test(pathname)) return json(false);
    if (/\/Localization\//i.test(pathname)) return json([]);
    let relative = pathname.replace(/^\/web\/?/i, '').replace(/^\/+/, '') || 'index.html';
    const destination = path.resolve(preserved.has(relative) ? installed : root, relative);
    const allowedRoot = preserved.has(relative) ? installed : root;
    if (!destination.startsWith(allowedRoot + path.sep)) return json({}, 403);
    try {
        let content = await readFile(destination);
        if (relative === 'index.html') content = Buffer.from(content.toString().replace(/<script\b/,
            '<link rel="stylesheet" href="familyflix-watchlist-v4.css?v=4"><script defer src="familyflix-watchlist-v4.js?v=4"></script><script'));
        response.writeHead(200, { 'Content-Type':types[path.extname(relative)] || 'application/octet-stream', 'Cache-Control':'no-store' });
        response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
        console.log(`Preview missing GET: ${pathname}`);
        json({ Message:'Not part of the synthetic preview' }, 404);
    }
}).listen(51725, '127.0.0.1', () => console.log('Read-only production preview: http://127.0.0.1:51725/web/index.html'));
