interface Product { name: string; quantity: number }

// Escapa datos controlados por el usuario (razón social, notas, nombres de
// producto, motivo, dirección, teléfono) antes de interpolarlos en el HTML del
// email. Sin esto, p. ej. una razón social con markup podría inyectar contenido
// (links, layout roto) en el correo que recibe el staff. Se aplica solo al dato
// crudo, nunca al markup que los templates arman a propósito.
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const LOGO_URL  = 'https://rolito-app.web.app/logo-rolito.png'
const GREEN      = '#1D9E75'
const GREEN_DARK = '#166a50'
const GREEN_BG   = '#e8f5ef'
const DARK       = '#081C11'

// ── Layout ─────────────────────────────────────────────────────────────────────

interface BannerOpts {
  emoji:       string
  title:       string
  subtitle?:   string
  accentColor?: string
}

function layout(pageTitle: string, banner: BannerOpts, body: string): string {
  const accent = banner.accentColor ?? GREEN
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
</html>`
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function greeting(nombre: string): string {
  return `<p style="margin:0 0 16px;font-size:16px">
    Hola <strong style="color:#111827">${esc(nombre)}</strong>,</p>`
}

function formatDate(value: unknown): string {
  try {
    const d = value && typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string)
    // toLocaleDateString sobre una fecha inválida no tira excepción — devuelve
    // el literal "Invalid Date" en inglés, que quedaba tal cual dentro de un
    // email en español (el catch de abajo nunca llegaba a activarse).
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function productsTable(products: Product[]): string {
  const rows = products.map((p, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'}">
      <td style="padding:11px 14px;font-size:14px;color:#111827;
        border-bottom:1px solid #f3f4f6">${esc(p.name)}</td>
      <td style="padding:11px 14px;text-align:right;border-bottom:1px solid #f3f4f6;
        white-space:nowrap">
        <span style="background:${GREEN_BG};color:${GREEN_DARK};font-size:13px;
          font-weight:700;padding:3px 10px;border-radius:100px">&times;${p.quantity}</span>
      </td>
    </tr>`).join('')

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
  </table>`
}

function dateBox(date: unknown): string {
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
  </table>`
}

function ctaButton(text: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
    style="margin:28px auto 0">
    <tr>
      <td style="border-radius:8px;background:${GREEN}">
        <a href="${url}" style="display:inline-block;padding:13px 32px;
          color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;
          border-radius:8px;letter-spacing:0.01em">${text}</a>
      </td>
    </tr>
  </table>`
}

function infoBox(lines: { label: string; value: string }[]): string {
  const rows = lines.map((l, i) => `
    <tr style="${i > 0 ? 'border-top:1px solid #e8ede9' : ''}">
      <td style="padding:9px 14px;font-size:12px;color:#6b7280;font-weight:600;
        text-transform:uppercase;letter-spacing:.04em;width:110px;
        vertical-align:top">${l.label}</td>
      <td style="padding:9px 14px;font-size:14px;color:#111827;
        vertical-align:top">${l.value}</td>
    </tr>`).join('')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:0 0 20px">
    ${rows}
  </table>`
}

// ── Templates ──────────────────────────────────────────────────────────────────

export function tplRegistroPendiente(nombre: string): string {
  return layout('Tu cuenta está siendo verificada', {
    emoji:       '🔔',
    title:       'Cuenta en verificación',
    subtitle:    'Te avisaremos cuando esté lista',
    accentColor: '#F59E0B',
  }, `
    ${greeting(nombre)}
    <p style="margin:0 0 14px">Recibimos tu solicitud de registro en <strong>Rolito</strong>.</p>
    <p style="margin:0 0 14px">Estamos verificando tus datos y en breve te notificaremos cuando puedas comenzar a hacer pedidos.</p>
    <p style="margin:0;font-size:13px;color:#6b7280">¿Tenés alguna consulta? Podés responder este email.</p>
  `)
}

export function tplCuentaAprobada(nombre: string, appUrl: string): string {
  return layout('¡Tu cuenta fue aprobada!', {
    emoji:   '🎉',
    title:   '¡Cuenta aprobada!',
    subtitle: 'Ya podés hacer tus pedidos',
  }, `
    ${greeting(nombre)}
    <p style="margin:0 0 14px">¡Buenas noticias! Tu cuenta en <strong>Rolito</strong> fue aprobada.</p>
    <p style="margin:0 0 28px">Ya podés ingresar a la plataforma y empezar a hacer tus pedidos de hielo de forma rápida y sencilla.</p>
    ${ctaButton('Ingresar a la app →', appUrl)}
  `)
}

