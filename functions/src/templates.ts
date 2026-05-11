interface Product {
  name: string
  quantity: number
}

// ── Base layout ───────────────────────────────────────────────────────────────

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
        style="max-width:540px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

        <!-- Header -->
        <tr>
          <td style="background:#0a1628;padding:24px 32px;text-align:center">
            <p style="margin:0;color:#00C2FF;font-size:22px;font-weight:700;letter-spacing:-0.5px">Rolito</p>
            <p style="margin:4px 0 0;color:#6b7280;font-size:12px">Distribución de hielo</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;color:#111827;font-size:15px;line-height:1.6">
            ${body}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb">
            <p style="margin:0;color:#9ca3af;font-size:12px">© ${new Date().getFullYear()} Rolito · Distribución de Hielo</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function greeting(nombre: string): string {
  return `<p style="margin:0 0 16px">Hola <strong>${nombre}</strong>,</p>`
}

function formatDate(value: FirebaseFirestore.Timestamp | string | null | undefined): string {
  try {
    const d = value && typeof (value as any).toDate === 'function'
      ? (value as any).toDate()
      : new Date(value as string)
    return d.toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch {
    return String(value ?? '—')
  }
}

function productsTable(products: Product[]): string {
  const rows = products.map((p) =>
    `<tr style="border-top:1px solid #e5e7eb">
      <td style="padding:8px 0;font-size:14px;color:#111827">${p.name}</td>
      <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:600;color:#111827">x${p.quantity}</td>
    </tr>`,
  ).join('')

  return `<table width="100%" cellpadding="0" cellspacing="0"
    style="border-collapse:collapse;margin:16px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
    <tr style="background:#f9fafb">
      <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Producto</th>
      <th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Cantidad</th>
    </tr>
    ${rows}
  </table>`
}

function ctaButton(text: string, url: string): string {
  return `<p style="text-align:center;margin:24px 0 0">
    <a href="${url}" style="display:inline-block;background:#00C2FF;color:#0a1628;font-weight:700;
      font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none">${text}</a>
  </p>`
}

// ── Templates ─────────────────────────────────────────────────────────────────

// 1. Cliente — registro pendiente
export function tplRegistroPendiente(nombre: string): string {
  return layout('Tu cuenta está siendo verificada', `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">Recibimos tu solicitud de registro en <strong>Rolito</strong>.</p>
    <p style="margin:0 0 16px">En breve verificaremos tus datos y te avisaremos cuando puedas comenzar a hacer pedidos.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">Si tenés alguna consulta, respondé este email.</p>
  `)
}

// 2. Cliente — cuenta aprobada
export function tplCuentaAprobada(nombre: string, appUrl: string): string {
  return layout('¡Tu cuenta fue aprobada!', `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">¡Buenas noticias! Tu cuenta en <strong>Rolito</strong> fue aprobada.</p>
    <p style="margin:0 0 24px">Ya podés ingresar y hacer tus pedidos.</p>
    ${ctaButton('Ir a la app →', appUrl)}
  `)
}

// 3. Cliente — pedido recibido
export function tplPedidoRecibido(
  nombre: string,
  products: Product[],
  date: FirebaseFirestore.Timestamp | string | null | undefined,
  notes?: string,
): string {
  const notasHtml = notes
    ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280;font-style:italic">Nota: "${notes}"</p>`
    : ''
  return layout('Pedido recibido', `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">Recibimos tu pedido. En breve lo confirmaremos.</p>
    ${productsTable(products)}
    <p style="margin:0;font-size:14px">
      <span style="color:#6b7280">Fecha de entrega:</span>
      <strong>${formatDate(date)}</strong>
    </p>
    ${notasHtml}
  `)
}

// 4. Cliente — pedido en camino
export function tplPedidoEnCamino(
  nombre: string,
  products: Product[],
  appUrl: string,
): string {
  return layout('Tu pedido está en camino 🚛', `
    ${greeting(nombre)}
    <p style="margin:0 0 16px">Tu pedido está en camino. El chofer ya salió hacia tu dirección.</p>
    ${productsTable(products)}
    ${ctaButton('Seguir entrega en la app →', appUrl)}
  `)
}

// 5. Admin — nuevo pedido
export function tplAdminNuevoPedido(order: {
  clientName:    string
  clientAddress: string
  clientPhone:   string
  products:      Product[]
  date:          FirebaseFirestore.Timestamp | string | null | undefined
  notes?:        string
}): string {
  const notasHtml = order.notes
    ? `<tr style="border-top:1px solid #e5e7eb">
        <td style="padding:6px 0;color:#6b7280;font-size:13px">Notas</td>
        <td style="padding:6px 0;font-size:13px;font-style:italic">"${order.notes}"</td>
       </tr>`
    : ''

  return layout(`Nuevo pedido de ${order.clientName}`, `
    <p style="margin:0 0 20px;font-size:16px;font-weight:600">
      Nuevo pedido recibido
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px">
      <tr>
        <td style="padding:6px 0;color:#6b7280;font-size:13px;width:120px">Cliente</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600">${order.clientName}</td>
      </tr>
      <tr style="border-top:1px solid #e5e7eb">
        <td style="padding:6px 0;color:#6b7280;font-size:13px">Teléfono</td>
        <td style="padding:6px 0;font-size:13px">${order.clientPhone || '—'}</td>
      </tr>
      <tr style="border-top:1px solid #e5e7eb">
        <td style="padding:6px 0;color:#6b7280;font-size:13px">Dirección</td>
        <td style="padding:6px 0;font-size:13px">${order.clientAddress}</td>
      </tr>
      <tr style="border-top:1px solid #e5e7eb">
        <td style="padding:6px 0;color:#6b7280;font-size:13px">Entrega</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600">${formatDate(order.date)}</td>
      </tr>
      ${notasHtml}
    </table>

    ${productsTable(order.products)}
  `)
}
