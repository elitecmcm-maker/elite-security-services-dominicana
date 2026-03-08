// ══════════════════════════════════════════════════════════
// firebase-messaging-sw.js  —  Elite Security Service
// Coloca este archivo en la RAÍZ de tu Firebase Hosting
// ══════════════════════════════════════════════════════════

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyB-_GNAd8MzR1BAsmq8x3cEHDnzurBVGAI",
  authDomain:        "elite-security-services.firebaseapp.com",
  projectId:         "elite-security-services",
  storageBucket:     "elite-security-services.appspot.com",
  messagingSenderId: "570385947769",
  appId:             "1:570385947769:web:6cf4616472d9e4630b88a8"
});

const messaging = firebase.messaging();
const APP_URL   = "https://elite-security-services.web.app";

// ──────────────────────────────────────────────────────────
// Notificaciones cuando la app está en BACKGROUND o CERRADA
// ──────────────────────────────────────────────────────────
messaging.onBackgroundMessage(payload => {
  const notif  = payload.notification || {};
  const data   = payload.data         || {};
  const titulo = notif.title || "⚠️ Elite Security";
  const cuerpo = notif.body  || "Hay una alerta pendiente.";

  self.registration.showNotification(titulo, {
    body:               cuerpo,
    icon:               "/icon-192.png",
    badge:              "/icon-192.png",
    tag:                data.tag || "elite-bg-push",
    requireInteraction: true,
    vibrate:            [200, 100, 200],
    data: {
      url:    APP_URL,
      nombre: data.nombre || "",
      tipo:   data.tipo   || "",
    },
    actions: [
      { action: "ver",    title: "👤 Ver Perfil" },
      { action: "cerrar", title: "✕ Cerrar"      },
    ],
  });
});

// ──────────────────────────────────────────────────────────
// Clic en la notificación
// ──────────────────────────────────────────────────────────
self.addEventListener("notificationclick", e => {
  e.notification.close();
  if (e.action === "cerrar") return;

  const notifData = e.notification.data || {};
  const targetUrl = APP_URL;

  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.startsWith(APP_URL) && "focus" in client) {
          if (e.action === "ver" && notifData.nombre)
            client.postMessage({ type: "ABRIR_PERFIL", nombre: notifData.nombre });
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