export function tplPedidoRecibido(
  nombre: string, products: Product[], date: unknown, notes?: string,
): string {
  const notasHtml = notes
    ? `<p style="margin:16px 0 0;padding:12px 16px;background:#fafafa;
        border:1px solid #e5e7eb;border-radius:8px;font-size:13px;
        color:#6b7280;font-style:italic">&ldquo;${esc(notes)}&rdquo;</p>`
    : ''
  return layout('Pedido recibido', {
    emoji:       '📦',
    title:       'Pedido recibido',
    subtitle:    'Lo confirmaremos en breve',
    accentColor: '#3B82F6',
  }, `
    ${greeting(nombre)}
    <p style="margin:0 0 4px">Recibimos tu pedido correctamente.</p>
    <p style="margin:0 0 4px;color:#6b7280;font-size:13px">
      En breve lo revisamos y te confirmamos.</p>
    ${productsTable(products)}
    ${dateBox(date)}
    ${notasHtml}
  `)
}

export function tplPedidoConfirmado(
  nombre: string, products: Product[], date: unknown,
): string {
  return layout('Tu pedido fue confirmado', {
    emoji:   '✅',
    title:   'Pedido confirmado',
    subtitle: 'Estamos preparando tu entrega',
  }, `
    ${greeting(nombre)}
    <p style="margin:0 0 4px">Tu pedido fue <strong>confirmado</strong> y ya estamos preparándolo para la entrega.</p>
    ${productsTable(products)}
    ${dateBox(date)}
  `)
}

export function tplPedidoEnCamino(
  nombre: string, products: Product[], appUrl: string,
): string {
  return layout('Tu pedido está en camino', {
    emoji:       '🚛',
    title:       'En camino',
    subtitle:    'El chofer ya está en ruta hacia vos',
    accentColor: '#F59E0B',
  }, `
    ${greeting(nombre)}
    <p style="margin:0 0 4px">Tu pedido está <strong>en camino</strong>. El chofer ya salió hacia tu dirección.</p>
    ${productsTable(products)}
    ${ctaButton('Seguir mi entrega →', appUrl)}
  `)
}

export function tplPedidoCerca(nombre: string, products: Product[], appUrl: string): string {
  return layout('Tu pedido está cerca', {
    emoji:       '🚚',
    title:       '¡Ya llega!',
    subtitle:    'El chofer está a menos de 1 km',
    accentColor: '#00C2FF',
  }, `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">Tu pedido está <strong>a menos de 1 km</strong> — el chofer llega en breve.</p>
    ${productsTable(products)}
    ${ctaButton('Ver en la app →', appUrl)}
  `)
}

export function tplPedidoReprogramado(
  nombre: string, products: Product[], date: unknown, motivo: string,
): string {
  return layout('Tu pedido fue reprogramado', {
    emoji:       '📅',
    title:       'Pedido reprogramado',
    subtitle:    'Nueva fecha de entrega',
    accentColor: '#F59E0B',
  }, `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">Te informamos que tu pedido fue <strong>reprogramado</strong> para una nueva fecha.</p>
    ${productsTable(products)}
    ${dateBox(date)}
    <p style="margin:16px 0 0;padding:12px 16px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#6b7280">
      <span style="font-weight:600;color:#374151">Motivo: </span>${esc(motivo)}
    </p>
  `)
}

export function tplAdminNuevoPedido(order: {
  clientName:    string
  clientAddress: string
  clientPhone:   string
  products:      Product[]
  date:          unknown
  notes?:        string
}): string {
  const notasHtml = order.notes
    ? `<p style="margin:20px 0 0;padding:12px 16px;background:#fafafa;
        border:1px solid #e5e7eb;border-radius:8px;font-size:13px;
        color:#6b7280;font-style:italic">
        <span style="font-weight:600;font-style:normal;color:#374151">Nota: </span>
        &ldquo;${esc(order.notes)}&rdquo;</p>`
    : ''
  return layout(`Nuevo pedido de ${esc(order.clientName)}`, {
    emoji:       '🆕',
    title:       'Nuevo pedido recibido',
    subtitle:    `De: ${esc(order.clientName)}`,
    accentColor: '#8B5CF6',
  }, `
    ${infoBox([
      { label: 'Cliente',   value: `<strong>${esc(order.clientName)}</strong>` },
      { label: 'Teléfono',  value: esc(order.clientPhone || '—') },
      { label: 'Dirección', value: esc(order.clientAddress) },
      { label: 'Entrega',   value: `<strong>${formatDate(order.date)}</strong>` },
    ])}
    ${productsTable(order.products)}
    ${notasHtml}
  `)
}

