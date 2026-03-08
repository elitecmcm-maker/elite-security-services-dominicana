// ══════════════════════════════════════════════════════════
// Elite Security Service — Cloud Functions
// Push notifications en background
// ══════════════════════════════════════════════════════════
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule }        = require("firebase-functions/v2/scheduler");
const { initializeApp }     = require("firebase-admin/app");
const { getFirestore }      = require("firebase-admin/firestore");
const { getMessaging }      = require("firebase-admin/messaging");

initializeApp();

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
const LABELS = { vestimenta:"Vestimenta", falta:"Falta/Ausencia", tardanza:"Tardanza", conducta:"Conducta" };
const APP_URL = "https://elite-security-services.web.app";

async function getAdminTokens(db) {
  const snap = await db.collection("usuarios").where("rol","==","admin").get();
  const tokens = [], refs = [];
  snap.forEach(doc => {
    if (doc.data().fcm_token) { tokens.push(doc.data().fcm_token); refs.push(doc.ref); }
  });
  return { tokens, refs };
}

async function enviarPush(messaging, tokens, titulo, cuerpo, data = {}) {
  if (!tokens.length) return null;
  return messaging.sendEachForMulticast({
    notification: { title: titulo, body: cuerpo },
    data,
    webpush: {
      notification: {
        title: titulo, body: cuerpo,
        icon:               "/icon-192.png",
        badge:              "/icon-192.png",
        requireInteraction: true,
        vibrate:            [200, 100, 200],
        tag:                data.tag || "elite-push",
        actions: [
          { action: "ver",    title: "👤 Ver Perfil" },
          { action: "cerrar", title: "✕ Cerrar"      },
        ],
      },
      fcmOptions: { link: APP_URL },
    },
    tokens,
  });
}

async function limpiarTokensInvalidos(db, response, tokens) {
  if (!response || response.failureCount === 0) return;
  const admins = await db.collection("usuarios").where("rol","==","admin").get();
  const batch = db.batch();
  response.responses.forEach((r, i) => {
    if (!r.success && (
      r.error.code === "messaging/invalid-registration-token" ||
      r.error.code === "messaging/registration-token-not-registered"
    )) {
      admins.forEach(doc => {
        if (doc.data().fcm_token === tokens[i]) batch.update(doc.ref, { fcm_token: null });
      });
    }
  });
  await batch.commit();
}

// ─────────────────────────────────────────────────────────
// TRIGGER 1: Nuevo reporte → notifica si alcanzó umbral
// ─────────────────────────────────────────────────────────
exports.notificarReporteNuevo = onDocumentCreated("reportes/{id}", async (event) => {
  const db        = getFirestore();
  const messaging = getMessaging();
  const r         = event.data.data();
  if (!r || !r.nombre || !r.tipo) return;

  // Contar reportes del mismo oficial + tipo
  const snap = await db.collection("reportes")
    .where("nombre", "==", r.nombre)
    .where("tipo",   "==", r.tipo)
    .get();
  const count = snap.size;

  // Leer umbral (default 3)
  const cfgDoc = await db.collection("configuracion").doc("push").get();
  const umbral = cfgDoc.exists ? parseInt(cfgDoc.data().umbral || 3) : 3;

  // Solo notificar exactamente al alcanzar el umbral o múltiplos (evita spam)
  if (count < umbral || (count > umbral && count % umbral !== 0)) return;

  const nivel  = count >= 6 ? "🔴 CRÍTICO" : count >= 4 ? "🟠 ALTO" : "🟡 MODERADO";
  const titulo = `${nivel} — Oficial Recurrente`;
  const cuerpo = `${r.nombre} acumula ${count} reportes de ${LABELS[r.tipo]||r.tipo}${r.zona ? " en "+r.zona : ""}`;

  const { tokens } = await getAdminTokens(db);
  const response = await enviarPush(messaging, tokens, titulo, cuerpo, {
    nombre: r.nombre,
    tipo:   r.tipo,
    zona:   r.zona || "",
    count:  String(count),
    tag:    `recurrente-${r.nombre.replace(/\s/g,"-")}-${r.tipo}`,
  });

  await limpiarTokensInvalidos(db, response, tokens);
  console.log(`✅ Push recurrencia: ${r.nombre} (${count}x ${r.tipo}) → ${tokens.length} admin(s)`);
});

// ─────────────────────────────────────────────────────────
// TRIGGER 2: Resumen mensual — día 1 a las 8am
// ─────────────────────────────────────────────────────────
exports.reporteMensualPush = onSchedule(
  { schedule: "0 8 1 * *", timeZone: "America/Santo_Domingo" },
  async () => {
    const db        = getFirestore();
    const messaging = getMessaging();
    const ahora     = new Date();
    const mesAnt    = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    const mesStr    = `${mesAnt.getFullYear()}-${String(mesAnt.getMonth()+1).padStart(2,"0")}`;
    const meses     = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

    const snap = await db.collection("reportes")
      .where("fecha",">=", mesStr+"-01")
      .where("fecha","<=", mesStr+"-31")
      .get();

    const total = snap.size;
    if (!total) return;

    const byTipo = { vestimenta:0, falta:0, tardanza:0, conducta:0 };
    snap.forEach(d => { if (byTipo[d.data().tipo] !== undefined) byTipo[d.data().tipo]++; });

    const titulo = `📅 Resumen de ${meses[mesAnt.getMonth()]} ${mesAnt.getFullYear()}`;
    const cuerpo = `${total} novedades — Faltas: ${byTipo.falta} · Vestimenta: ${byTipo.vestimenta} · Tardanzas: ${byTipo.tardanza} · Conducta: ${byTipo.conducta}`;

    const { tokens } = await getAdminTokens(db);
    await enviarPush(messaging, tokens, titulo, cuerpo, { tag: "resumen-mensual" });
    console.log(`✅ Push mensual ${meses[mesAnt.getMonth()]} → ${tokens.length} admin(s)`);
  }
);
