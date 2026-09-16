import type { Cobranza, EmpresaTango, UserProfile, VentaCamion } from '@/types'
import { mailDeVenta } from './mailDeVenta'
import { formatoARS } from './money'

// Enviar un comprobante desde el visor (2026-09-15, pedido de Ariel): WhatsApp
// al celular de la ficha de Tango y mail al mail de la ficha de Tango, los dos
// precargados y editables antes de mandar. Acá vive lo puro: qué datos lleva
// cada envío, cómo se arma el texto del chat y cómo se nombra el archivo que
// se publica para el link. El contacto se resuelve en la hoja de envío
// (`components/ui/EnviarComprobanteSheet.tsx`) leyendo la ficha del cliente.

export interface EnvioComprobante {
  /** Mail precargado. Vacío: se busca en la ficha de Tango del cliente (`clienteUid`) o con `resolverPara`. */
  para?:         string
  resolverPara?: () => Promise<string>
  /** Celular precargado. Vacío: se lee de la ficha del cliente (`users.telefono`, que carga la sync de Tango). */
  telefono?:     string
  asunto:        string
  mensaje?:      string
  comprobante:   { tipo: string; numero: string; empresa?: EmpresaTango }
  clienteUid?:   string
  clienteNombre: string
  /** Tarjeta del mail: título legible y filas ya formateadas (fecha, importe, remitos…). */
  presentacion?: { titulo: string; emoji?: string; filas: { label: string; value: string }[] }
  /** Venta de la app a la que pertenece el comprobante: el server anota el envío en el doc. */
  venta?:        { coleccion: 'ventasCamion' | 'ventasVentanilla'; id: string }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Un papel sin cliente (liquidación, acta, listado): se manda igual, con lo que diga quien lo manda. */
export function envioGenerico(c: { titulo: string; subtitulo?: string; nombre: string }): EnvioComprobante {
  return {
    para: '',
    asunto: c.subtitulo ? `${c.titulo} — ${c.subtitulo}` : c.titulo,
    mensaje: `Te enviamos adjunto: ${c.titulo}.`,
    comprobante: { tipo: 'PDF', numero: c.nombre.replace(/\.pdf$/i, '').slice(0, 80) },
    clienteNombre: c.subtitulo ?? c.titulo,
    presentacion: { titulo: c.titulo, filas: [] },
  }
}

/** Comprobante de una venta (factura, remito, factura X): mismo contenido que el mail automático. */
export function envioDeVenta(venta: VentaCamion, ref: { coleccion: 'ventasCamion' | 'ventasVentanilla'; id: string } = { coleccion: 'ventasCamion', id: venta.id }): EnvioComprobante {
  const m = mailDeVenta(venta)
  return {
    para: '', asunto: m.asunto, mensaje: m.mensaje, comprobante: m.comprobante,
    clienteUid: m.clienteUid, clienteNombre: m.clienteNombre, presentacion: m.presentacion, venta: ref,
  }
}

/** Recibo de cobranza (numerado del supervisor o simple de mostrador). */
export function envioDeRecibo(c: Pick<Cobranza, 'id' | 'clienteId' | 'clienteNombre' | 'importe' | 'numeroRecibo' | 'empresa' | 'fecha'>, titulo: string): EnvioComprobante {
  const fecha = c.fecha.toDate().toLocaleDateString('es-AR')
  return {
    para: '',
    asunto: `${titulo} — ${c.clienteNombre}`,
    mensaje: `Te enviamos adjunto el recibo de tu pago del ${fecha} por ${formatoARS(c.importe)}.`,
    comprobante: { tipo: 'REC', numero: c.numeroRecibo ?? c.id.slice(0, 8), ...(c.empresa ? { empresa: c.empresa } : {}) },
    clienteUid: c.clienteId || undefined,
    clienteNombre: c.clienteNombre,
    presentacion: { titulo, emoji: '🧾', filas: [{ label: 'Fecha', value: fecha }, { label: 'Importe', value: formatoARS(c.importe) }] },
  }
}

/** Papel de heladeras (comodato, retiro, pedido de service) para un cliente conocido. */
export function envioDeCliente(
  cliente: Pick<UserProfile, 'uid' | 'razonSocial' | 'email' | 'telefono' | 'phone'> | null | undefined,
  papel: { tipo: string; numero: string; titulo: string; mensaje: string; clienteNombre?: string },
): EnvioComprobante {
  const nombre = cliente?.razonSocial || papel.clienteNombre || ''
  return {
    para: '',
    telefono: contactoDePerfil(cliente).telefono,
    asunto: `${papel.titulo} — ${nombre}`,
    mensaje: papel.mensaje,
    comprobante: { tipo: papel.tipo, numero: papel.numero },
    clienteUid: cliente?.uid,
    clienteNombre: nombre,
    presentacion: { titulo: papel.titulo, filas: [] },
  }
}

/** Celular y mail tal como están en la ficha (los carga la sync de clientes de Tango). */
export function contactoDePerfil(p: Pick<UserProfile, 'telefono' | 'phone' | 'email'> | null | undefined): { telefono: string; mail: string } {
  const telefono = (p?.telefono || p?.phone || '').trim()
  const mail = (p?.email ?? '').trim().toLowerCase()
  return { telefono, mail: EMAIL_RE.test(mail) ? mail : '' }
}

/** Texto del chat de WhatsApp: saludo, el mensaje del comprobante y el link al PDF. */
export function textoWhatsApp(e: { titulo: string; mensaje?: string; link: string; clienteNombre?: string }): string {
  const saludo = e.clienteNombre ? `Hola ${e.clienteNombre},` : 'Hola,'
  const cuerpo = (e.mensaje ?? '').trim() || `te enviamos ${e.titulo}.`
  return `${saludo} ${cuerpo}\n\n📄 ${e.titulo}:\n${e.link}\n\nRolito`
}

/** Nombre único y seguro para publicar el archivo: fecha + nombre sin caracteres raros. */
export function nombrePublicado(nombreArchivo: string, ahora: Date = new Date()): string {
  const base = nombreArchivo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'comprobante.pdf'
  const conExt = /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.pdf`
  const sello = ahora.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${sello}-${conExt}`
}
