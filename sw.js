const VERSION = '0.4.2';
const SOURCE_COMMIT = '298be6317c4ac3c3d61b5862ab556691e0eaa24d';
const SOURCE_BASE = `https://raw.githubusercontent.com/JarekDymek/StrongNextGen/${SOURCE_COMMIT}/`;
const SHELL_CACHE = `strongnew-shell-${VERSION}`;
const APP_CACHE = `strongnew-app-${VERSION}-${SOURCE_COMMIT.slice(0, 8)}`;
const SHELL_FILES = ['./', './index.html', './app.html', './manifest.json', './version.json', './icon-192.png', './icon-512.png', './install-0.4.2.html'];
const REMOTE_FILES = ['src/app.js','src/competitors.js','src/data.js','src/scoring.js','src/storage.js','src/styles.css','src/competition-rules.js','src/competitor-data.js','src/runtime.js','src/state-migration.js','assets/logo-strong-man.png'];
const absolute = path => new URL(path, self.registration.scope).href;
const localRequest = path => new Request(absolute(path), { method: 'GET' });

function contentType(path, upstream) {
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  return upstream || 'application/octet-stream';
}

async function downloadRemote(path) {
  const response = await fetch(`${SOURCE_BASE}${path}`, { cache: 'no-store', mode: 'cors' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  if (path.endsWith('.js') || path.endsWith('.css')) {
    let body = await response.text();
    body = body.replaceAll('Strongman Next', 'StrongNew').replaceAll('strongman-next-v0.3.0', `strongnew-v${VERSION}`);
    return new Response(body, { status: 200, headers: { 'Content-Type': contentType(path), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-StrongNew-Source': SOURCE_COMMIT } });
  }
  return new Response(await response.arrayBuffer(), { status: 200, headers: { 'Content-Type': contentType(path, response.headers.get('Content-Type')), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-StrongNew-Source': SOURCE_COMMIT } });
}

async function cacheEverything() {
  const shell = await caches.open(SHELL_CACHE);
  for (const path of SHELL_FILES) {
    const request = localRequest(path);
    const response = await fetch(request, { cache: 'reload' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    await shell.put(request, response);
  }
  const app = await caches.open(APP_CACHE);
  for (const path of REMOTE_FILES) await app.put(localRequest(path), await downloadRemote(path));
}

self.addEventListener('install', event => {
  event.waitUntil(cacheEverything().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, APP_CACHE]);
    await Promise.all((await caches.keys()).filter(key => !keep.has(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function localPath(url) {
  const scope = new URL(self.registration.scope);
  return decodeURIComponent(new URL(url).pathname.slice(scope.pathname.length)).replace(/^\/+/, '');
}

self.addEventListener('message', event => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ version: VERSION, sourceCommit: SOURCE_COMMIT });
    return;
  }
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const path = localPath(url.href);

  event.respondWith((async () => {
    if (REMOTE_FILES.includes(path)) {
      const app = await caches.open(APP_CACHE);
      const cached = await app.match(localRequest(path));
      if (cached) return cached;
      try {
        const response = await downloadRemote(path);
        await app.put(localRequest(path), response.clone());
        return response;
      } catch {
        return new Response('Brak zasobu aplikacji offline', { status: 503 });
      }
    }

    const shell = await caches.open(SHELL_CACHE);
    const cached = await shell.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await shell.put(event.request, response.clone());
      return response;
    } catch {
      if (event.request.mode === 'navigate') return shell.match(path.startsWith('app.html') ? localRequest('./app.html') : localRequest('./index.html'));
      return new Response('Offline', { status: 503 });
    }
  })());
});