export function tplTicketCerrado(
  nombre: string, heladeraCodigo: string, motivoNombre: string, trabajoRealizado: string | undefined, appUrl: string,
): string {
  return layout('Tu service fue completado', {
    emoji:   '🔧',
    title:   'Service completado',
    subtitle: `Heladera ${esc(heladeraCodigo)}`,
  }, `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">El service que pediste para tu heladera <strong>${esc(heladeraCodigo)}</strong> (${esc(motivoNombre)}) ya fue completado.</p>
    ${trabajoRealizado ? `<p style="margin:0 0 20px;padding:12px 16px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#6b7280">
      <span style="font-weight:600;color:#374151">Trabajo realizado: </span>${esc(trabajoRealizado)}</p>` : ''}
    ${ctaButton('Ver mis heladeras →', `${appUrl}/mis-heladeras`)}
  `)
}

export function tplStockBajo(articulo: { nombre: string; stockActual: number; stockMinimo: number }, appUrl: string): string {
  return layout('Stock bajo en pañol', {
    emoji:       '📉',
    title:       'Stock bajo en pañol',
    subtitle:    esc(articulo.nombre),
    accentColor: '#F59E0B',
  }, `
    <p style="margin:0 0 16px">El artículo <strong>${esc(articulo.nombre)}</strong> del pañol está por debajo del stock mínimo configurado.</p>
    ${infoBox([
      { label: 'Stock actual',  value: `<strong>${articulo.stockActual}</strong>` },
      { label: 'Stock mínimo',  value: String(articulo.stockMinimo) },
    ])}
    ${ctaButton('Ver pañol →', `${appUrl}/heladeras/panol`)}
  `)
}

export function tplComodatosPorVencer(
  items: { heladeraCodigo: string; clientName: string; direccion?: string | null; diasVencido: number }[],
  appUrl: string,
): string {
  return layout('Comodatos para renovar', {
    emoji:       '📋',
    title:       'Comodatos para renovar',
    subtitle:    `${items.length} equipo${items.length !== 1 ? 's' : ''}`,
    accentColor: '#F59E0B',
  }, `
    <p style="margin:0 0 16px">Estos equipos tienen el comodato vencido o por vencer — coordiná una visita para volver a firmarlo.</p>
    ${infoBox(items.map((i) => ({
      label: esc(i.heladeraCodigo),
      value: `${esc(i.clientName)}${i.direccion ? ` — ${esc(i.direccion)}` : ''}<br>` +
        `<span style="color:#9ca3af;font-size:12px">${i.diasVencido > 0 ? `Vencido hace ${i.diasVencido} día${i.diasVencido !== 1 ? 's' : ''}` : 'Vence hoy'}</span>`,
    })))}
    ${ctaButton('Ver equipos →', `${appUrl}/heladeras/equipos`)}
  `)
}

export function tplAdminNuevoCliente(cliente: {
  razonSocial:     string
  cuit:            string
  address:         string
  creadoPorNombre: string
  creadoPorRol:    string
}): string {
  return layout(`Nuevo cliente: ${esc(cliente.razonSocial)}`, {
    emoji:       '🏢',
    title:       'Nuevo cliente creado',
    subtitle:    `Por: ${esc(cliente.creadoPorNombre)}`,
    accentColor: '#8B5CF6',
  }, `
    ${infoBox([
      { label: 'Razón social', value: `<strong>${esc(cliente.razonSocial)}</strong>` },
      { label: 'CUIT',         value: esc(cliente.cuit) },
      { label: 'Dirección',    value: esc(cliente.address || '—') },
      { label: 'Creado por',   value: `${esc(cliente.creadoPorNombre)} (${esc(cliente.creadoPorRol)})` },
    ])}
  `)
}

// ── Auditoría del Backoffice (Fase 4 del plan de migración) ───────────────────

const ACCION_ADMIN_LABELS: Record<string, string> = {
  creado:               'creó',
  modificado:           'modificó',
  activado:             'activó',
  desactivado:          'desactivó',
  rol_cambiado:         'cambió el rol de',
  usuario_creado:       'creó el usuario',
  usuario_desactivado:  'desactivó al usuario',
}

const COLECCION_LABELS: Record<string, string> = {
  users:            'Usuarios',
  flota:            'Flota',
  modelosHeladera:  'Modelos de heladera',
  panolArticulos:   'Pañol de repuestos',
  motivosReparacion: 'Motivos de reparación',
  tiposReparacion:  'Tipos de reparación',
  motivosIngreso:   'Motivos de ingreso',
  pasosTaller:      'Pasos de taller',
}

function accionLabel(accion: string): string {
  return ACCION_ADMIN_LABELS[accion] ?? accion
}

function coleccionLabel(coleccion: string): string {
  return COLECCION_LABELS[coleccion] ?? coleccion
}

