/* Service worker do Clipador (PWA).
   Guarda só a "casca" da janela (HTML, ícones, fonte, lucide) pra abrir rápido e
   mostrar um aviso se o programa estiver fechado. Nunca guarda /api, vídeos ou
   cortes: isso sempre vem do programa rodando no PC. */
const CACHE = 'clipador-v2';
const CASCA = ['/', '/ui/lucide.js', '/ui/manrope.woff2', '/ui/icone.png', '/ui/icone-192.png', '/ui/icone-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const FORA = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clipador</title>' +
  '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#050607;color:#fafaf7;font:16px system-ui;text-align:center;padding:24px">' +
  '<div><img src="/ui/icone-192.png" width="72" height="72" alt="" style="border-radius:18px"><h1 style="font-size:22px">O Clipador está fechado</h1>' +
  '<p style="color:#a39cb8;max-width:26em">Abra o programa no seu PC (atalho <b>Clipador</b> ou <b>iniciar.bat</b>) e toque em tentar de novo.</p>' +
  '<button onclick="location.reload()" style="margin-top:8px;padding:12px 22px;border:0;border-radius:12px;background:linear-gradient(90deg,#8b5cf6,#ec4899);color:#fff;font:inherit;font-weight:700">Tentar de novo</button></div>';

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  // So http(s) da propria origem. O video escolhido pela pessoa e um endereco
  // blob: e o service worker nao consegue busca-lo (dava "Failed to fetch").
  if (e.request.method !== 'GET' || !/^https?:$/.test(u.protocol) || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/') || u.pathname === '/arquivo') return; // sempre ao vivo
  // Rede primeiro (o programa pode ter sido atualizado); sem rede, a casca guardada.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && (e.request.mode === 'navigate' || CASCA.includes(u.pathname))) {
      const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request.mode === 'navigate' ? '/' : e.request, copia));
    }
    return r;
  }).catch(async () => {
    if (e.request.mode === 'navigate') return new Response(FORA, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return (await caches.match(e.request)) || Response.error();
  }));
});

// Clique na notificação "clipe pronto": traz a janela do Clipador pra frente.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => new URL(x.url).origin === location.origin);
    return c ? c.focus() : self.clients.openWindow('/');
  }));
});
