// Configuración del Service Worker
const CACHE_NAME = 'mi-pwa-v1.0.0';
const STATIC_CACHE = 'pwa-static-v1';
const DYNAMIC_CACHE = 'pwa-dynamic-v1';

// Archivos estáticos a cachear
const STATIC_ASSETS = [
  '/index.html',
  '/styles.css',
  '/app.js',
  '/pwa/manifest.json',
  '/pwa/icons/icon-192x192.png',
  '/pwa/icons/icon-512x512.png'
];

// Rutas de API o contenido dinámico
const DYNAMIC_URLS = [
  // Agrega aquí tus endpoints de API
];

// Instalación del Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Cacheando archivos estáticos...');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((error) => {
        console.error('[SW] Error al cachear archivos estáticos:', error);
      })
  );
  
  // Activar inmediatamente el nuevo Service Worker
  self.skipWaiting();
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando Service Worker...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
            console.log('[SW] Eliminando caché antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  // Tomar control de las páginas inmediatamente
  return self.clients.claim();
});

// Estrategia de caché: Cache First para recursos estáticos
const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    console.error('[SW] Error en cacheFirst:', error);
    // Retornar página offline personalizada si existe
    if (request.destination === 'document') {
      return new Response('Disponible offline', {status: 200, headers: {'Content-Type': 'text/html'}});
    }
  }
};

// Estrategia de caché: Network First para contenido dinámico
const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    console.error('[SW] Error en networkFirst:', error);
    const cached = await caches.match(request);
    return cached || caches.match('/offline.html');
  }
};

// Estrategia de caché: Stale While Revalidate
const staleWhileRevalidate = async (request) => {
  const cached = await caches.match(request);
  
  const fetchPromise = fetch(request).then((response) => {
    const cache = caches.open(DYNAMIC_CACHE);
    cache.then((c) => c.put(request, response.clone()));
    return response;
  }).catch(() => cached);
  
  return cached || fetchPromise;
};

// Manejo de eventos fetch
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Ignorar solicitudes no-GET
  if (request.method !== 'GET') {
    return;
  }
  
  // Manejar diferentes tipos de recursos
  if (url.origin === location.origin) {
    // Recursos estáticos (CSS, JS, imágenes, etc.)
    if (request.destination === 'style' || 
        request.destination === 'script' || 
        request.destination === 'image' ||
        request.destination === 'font') {
      event.respondWith(cacheFirst(request));
    }
    // HTML y otros documentos
    else if (request.destination === 'document') {
      event.respondWith(networkFirst(request));
    }
    // API y contenido dinámico
    else if (url.pathname.startsWith('/api/')) {
      event.respondWith(networkFirst(request));
    }
    // Cualquier otro recurso
    else {
      event.respondWith(staleWhileRevalidate(request));
    }
  }
  
  // Recursos externos (CDN, etc.)
  else {
    if (request.destination === 'image' || request.destination === 'font') {
      event.respondWith(cacheFirst(request));
    } else {
      event.respondWith(staleWhileRevalidate(request));
    }
  }
});

// Actualización automática del Service Worker
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});