export function tplAdminAccionAltoRiesgo(evento: {
  actorNombre: string
  actorRol:    string
  coleccion:   string
  accion:      string
  detalle?:    string | null
}, appUrl: string): string {
  return layout('Acción administrativa', {
    emoji:       '🔐',
    title:       'Cambio de alto riesgo en el Backoffice',
    subtitle:    esc(coleccionLabel(evento.coleccion)),
    accentColor: '#DC2626',
  }, `
    <p style="margin:0 0 16px">
      <strong>${esc(evento.actorNombre)}</strong> (${esc(evento.actorRol)}) ${esc(accionLabel(evento.accion))}
      ${evento.detalle ? `<strong>${esc(evento.detalle)}</strong>` : ''} en ${esc(coleccionLabel(evento.coleccion))}.
    </p>
    ${ctaButton('Ver Usuarios & Roles →', `${appUrl}/admin/usuarios`)}
  `)
}

export function tplAdminResumenDiario(eventos: {
  actorNombre: string
  coleccion:   string
  accion:      string
  detalle?:    string | null
}[], appUrl: string): string {
  const filas = eventos.map((e) => `
    <tr style="border-top:1px solid #e8ede9">
      <td style="padding:9px 14px;font-size:13px;color:#111827;vertical-align:top">
        <strong>${esc(e.actorNombre)}</strong> ${esc(accionLabel(e.accion))}
        ${e.detalle ? esc(e.detalle) : ''}
        <span style="color:#9ca3af"> — ${esc(coleccionLabel(e.coleccion))}</span>
      </td>
    </tr>`).join('')

  return layout('Resumen diario del Backoffice', {
    emoji:       '🗒️',
    title:       'Resumen diario del Backoffice',
    subtitle:    `${eventos.length} cambio${eventos.length !== 1 ? 's' : ''} de catálogo/config`,
    accentColor: GREEN,
  }, `
    <p style="margin:0 0 16px">Esto es lo que cambió ayer en Flota, Modelos, Catálogos de service, Técnicos y Pañol.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:0 0 20px">
      ${filas}
    </table>
    ${ctaButton('Ir al Backoffice →', `${appUrl}/admin`)}
  `)
}

// ── ARCA: facturas con problemas ───────────────────────────────────────────────

export interface FacturaConProblema {
  ventaId:       string
  estado:        'rechazada' | 'vencida' | 'pendiente'
  motivo:        string
  clienteNombre: string
  total:         number
  fechaVenta:    unknown
}

const ESTADO_FACTURA_LABEL: Record<FacturaConProblema['estado'], string> = {
  rechazada: 'ARCA la rechazó',
  vencida:   'Venció la ventana de 5 días: ya no se puede facturar con su fecha',
  pendiente: 'Sigue sin facturar desde hace más de 3 horas',
}

// Mail a la oficina cuando la reconciliación encuentra facturas que no van a
// salir solas: rechazadas por ARCA, vencidas (pasó la ventana de 5 días) o
// pendientes trabadas por una causa que no se arregla reintentando (cliente
// sin CUIT, sin condición de IVA). Sin este mail la única persona que se
// enteraba era el chofer, en su pantalla de ventas.
export function tplArcaFacturasConProblemas(facturas: FacturaConProblema[], appUrl: string): string {
  const filas = facturas.map((f) => `
    <tr style="border-top:1px solid #e8ede9">
      <td style="padding:9px 14px;font-size:13px;color:#111827;vertical-align:top">
        <strong>${esc(f.clienteNombre || 'Cliente sin nombre')}</strong>
        <span style="color:#6b7280"> — $${esc(f.total.toLocaleString('es-AR', { minimumFractionDigits: 2 }))} · venta del ${esc(formatDate(f.fechaVenta))}</span><br>
        <span style="color:#DC2626;font-weight:600">${esc(ESTADO_FACTURA_LABEL[f.estado])}</span><br>
        <span style="color:#6b7280">${esc(f.motivo)}</span><br>
        <span style="color:#9ca3af;font-family:monospace;font-size:11px">venta ${esc(f.ventaId)}</span>
      </td>
    </tr>`).join('')

  return layout('Facturas ARCA con problemas', {
    emoji:       '⚠️',
    title:       'Facturas electrónicas que necesitan una mano',
    subtitle:    `${facturas.length} venta${facturas.length !== 1 ? 's' : ''} de contado sin factura válida`,
    accentColor: '#DC2626',
  }, `
    <p style="margin:0 0 16px">
      Estas ventas de contado del camión no tienen factura electrónica y no se van a resolver solas.
      Las rechazadas y las trabadas suelen ser un dato del cliente (CUIT, condición de IVA): corregilo
      en su ficha y la reconciliación las reintenta sola cada hora, mientras no pasen los 5 días.
      Las vencidas hay que resolverlas desde Tango.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:0 0 20px">
      ${filas}
    </table>
    ${ctaButton('Ir a Usuarios & Roles →', `${appUrl}/admin/usuarios`)}
  `)
}
