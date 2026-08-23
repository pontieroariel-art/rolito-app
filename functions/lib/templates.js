"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tplRegistroPendiente = tplRegistroPendiente;
exports.tplCuentaAprobada = tplCuentaAprobada;
exports.tplPedidoRecibido = tplPedidoRecibido;
exports.tplPedidoConfirmado = tplPedidoConfirmado;
exports.tplPedidoEnCamino = tplPedidoEnCamino;
exports.tplPedidoCerca = tplPedidoCerca;
exports.tplPedidoReprogramado = tplPedidoReprogramado;
exports.tplAdminNuevoPedido = tplAdminNuevoPedido;
exports.tplTicketCerrado = tplTicketCerrado;
exports.tplStockBajo = tplStockBajo;
exports.tplAdminNuevoCliente = tplAdminNuevoCliente;
exports.tplAdminAccionAltoRiesgo = tplAdminAccionAltoRiesgo;
exports.tplAdminResumenDiario = tplAdminResumenDiario;
// Escapa datos controlados por el usuario (razón social, notas, nombres de
// producto, motivo, dirección, teléfono) antes de interpolarlos en el HTML del
// email. Sin esto, p. ej. una razón social con markup podría inyectar contenido
// (links, layout roto) en el correo que recibe el staff. Se aplica solo al dato
// crudo, nunca al markup que los templates arman a propósito.
function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const LOGO_URL = 'https://rolito-app.web.app/logo-rolito.png';
const GREEN = '#1D9E75';
const GREEN_DARK = '#166a50';
const GREEN_BG = '#e8f5ef';
const DARK = '#081C11';
function layout(pageTitle, banner, body) {
    const accent = banner.accentColor ?? GREEN;
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${pageTitle}</title>
</head>
<body style="margin:0;padding:0;background:#edf0ee;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
  style="background:#edf0ee">
  <tr><td align="center" style="padding:36px 16px 48px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
      style="width:100%;max-width:560px">

      <!-- LOGO -->
      <tr>
        <td style="background:#ffffff;border-radius:16px 16px 0 0;
          padding:24px 40px 22px;text-align:center;
          border-bottom:1px solid #e8ede9">
          <img src="${LOGO_URL}" alt="Rolito — El nombre del Hielo"
            width="160" style="display:block;margin:0 auto;max-width:160px;
            height:auto;border:0">
        </td>
      </tr>

      <!-- BANNER -->
      <tr>
        <td style="background:${DARK};padding:28px 40px 26px;text-align:center">
          <p style="margin:0;font-size:34px;line-height:1">${banner.emoji}</p>
          <p style="margin:10px 0 0;color:#ffffff;font-size:20px;font-weight:700;
            letter-spacing:-0.3px;line-height:1.3">${banner.title}</p>
          ${banner.subtitle
        ? `<p style="margin:6px 0 0;color:#9ca3af;font-size:13px">${banner.subtitle}</p>`
        : ''}
        </td>
      </tr>

      <!-- ACCENT LINE -->
      <tr><td style="background:${accent};height:3px;font-size:0;line-height:0">&nbsp;</td></tr>

      <!-- BODY -->
      <tr>
        <td style="background:#ffffff;padding:36px 40px;color:#111827;
          font-size:15px;line-height:1.75">
          ${body}
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background:#f5f7f5;border-top:1px solid #e5e7eb;
          border-radius:0 0 16px 16px;padding:20px 40px;text-align:center">
          <p style="margin:0 0 4px;color:#9ca3af;font-size:12px">
            &copy; ${new Date().getFullYear()} Rolito &middot; Distribución de Hielo
          </p>
          <p style="margin:0;font-size:12px">
            <a href="https://rolito-app.web.app"
              style="color:${GREEN};text-decoration:none;font-weight:500">rolito-app.web.app</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
// ── Helpers ────────────────────────────────────────────────────────────────────
function greeting(nombre) {
    return `<p style="margin:0 0 16px;font-size:16px">
    Hola <strong style="color:#111827">${esc(nombre)}</strong>,</p>`;
}
function formatDate(value) {
    try {
        const d = value && typeof value.toDate === 'function'
            ? value.toDate()
            : new Date(value);
        // toLocaleDateString sobre una fecha inválida no tira excepción — devuelve
        // el literal "Invalid Date" en inglés, que quedaba tal cual dentro de un
        // email en español (el catch de abajo nunca llegaba a activarse).
        if (isNaN(d.getTime()))
            return '—';
        return d.toLocaleDateString('es-AR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
    }
    catch {
        return '—';
    }
}
function productsTable(products) {
    const rows = products.map((p, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'}">
      <td style="padding:11px 14px;font-size:14px;color:#111827;
        border-bottom:1px solid #f3f4f6">${esc(p.name)}</td>
      <td style="padding:11px 14px;text-align:right;border-bottom:1px solid #f3f4f6;
        white-space:nowrap">
        <span style="background:${GREEN_BG};color:${GREEN_DARK};font-size:13px;
          font-weight:700;padding:3px 10px;border-radius:100px">&times;${p.quantity}</span>
      </td>
    </tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;
    border-radius:10px;overflow:hidden">
    <tr style="background:#f2f8f5">
      <th style="padding:9px 14px;text-align:left;font-size:11px;color:#6b7280;
        font-weight:700;text-transform:uppercase;letter-spacing:.06em;
        border-bottom:1px solid #e5e7eb">Producto</th>
      <th style="padding:9px 14px;text-align:right;font-size:11px;color:#6b7280;
        font-weight:700;text-transform:uppercase;letter-spacing:.06em;
        border-bottom:1px solid #e5e7eb">Cant.</th>
    </tr>
    ${rows}
  </table>`;
}
function dateBox(date) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="margin:4px 0 20px">
    <tr>
      <td style="background:${GREEN_BG};border-left:3px solid ${GREEN};
        border-radius:0 8px 8px 0;padding:12px 16px">
        <p style="margin:0;font-size:11px;color:${GREEN_DARK};font-weight:700;
          text-transform:uppercase;letter-spacing:.05em">Fecha de entrega</p>
        <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#111827">
          ${formatDate(date)}</p>
      </td>
    </tr>
  </table>`;
}
function ctaButton(text, url) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
    style="margin:28px auto 0">
    <tr>
      <td style="border-radius:8px;background:${GREEN}">
        <a href="${url}" style="display:inline-block;padding:13px 32px;
          color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;
          border-radius:8px;letter-spacing:0.01em">${text}</a>
      </td>
    </tr>
  </table>`;
}
function infoBox(lines) {
    const rows = lines.map((l, i) => `
    <tr style="${i > 0 ? 'border-top:1px solid #e8ede9' : ''}">
      <td style="padding:9px 14px;font-size:12px;color:#6b7280;font-weight:600;
        text-transform:uppercase;letter-spacing:.04em;width:110px;
        vertical-align:top">${l.label}</td>
      <td style="padding:9px 14px;font-size:14px;color:#111827;
        vertical-align:top">${l.value}</td>
    </tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:0 0 20px">
    ${rows}
  </table>`;
}
// ── Templates ──────────────────────────────────────────────────────────────────
function tplRegistroPendiente(nombre) {
    return layout('Tu cuenta está siendo verificada', {
        emoji: '🔔',
        title: 'Cuenta en verificación',
        subtitle: 'Te avisaremos cuando esté lista',
        accentColor: '#F59E0B',
    }, `
    ${greeting(nombre)}
    <p style="margin:0 0 14px">Recibimos tu solicitud de registro en <strong>Rolito</strong>.</p>
    <p style="margin:0 0 14px">Estamos verificando tus datos y en breve te notificaremos cuando puedas comenzar a hacer pedidos.</p>
    <p style="margin:0;font-size:13px;color:#6b7280">¿Tenés alguna consulta? Podés responder este email.</p>
  `);
}
function tplCuentaAprobada(nombre, appUrl) {
    return layout('¡Tu cuenta fue aprobada!', {
        emoji: '🎉',
        title: '¡Cuenta aprobada!',
        subtitle: 'Ya podés hacer tus pedidos',
    }, `
    ${greeting(nombre)}
    <p style="margin:0 0 14px">¡Buenas noticias! Tu cuenta en <strong>Rolito</strong> fue aprobada.</p>
    <p style="margin:0 0 28px">Ya podés ingresar a la plataforma y empezar a hacer tus pedidos de hielo de forma rápida y sencilla.</p>
    ${ctaButton('Ingresar a la app →', appUrl)}
  `);
}
function tplPedidoRecibido(nombre, products, date, notes) {
    const notasHtml = notes
        ? `<p style="margin:16px 0 0;padding:12px 16px;background:#fafafa;
        border:1px solid #e5e7eb;border-radius:8px;font-size:13px;
        color:#6b7280;font-style:italic">&ldquo;${esc(notes)}&rdquo;</p>`
        : '';
    return layout('Pedido recibido', {
        emoji: '📦',
        title: 'Pedido recibido',
        subtitle: 'Lo confirmaremos en breve',
        accentColor: '#3B82F6',
    }, `
    ${greeting(nombre)}
    <p style="margin:0 0 4px">Recibimos tu pedido correctamente.</p>
    <p style="margin:0 0 4px;color:#6b7280;font-size:13px">
      En breve lo revisamos y te confirmamos.</p>
    ${productsTable(products)}
    ${dateBox(date)}
    ${notasHtml}
  `);
}
function tplPedidoConfirmado(nombre, products, date) {
    return layout('Tu pedido fue confirmado', {
        emoji: '✅',
        title: 'Pedido confirmado',
        subtitle: 'Estamos preparando tu entrega',
    }, `
    ${greeting(nombre)}
    <p style="margin:0 0 4px">Tu pedido fue <strong>confirmado</strong> y ya estamos preparándolo para la entrega.</p>
    ${productsTable(products)}
    ${dateBox(date)}
  `);
}
function tplPedidoEnCamino(nombre, products, appUrl) {
    return layout('Tu pedido está en camino', {
        emoji: '🚛',
        title: 'En camino',
        subtitle: 'El chofer ya está en ruta hacia vos',
        accentColor: '#F59E0B',
    }, `
    ${greeting(nombre)}
    <p style="margin:0 0 4px">Tu pedido está <strong>en camino</strong>. El chofer ya salió hacia tu dirección.</p>
    ${productsTable(products)}
    ${ctaButton('Seguir mi entrega →', appUrl)}
  `);
}
function tplPedidoCerca(nombre, products, appUrl) {
    return layout('Tu pedido está cerca', {
        emoji: '🚚',
        title: '¡Ya llega!',
        subtitle: 'El chofer está a menos de 1 km',
        accentColor: '#00C2FF',
    }, `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">Tu pedido está <strong>a menos de 1 km</strong> — el chofer llega en breve.</p>
    ${productsTable(products)}
    ${ctaButton('Ver en la app →', appUrl)}
  `);
}
function tplPedidoReprogramado(nombre, products, date, motivo) {
    return layout('Tu pedido fue reprogramado', {
        emoji: '📅',
        title: 'Pedido reprogramado',
        subtitle: 'Nueva fecha de entrega',
        accentColor: '#F59E0B',
    }, `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">Te informamos que tu pedido fue <strong>reprogramado</strong> para una nueva fecha.</p>
    ${productsTable(products)}
    ${dateBox(date)}
    <p style="margin:16px 0 0;padding:12px 16px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#6b7280">
      <span style="font-weight:600;color:#374151">Motivo: </span>${esc(motivo)}
    </p>
  `);
}
function tplAdminNuevoPedido(order) {
    const notasHtml = order.notes
        ? `<p style="margin:20px 0 0;padding:12px 16px;background:#fafafa;
        border:1px solid #e5e7eb;border-radius:8px;font-size:13px;
        color:#6b7280;font-style:italic">
        <span style="font-weight:600;font-style:normal;color:#374151">Nota: </span>
        &ldquo;${esc(order.notes)}&rdquo;</p>`
        : '';
    return layout(`Nuevo pedido de ${esc(order.clientName)}`, {
        emoji: '🆕',
        title: 'Nuevo pedido recibido',
        subtitle: `De: ${esc(order.clientName)}`,
        accentColor: '#8B5CF6',
    }, `
    ${infoBox([
        { label: 'Cliente', value: `<strong>${esc(order.clientName)}</strong>` },
        { label: 'Teléfono', value: esc(order.clientPhone || '—') },
        { label: 'Dirección', value: esc(order.clientAddress) },
        { label: 'Entrega', value: `<strong>${formatDate(order.date)}</strong>` },
    ])}
    ${productsTable(order.products)}
    ${notasHtml}
  `);
}
function tplTicketCerrado(nombre, heladeraCodigo, motivoNombre, trabajoRealizado, appUrl) {
    return layout('Tu service fue completado', {
        emoji: '🔧',
        title: 'Service completado',
        subtitle: `Heladera ${esc(heladeraCodigo)}`,
    }, `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">El service que pediste para tu heladera <strong>${esc(heladeraCodigo)}</strong> (${esc(motivoNombre)}) ya fue completado.</p>
    ${trabajoRealizado ? `<p style="margin:0 0 20px;padding:12px 16px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#6b7280">
      <span style="font-weight:600;color:#374151">Trabajo realizado: </span>${esc(trabajoRealizado)}</p>` : ''}
    ${ctaButton('Ver mis heladeras →', `${appUrl}/mis-heladeras`)}
  `);
}
function tplStockBajo(articulo, appUrl) {
    return layout('Stock bajo en pañol', {
        emoji: '📉',
        title: 'Stock bajo en pañol',
        subtitle: esc(articulo.nombre),
        accentColor: '#F59E0B',
    }, `
    <p style="margin:0 0 16px">El artículo <strong>${esc(articulo.nombre)}</strong> del pañol está por debajo del stock mínimo configurado.</p>
    ${infoBox([
        { label: 'Stock actual', value: `<strong>${articulo.stockActual}</strong>` },
        { label: 'Stock mínimo', value: String(articulo.stockMinimo) },
    ])}
    ${ctaButton('Ver pañol →', `${appUrl}/heladeras/panol`)}
  `);
}
function tplAdminNuevoCliente(cliente) {
    return layout(`Nuevo cliente: ${esc(cliente.razonSocial)}`, {
        emoji: '🏢',
        title: 'Nuevo cliente creado',
        subtitle: `Por: ${esc(cliente.creadoPorNombre)}`,
        accentColor: '#8B5CF6',
    }, `
    ${infoBox([
        { label: 'Razón social', value: `<strong>${esc(cliente.razonSocial)}</strong>` },
        { label: 'CUIT', value: esc(cliente.cuit) },
        { label: 'Dirección', value: esc(cliente.address || '—') },
        { label: 'Creado por', value: `${esc(cliente.creadoPorNombre)} (${esc(cliente.creadoPorRol)})` },
    ])}
  `);
}
// ── Auditoría del Backoffice (Fase 4 del plan de migración) ───────────────────
const ACCION_ADMIN_LABELS = {
    creado: 'creó',
    modificado: 'modificó',
    activado: 'activó',
    desactivado: 'desactivó',
    rol_cambiado: 'cambió el rol de',
    usuario_creado: 'creó el usuario',
    usuario_desactivado: 'desactivó al usuario',
};
const COLECCION_LABELS = {
    users: 'Usuarios',
    flota: 'Flota',
    modelosHeladera: 'Modelos de heladera',
    panolArticulos: 'Pañol de repuestos',
    motivosReparacion: 'Motivos de reparación',
    tiposReparacion: 'Tipos de reparación',
    motivosIngreso: 'Motivos de ingreso',
    pasosTaller: 'Pasos de taller',
};
function accionLabel(accion) {
    return ACCION_ADMIN_LABELS[accion] ?? accion;
}
function coleccionLabel(coleccion) {
    return COLECCION_LABELS[coleccion] ?? coleccion;
}
function tplAdminAccionAltoRiesgo(evento, appUrl) {
    return layout('Acción administrativa', {
        emoji: '🔐',
        title: 'Cambio de alto riesgo en el Backoffice',
        subtitle: esc(coleccionLabel(evento.coleccion)),
        accentColor: '#DC2626',
    }, `
    <p style="margin:0 0 16px">
      <strong>${esc(evento.actorNombre)}</strong> (${esc(evento.actorRol)}) ${esc(accionLabel(evento.accion))}
      ${evento.detalle ? `<strong>${esc(evento.detalle)}</strong>` : ''} en ${esc(coleccionLabel(evento.coleccion))}.
    </p>
    ${ctaButton('Ver Usuarios & Roles →', `${appUrl}/admin/usuarios`)}
  `);
}
function tplAdminResumenDiario(eventos, appUrl) {
    const filas = eventos.map((e) => `
    <tr style="border-top:1px solid #e8ede9">
      <td style="padding:9px 14px;font-size:13px;color:#111827;vertical-align:top">
        <strong>${esc(e.actorNombre)}</strong> ${esc(accionLabel(e.accion))}
        ${e.detalle ? esc(e.detalle) : ''}
        <span style="color:#9ca3af"> — ${esc(coleccionLabel(e.coleccion))}</span>
      </td>
    </tr>`).join('');
    return layout('Resumen diario del Backoffice', {
        emoji: '🗒️',
        title: 'Resumen diario del Backoffice',
        subtitle: `${eventos.length} cambio${eventos.length !== 1 ? 's' : ''} de catálogo/config`,
        accentColor: GREEN,
    }, `
    <p style="margin:0 0 16px">Esto es lo que cambió ayer en Flota, Modelos, Catálogos de service, Técnicos y Pañol.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:0 0 20px">
      ${filas}
    </table>
    ${ctaButton('Ir al Backoffice →', `${appUrl}/admin`)}
  `);
}
//# sourceMappingURL=templates.js.map