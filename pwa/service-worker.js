// Configuración del Service Worker
// Version bump: actualice estos valores cuando necesite invalidar caches en despliegues
const CACHE_NAME = 'mi-pwa-v1.0.1';
const STATIC_CACHE = 'pwa-static-v2';
const DYNAMIC_CACHE = 'pwa-dynamic-v1';

// Archivos estáticos a cachear
// Archivos estáticos a cachear (intencionalmente sin '/index.html')
const STATIC_ASSETS = [
  '/styles.css',
  '/app.js',
  '/pwa/manifest.json',
  '/pwa/logo-app.png'
];
// Nota: evitamos cachear la raíz '/index.html' para que las rutas de páginas internas no queden forzadas

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

// Estrategia de caché: Network First para todos los recursos
const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    // Solo cachear respuestas válidas
    if (response.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Sin conexión, usando caché:', error);
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    
    // Retornar respuesta offline personalizada para documentos HTML
    if (request.destination === 'document' || request.mode === 'navigate') {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Sin conexión</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              display: flex; 
              align-items: center; 
              justify-content: center; 
              height: 100vh; 
              margin: 0; 
              background: #f5f5f5; 
            }
            .offline-container { 
              text-align: center; 
              padding: 40px; 
              background: white; 
              border-radius: 10px; 
              box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
            }
            .offline-icon { 
              font-size: 48px; 
              margin-bottom: 20px; 
            }
          </style>
        </head>
        <body>
          <div class="offline-container">
            <div class="offline-icon">📡</div>
            <h1>Sin conexión a internet</h1>
            <p>La aplicación intentará conectarse a la red primero.</p>
            <p>Por favor, verifica tu conexión y vuelve a intentar.</p>
          </div>
        </body>
        </html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    return new Response('Sin conexión', { status: 503 });
  }
};

// Manejo de eventos fetch
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Ignorar solicitudes no-GET
  if (request.method !== 'GET') {
    return;
  }
  
  // Aplicar estrategia Network First a TODOS los recursos
  event.respondWith(networkFirst(request));
});

// Actualización automática del Service Worker
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
  console.log('[SW] Mensaje SKIP_WAITING recibido. Activando nuevo SW...');
  self.skipWaiting();
  }
});