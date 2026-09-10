"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enviarComprobantePorMail = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const resend_1 = require("resend");
const email_1 = require("../email");
const rateLimit_1 = require("../rateLimit");
const templates_1 = require("../templates");
// Envío por mail de un comprobante que la app generó (factura, remito,
// composición de saldos, recibo) al cliente (2026-09-10, pedido de Ariel: "lo
// que más usan es el mail"). Un mailto: no puede adjuntar archivos, así que el
// PDF viaja en base64 a esta función y sale por Resend con el adjunto. Queda
// registrado en enviosComprobantes (quién, a quién, qué y cuándo).
//
// Quién puede: staff que cobra o gestiona (mismos roles que leen saldosTango).
// El destinatario lo elige el operador en pantalla (viene precargado con el
// mail de Tango del cliente): se valida el formato y se lo registra.
const ROLES = new Set([
    'super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'logistica',
    'facturacion', 'tesoreria', 'supervisor', 'caja', 'chofer',
]);
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
exports.enviarComprobantePorMail = (0, https_1.onCall)({ secrets: [email_1.resendApiKey], memory: '512MiB' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Requiere autenticación');
    const uid = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    const perfil = (await db.doc(`users/${uid}`).get()).data();
    const rol = (perfil?.rol ?? '');
    const rolesExtra = (perfil?.rolesExtra ?? []).map((r) => r?.rol ?? '');
    if (perfil?.estado !== 'activo' || (!ROLES.has(rol) && !rolesExtra.some((r) => ROLES.has(r)))) {
        throw new https_1.HttpsError('permission-denied', 'No autorizado');
    }
    await (0, rateLimit_1.assertRateLimit)(uid, 'enviarComprobantePorMail', 30, 3600);
    const d = (request.data ?? {});
    const para = texto(d.para, 120).toLowerCase();
    if (!EMAIL_RE.test(para))
        throw new https_1.HttpsError('invalid-argument', 'El mail del destinatario no es válido');
    const asunto = texto(d.asunto, 150);
    if (!asunto)
        throw new https_1.HttpsError('invalid-argument', 'Falta el asunto');
    const nombreArchivo = texto(d.nombreArchivo, 120).replace(/[^\w.-]+/g, '-') || 'comprobante.pdf';
    const pdfBase64 = String(d.pdfBase64 ?? '');
    if (!pdfBase64 || pdfBase64.length > MAX_PDF_BYTES * 1.4)
        throw new https_1.HttpsError('invalid-argument', 'El PDF falta o es demasiado grande');
    const pdf = Buffer.from(pdfBase64, 'base64');
    if (pdf.length < 100 || pdf.subarray(0, 4).toString() !== '%PDF')
        throw new https_1.HttpsError('invalid-argument', 'El adjunto no es un PDF');
    const comprobante = { tipo: texto(d.comprobante?.tipo, 20), numero: texto(d.comprobante?.numero, 40), ...(d.comprobante?.empresa ? { empresa: texto(d.comprobante.empresa, 20) } : {}) };
    const clienteNombre = texto(d.clienteNombre, 120) || 'cliente';
    const mensaje = texto(d.mensaje, 2000);
    const presentacion = {
        titulo: texto(d.presentacion?.titulo, 80) || `${comprobante.tipo} ${comprobante.numero}`.trim(),
        ...(d.presentacion?.emoji ? { emoji: texto(d.presentacion.emoji, 4) } : {}),
        filas: (Array.isArray(d.presentacion?.filas) ? d.presentacion.filas : []).slice(0, 8)
            .map((f) => ({ label: texto(f?.label, 30), value: texto(f?.value, 200) })).filter((f) => f.label && f.value),
    };
    const remitente = perfil?.nombre?.trim() || 'Rolito';
    const emailOperador = perfil?.email ?? '';
    const conCopia = d.conCopia === true && EMAIL_RE.test(emailOperador) && !emailOperador.endsWith('.internal') && !emailOperador.endsWith('@rolito.app');
    const apiKey = email_1.resendApiKey.value();
    if (!apiKey)
        throw new https_1.HttpsError('failed-precondition', 'El envío de mails no está configurado');
    const resend = new resend_1.Resend(apiKey);
    // Modo test (configuracion/notificaciones): mismo desvío que el resto de los mails.
    let destino = para;
    let subject = asunto;
    try {
        const cfg = (await db.doc('configuracion/notificaciones').get()).data();
        if (cfg?.modoTest === true && cfg?.testEmail) {
            destino = cfg.testEmail;
            subject = `[TEST → ${para}] ${asunto}`;
        }
    }
    catch { /* sin config: destino real */ }
    const { data, error } = await resend.emails.send({
        from: email_1.FROM_EMAIL,
        to: destino,
        ...(conCopia ? { cc: emailOperador } : {}),
        ...(EMAIL_RE.test(emailOperador) && !emailOperador.endsWith('.internal') && !emailOperador.endsWith('@rolito.app') ? { replyTo: emailOperador } : {}),
        subject,
        html: (0, templates_1.tplComprobanteEnviado)(clienteNombre, presentacion, mensaje, remitente),
        attachments: [{ filename: nombreArchivo, content: pdf }],
    });
    const registro = {
        para, asunto, comprobante, clienteNombre, nombreArchivo, bytes: pdf.length,
        ...(d.clienteUid ? { clienteUid: texto(d.clienteUid, 60) } : {}),
        enviadoPor: { uid, nombre: remitente },
        enviadoEn: firestore_1.FieldValue.serverTimestamp(),
        estado: error ? 'error' : 'enviado',
        ...(error ? { error: String(error.message ?? error) } : {}),
        ...(data?.id ? { resendId: data.id } : {}),
    };
    await db.collection('enviosComprobantes').add(registro);
    if (error) {
        console.error('Resend error (comprobante):', error);
        throw new https_1.HttpsError('internal', 'No se pudo enviar el mail. Probá de nuevo en un rato.');
    }
    return { ok: true, para };
});
//# sourceMappingURL=enviarComprobante.js.map