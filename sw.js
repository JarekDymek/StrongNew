const VERSION = '0.3.1';
const SOURCE_COMMIT = '298be6317c4ac3c3d61b5862ab556691e0eaa24d';
const SOURCE_BASE = `https://raw.githubusercontent.com/JarekDymek/StrongNextGen/${SOURCE_COMMIT}/`;
const SHELL_CACHE = `strongnew-shell-${VERSION}`;
const APP_CACHE = `strongnew-app-${VERSION}-${SOURCE_COMMIT.slice(0, 8)}`;
const READY_KEY = '__strongnew_ready__';

const SHELL_FILES = [
  './', './index.html', './app.html', './manifest.json', './version.json',
  './icon-192.png', './icon-512.png'
];

const REMOTE_FILES = [
  'src/app.js',
  'src/competitors.js',
  'src/data.js',
  'src/scoring.js',
  'src/storage.js',
  'src/styles.css',
  'src/competition-rules.js',
  'src/competitor-data.js',
  'src/runtime.js',
  'src/state-migration.js',
  'assets/logo-strong-man.png'
];

const scopeUrl = path => new URL(path, self.registration.scope).href;
const cacheKey = path => new Request(scopeUrl(path), { method: 'GET' });

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_FILES.map(path => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, APP_CACHE]);
    await Promise.all((await caches.keys()).filter(key => !keep.has(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

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
    body = body
      .replaceAll('Strongman Next', 'StrongNew')
      .replaceAll('strongman-next-v0.3.0', 'strongnew-v0.3.1');
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType(path),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-StrongNew-Source': SOURCE_COMMIT
      }
    });
  }

  const body = await response.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType(path, response.headers.get('Content-Type')),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-StrongNew-Source': SOURCE_COMMIT
    }
  });
}

async function notify(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(client => client.postMessage(message));
}

async function appIsReady(cache) {
  const marker = await cache.match(cacheKey(READY_KEY));
  if (!marker) return false;
  try {
    const data = await marker.json();
    return data.version === VERSION && data.commit === SOURCE_COMMIT;
  } catch {
    return false;
  }
}

async function cacheApplication() {
  const cache = await caches.open(APP_CACHE);
  if (await appIsReady(cache)) {
    await notify({ type: 'CACHE_READY', cached: true, version: VERSION });
    return;
  }

  let loaded = 0;
  for (const path of REMOTE_FILES) {
    const response = await downloadRemote(path);
    await cache.put(cacheKey(path), response);
    loaded += 1;
    await notify({ type: 'CACHE_PROGRESS', loaded, total: REMOTE_FILES.length, path });
  }

  await cache.put(cacheKey(READY_KEY), new Response(JSON.stringify({
    version: VERSION,
    commit: SOURCE_COMMIT,
    cachedAt: new Date().toISOString()
  }), { headers: { 'Content-Type': 'application/json' } }));
  await notify({ type: 'CACHE_READY', cached: false, version: VERSION });
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type !== 'CACHE_APP') return;
  event.waitUntil(cacheApplication().catch(async error => {
    await notify({ type: 'CACHE_ERROR', message: error?.message || String(error) });
  }));
});

function localPath(url) {
  const scope = new URL(self.registration.scope);
  const pathname = new URL(url).pathname;
  return decodeURIComponent(pathname.slice(scope.pathname.length)).replace(/^\/+/, '');
}

async function serveRemotePath(path) {
  const cache = await caches.open(APP_CACHE);
  const key = cacheKey(path);
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const response = await downloadRemote(path);
    await cache.put(key, response.clone());
    return response;
  } catch {
    if (path.endsWith('.css')) return new Response('', { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
    if (path.endsWith('.js')) return new Response(`throw new Error('Brak pliku offline: ${path}')`, { status: 503, headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
    return new Response('Brak zasobu offline', { status: 503 });
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const path = localPath(url.href);

  if (REMOTE_FILES.includes(path)) {
    event.respondWith(serveRemotePath(path));
    return;
  }

  event.respondWith((async () => {
    const shell = await caches.open(SHELL_CACHE);
    const cached = await shell.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await shell.put(event.request, response.clone());
      return response;
    } catch {
      if (event.request.mode === 'navigate') {
        const fallback = path.startsWith('app.html')
          ? await shell.match('./app.html')
          : await shell.match('./index.html');
        if (fallback) return fallback;
      }
      return new Response('Offline', { status: 503 });
    }
  })());
});
