// Verificar soporte del navegador
const isSupported = () => {
  return 'serviceWorker' in navigator && 'caches' in window;
};

// Estado de la aplicación
let deferredPrompt = null;
let isOffline = false;

// Elementos del DOM
const installButton = document.getElementById('installButton');

// Función de utilidad para logs
const log = (message, type = 'info') => {
  const timestamp = new Date().toLocaleTimeString();
  console[type](`[${timestamp}] ${message}`);
};

// Función para mostrar notificaciones al usuario
const showNotification = (message, type = 'info') => {
  // Crear elemento de notificación temporal
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    transform: translateX(100%);
    transition: transform 0.3s ease;
    ${type === 'success' ? 'background: #10b981;' : ''}
    ${type === 'error' ? 'background: #ef4444;' : ''}
    ${type === 'info' ? 'background: #3b82f6;' : ''}
    ${type === 'warning' ? 'background: #f59e0b;' : ''}
  `;
  
  document.body.appendChild(notification);
  
  // Animar entrada
  setTimeout(() => {
    notification.style.transform = 'translateX(0)';
  }, 100);
  
  // Remover después de 3 segundos
  setTimeout(() => {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
};

// Registrar Service Worker
const registerServiceWorker = async () => {
  if (!isSupported()) {
    log('Service Worker no soportado en este navegador', 'warn');
    showNotification('Tu navegador no soporta todas las funciones PWA', 'warning');
    return;
  }
  
  try {
    const registration = await navigator.serviceWorker.register('/pwa/service-worker.js');
    log('Service Worker registrado exitosamente', 'info');
    
    // Escuchar actualizaciones
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          log('Nueva versión disponible', 'info');
          showNotification('Nueva versión disponible. Actualizar ahora?', 'info');
          
          // Opcional: auto-actualizar
          setTimeout(() => {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
          }, 5000);
        }
      });
    });
    
    // Verificar estado del Service Worker
    if (registration.active) {
      log('Service Worker activo', 'info');
    }
    
    return registration;
  } catch (error) {
    log(`Error al registrar Service Worker: ${error.message}`, 'error');
    showNotification('Error al instalar funciones offline', 'error');
  }
};

// Manejar instalación PWA
const handleInstallPrompt = () => {
  // Escuchar evento beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    
    log('Evento de instalación PWA detectado', 'info');
    
    // Mostrar botón de instalación
    if (installButton) {
      installButton.style.display = 'block';
    }
  });
  
  // Manejar clic en botón de instalación
  if (installButton) {
    installButton.addEventListener('click', async () => {
      if (!deferredPrompt) {
        showNotification('La aplicación ya está instalada o no es compatible', 'warning');
        return;
      }
      
      deferredPrompt.prompt();
      
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        log('Usuario aceptó instalar la PWA', 'info');
        showNotification('¡Aplicación instalada exitosamente!', 'success');
      } else {
        log('Usuario rechazó instalar la PWA', 'info');
      }
      
      deferredPrompt = null;
      installButton.style.display = 'none';
    });
  }
  
  // Verificar si la app ya está instalada
  window.addEventListener('appinstalled', () => {
    log('PWA instalada exitosamente', 'info');
    showNotification('¡Aplicación instalada! Puedes encontrarla en tu pantalla principal', 'success');
    deferredPrompt = null;
  });
};

// Detectar estado de conexión
const handleConnectionStatus = () => {
  const updateConnectionStatus = () => {
    isOffline = !navigator.onLine;
    
    if (isOffline) {
      log('Aplicación en modo offline', 'warn');
      showNotification('Modo offline activado', 'info');
      document.body.classList.add('offline');
    } else {
      log('Conexión restaurada', 'info');
      showNotification('Conexión a internet restaurada', 'success');
      document.body.classList.remove('offline');
    }
  };
  
  // Escuchar cambios de conexión
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  
  // Estado inicial
  updateConnectionStatus();
};

// Funciones de caché
const cacheManager = {
  // Limpiar caché
  async clearCache() {
    if (!isSupported()) return;
    
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
      log('Caché limpiado exitosamente', 'info');
      showNotification('Caché limpiado', 'success');
    } catch (error) {
      log(`Error al limpiar caché: ${error.message}`, 'error');
    }
  },
  
  // Verificar espacio usado
  async checkCacheUsage() {
    if (!('storage' in navigator && 'estimate' in navigator.storage)) {
      return null;
    }
    
    try {
      const estimate = await navigator.storage.estimate();
      return {
        usage: Math.round(estimate.usage / 1024 / 1024 * 100) / 100,
        quota: Math.round(estimate.quota / 1024 / 1024 * 100) / 100,
        usagePercentage: Math.round((estimate.usage / estimate.quota) * 100)
      };
    } catch (error) {
      log(`Error al verificar uso de caché: ${error.message}`, 'error');
      return null;
    }
  }
};

// Funciones de utilidad
const utils = {
  // Verificar si es la primera visita
  isFirstVisit() {
    return !localStorage.getItem('pwa-visited');
  },
  
  // Marcar como visitado
  markAsVisited() {
    localStorage.setItem('pwa-visited', 'true');
  },
  
  // Obtener estadísticas del Service Worker
  async getSWStats() {
    if (!isSupported()) return null;
    
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return null;
      
      return {
        active: !!registration.active,
        installing: !!registration.installing,
        waiting: !!registration.waiting,
        updateViaCache: registration.updateViaCache,
        scope: registration.scope
      };
    } catch (error) {
      log(`Error al obtener estadísticas: ${error.message}`, 'error');
      return null;
    }
  }
};

// Inicializar la aplicación
const initApp = async () => {
  log('Inicializando aplicación PWA', 'info');
  
  // Verificar primera visita
  if (utils.isFirstVisit()) {
    log('Primera visita detectada', 'info');
    utils.markAsVisited();
    showNotification('¡Bienvenido! Esta aplicación funciona incluso sin conexión', 'success');
  }
  
  // Registrar Service Worker
  const swRegistration = await registerServiceWorker();
  
  // Manejar instalación PWA
  handleInstallPrompt();
  
  // Detectar estado de conexión
  handleConnectionStatus();
  
  // Mostrar estadísticas en consola (desarrollo)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    const stats = await utils.getSWStats();
    const cacheUsage = await cacheManager.checkCacheUsage();
    
    console.table({
      'Service Worker': stats?.active ? '✅ Activo' : '❌ Inactivo',
      'Modo Offline': isOffline ? '📴 Sí' : '📶 No',
      'Cache Usage': cacheUsage ? `${cacheUsage.usage}MB (${cacheUsage.usagePercentage}%)` : 'N/A',
      'Soporte PWA': isSupported() ? '✅ Sí' : '❌ No'
    });
  }
  
  log('Aplicación PWA inicializada exitosamente', 'info');
};

// Funciones globales para debugging
window.pwaUtils = {
  clearCache: cacheManager.clearCache,
  checkCacheUsage: cacheManager.checkCacheUsage,
  getSWStats: utils.getSWStats,
  isSupported
};

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Manejar errores globales
window.addEventListener('error', (event) => {
  log(`Error global: ${event.message}`, 'error');
});

window.addEventListener('unhandledrejection', (event) => {
  log(`Promesa rechazada: ${event.reason}`, 'error');
});