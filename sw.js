// ============================================================
// SERVICE WORKER — Sistema de Mantenimiento Sanatorio
// Archivo: sw.js — subir a la raíz del repositorio en GitHub
// ============================================================

const SW_VERSION = "v1.2";
const CHECK_INTERVAL = 60000; // 60 segundos

// ── INSTALACIÓN ──────────────────────────────────────────────
self.addEventListener("install", e => {
  console.log("[SW] Instalado:", SW_VERSION);
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  console.log("[SW] Activo:", SW_VERSION);
  e.waitUntil(self.clients.claim());
});

// ── NOTIFICACIONES PUSH ───────────────────────────────────────
self.addEventListener("message", e => {
  if (!e.data) return;

  if (e.data.type === "NOTIFY") {
    self.registration.showNotification(e.data.title || "🏥 Mantenimiento", {
      body: e.data.body || "",
      icon: "/mantenimiento-sanatorio/icon-192.png",
      badge: "/mantenimiento-sanatorio/icon-192.png",
      tag: "pedido-nuevo",
      requireInteraction: e.data.urgente || false,
      vibrate: e.data.urgente ? [200, 100, 200, 100, 200] : [200, 100, 200],
      data: { url: e.data.url || "/mantenimiento-sanatorio/" }
    });
  }

  if (e.data.type === "START_POLLING") {
    // La app le pide al SW que empiece a revisar periódicamente
    startPolling(e.data.apiUrl, e.data.lastIds || []);
  }
});

// ── CLIC EN NOTIFICACIÓN ──────────────────────────────────────
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url)
    ? e.notification.data.url
    : "/mantenimiento-sanatorio/";

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(clients => {
        // Si la app ya está abierta, enfocarla
        for (const client of clients) {
          if (client.url.includes("mantenimiento-sanatorio") && "focus" in client) {
            return client.focus();
          }
        }
        // Si no está abierta, abrirla
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});

// ── POLLING EN BACKGROUND ─────────────────────────────────────
let pollingInterval = null;
let knownIds = new Set();
let apiUrl = "";

function startPolling(url, existingIds) {
  if (!url) return;
  apiUrl = url;
  existingIds.forEach(id => knownIds.add(id));

  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(checkPedidos, CHECK_INTERVAL);
  console.log("[SW] Polling iniciado cada", CHECK_INTERVAL / 1000, "seg");
}

async function checkPedidos() {
  if (!apiUrl) return;
  try {
    const params = new URLSearchParams({ action: "getPedidos" });
    const res = await fetch(apiUrl + "?" + params.toString(), { method: "GET" });
    const data = await res.json();

    if (!Array.isArray(data)) return;

    const pendientes = data.filter(p => p.Estado === "Pendiente");

    if (knownIds.size === 0) {
      // Primera carga — solo registrar IDs sin notificar
      pendientes.forEach(p => knownIds.add(p.ID));
      return;
    }

    const nuevos = pendientes.filter(p => !knownIds.has(p.ID));
    pendientes.forEach(p => knownIds.add(p.ID));

    if (nuevos.length === 0) return;

    // Notificar pedidos nuevos
    for (const p of nuevos) {
      const urgente = p.Urgencia === "Alta";
      const titulo = urgente
        ? "🔴 Pedido URGENTE — " + (p.Servicio || "")
        : "🔔 Nuevo pedido — " + (p.Servicio || "");
      const cuerpo = (p.Descripcion || "").substring(0, 100);

      await self.registration.showNotification(titulo, {
        body: cuerpo,
        tag: "pedido-" + p.ID,
        requireInteraction: urgente,
        vibrate: urgente ? [300, 100, 300, 100, 300] : [200],
        data: { url: "/mantenimiento-sanatorio/" }
      });

      // También avisar a la app si está abierta
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach(client => {
        client.postMessage({ type: "NUEVO_PEDIDO", pedido: p });
      });
    }

  } catch (err) {
    console.warn("[SW] Error en polling:", err);
  }
}

// ── FETCH — Cache básico para funcionar offline ───────────────
self.addEventListener("fetch", e => {
  // Solo cachear recursos estáticos de la app
  if (e.request.url.includes("mantenimiento-sanatorio") &&
      !e.request.url.includes("script.google.com")) {
    e.respondWith(
      caches.open("mant-v1").then(cache =>
        cache.match(e.request).then(cached => {
          const fetchPromise = fetch(e.request).then(response => {
            if (response && response.status === 200) {
              cache.put(e.request, response.clone());
            }
            return response;
          });
          return cached || fetchPromise;
        })
      )
    );
  }
});
