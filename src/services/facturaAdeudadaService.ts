import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { getUserDocument } from './userService'
import { blobFacturaArchivada, getFacturaArchivada } from './facturasArchivadasService'
import { getFacturaTangoDetalle, getRemitoTangoDetalle } from './tangoComprobantesService'
import { caiRemitoOficialCacheado, getCaiRemitoOficial } from './remitoOficialConfigService'
import { generarComprobanteVenta } from '@/utils/comprobanteDeVenta'
import { armarFacturaDeVenta } from '@/utils/facturaDeVenta'
import { formatoFactura, parsearClaveTango } from '@/utils/facturaClave'
import { armarFacturaTangoPdf, armarRemitoTangoPdf, formatoRemito, parsearRemito } from '@/utils/comprobantesTango'
import { compartirArchivo, descargarArchivo } from '@/utils/compartir'
import type { ComprobanteSaldoTango, EmpresaTango, VentaCamion, VentaVentanilla } from '@/types'

// PDF de una factura adeudada (comprobante de la composición de saldos de
// Tango), para que el supervisor se lo comparta al cliente. Fuentes, en
// orden: (1) venta de la app facturada por ARCA (ventasCamion /
// ventasVentanilla, misma numeración que Tango: letra + PV + número); (2)
// factura X de promo, que en Tango entra con letra A/B y el número del
// comprobante interno; (3) detalle de la factura leído de Tango por el lector
// de la VM (tangoComprobanteDetalle, con CAE: se regenera con el formato
// histórico, 2026-09-09); (4) factura archivada por administración desde
// Recupero de facturas. Si no está en ninguna, se le pide a administración.
//
// Lo mismo para un remito (2026-09-09): si lo hizo la app sale su PDF (con la
// firma del cliente); si lo cargó la oficina en Tango, una copia con el
// diseño de la app y el CAI de su talonario.

export type FacturaObtenida =
  | { ok: true; blob: Blob; nombre: string; titulo: string; fuente: 'app' | 'tango' | 'archivo' }
  | { ok: false; motivo: string }

const SIN_ARCHIVO = 'Esta factura no está en la app: pedila a administración (Recupero de facturas → Guardar en la app).'
const SIN_REMITO = 'Este remito todavía no está en la app: el lector de Tango lo trae en la próxima corrida.'

// Si la consulta falla (sin permiso sobre la colección, sin red), se sigue con
// la fuente siguiente en vez de frenar toda la cascada.
async function ventaCamionPor(campo: 'factura' | 'comprobanteInterno', puntoVenta: number, numero: number): Promise<VentaCamion | null> {
  try {
    const snap = await getDocs(query(
      collection(db, 'ventasCamion'),
      where(`${campo}.puntoVenta`, '==', puntoVenta),
      where(`${campo}.numero`, '==', numero),
      limit(1),
    ))
    return snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as VentaCamion)
  } catch {
    return null
  }
}

async function ventaVentanillaPor(puntoVenta: number, numero: number): Promise<VentaVentanilla | null> {
  try {
    const snap = await getDocs(query(
      collection(db, 'ventasVentanilla'),
      where('factura.puntoVenta', '==', puntoVenta),
      where('factura.numero', '==', numero),
      limit(1),
    ))
    return snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as VentaVentanilla)
  } catch {
    return null
  }
}

const TITULO_TIPO: Record<string, string> = { FAC: 'Factura', NC: 'Nota de crédito', ND: 'Nota de débito' }

export async function obtenerFacturaPdf(comp: Pick<ComprobanteSaldoTango, 'tipo' | 'numero'>, empresa: EmpresaTango): Promise<FacturaObtenida> {
  const clave = parsearClaveTango(comp.numero)
  if (!clave) return { ok: false, motivo: `No se reconoce el número ${comp.numero}.` }
  const tipo = comp.tipo.replace('/', '').toUpperCase()
  const titulo = `${TITULO_TIPO[tipo] ?? comp.tipo} ${formatoFactura(clave)}`

  // (1) Contado facturado por ARCA desde la app (Redonhielo): camión o mostrador.
  if (empresa === 'redonhielo' && clave.letra !== 'X' && tipo === 'FAC') {
    const venta = await ventaCamionPor('factura', clave.puntoVenta, clave.numero)
    if (venta?.factura?.estado === 'emitida') {
      const cliente = venta.clienteId ? (await getUserDocument(venta.clienteId)) ?? undefined : undefined
      const g = await generarComprobanteVenta(venta, cliente, null)
      return g.ok ? { ...g, titulo, fuente: 'app' } : g
    }
    const mostrador = await ventaVentanillaPor(clave.puntoVenta, clave.numero)
    if (mostrador?.factura?.estado === 'emitida') {
      const cliente = mostrador.clienteId ? (await getUserDocument(mostrador.clienteId)) ?? undefined : undefined
      const armado = armarFacturaDeVenta(mostrador, cliente)
      if (!armado.ok) return armado
      const { generateFacturaArcaPdf } = await import('@/utils/facturaArcaPdf')
      const blob = (await generateFacturaArcaPdf({ ...armado.datos, descargar: false })) as Blob
      return { ok: true, blob, nombre: `factura-${comp.numero}.pdf`, titulo, fuente: 'app' }
    }
  }

  // (2) Promo (Rolito): la factura X de la app entra en Tango con letra A/B y el número interno.
  if (empresa === 'rolito' && tipo === 'FAC') {
    const venta = await ventaCamionPor('comprobanteInterno', clave.puntoVenta, clave.numero)
    if (venta?.comprobanteInterno) {
      const cliente = venta.clienteId ? (await getUserDocument(venta.clienteId)) ?? undefined : undefined
      const g = await generarComprobanteVenta(venta, cliente, null)
      return g.ok ? { ...g, titulo, fuente: 'app' } : g
    }
  }

  // (3) Detalle leído de Tango (con CAE): se regenera con el formato histórico.
  const detalle = await getFacturaTangoDetalle(empresa, tipo, comp.numero).catch(() => null)
  if (detalle) {
    const armado = armarFacturaTangoPdf(detalle)
    if (armado.ok) {
      const { generateFacturaPdf } = await import('@/utils/facturaPdf')
      const blob = (await generateFacturaPdf(armado.datos)) as Blob
      return { ok: true, blob, nombre: `factura-${comp.numero}.pdf`, titulo, fuente: 'tango' }
    }
  }

  // (4) Archivada por administración.
  const archivada = await getFacturaArchivada(empresa, comp.numero.trim().toUpperCase())
  if (archivada) {
    const blob = await blobFacturaArchivada(archivada)
    return { ok: true, blob, nombre: `factura-${archivada.clave}.pdf`, titulo, fuente: 'archivo' }
  }
  return { ok: false, motivo: SIN_ARCHIVO }
}

/** Ver (descargar) o enviar (compartir). Devuelve un aviso para pantalla, o '' si salió bien. */
export async function entregarFacturaAdeudada(comp: Pick<ComprobanteSaldoTango, 'tipo' | 'numero'>, empresa: EmpresaTango, modo: 'ver' | 'enviar', clienteNombre: string): Promise<string> {
  let r: FacturaObtenida
  try {
    r = await obtenerFacturaPdf(comp, empresa)
  } catch {
    return 'No se pudo obtener la factura. Revisá la señal y probá de nuevo.'
  }
  return entregar(r, modo, clienteNombre)
}

/** PDF de un remito por su número de Tango ('R0110500000322'): el de la app si lo hizo la app, si no una copia desde Tango. */
export async function obtenerRemitoPdf(numeroRemito: string, empresa: EmpresaTango): Promise<FacturaObtenida> {
  const p = parsearRemito(numeroRemito)
  const titulo = `Remito ${formatoRemito(numeroRemito)}`
  if (p) {
    const venta = await ventaCamionPor('comprobanteInterno', p.puntoVenta, p.numero).catch(() => null)
    if (venta?.comprobanteInterno && venta.comprobanteInterno.tipo !== 'facturaX') {
      const cliente = venta.clienteId ? (await getUserDocument(venta.clienteId).catch(() => null)) ?? undefined : undefined
      const cai = await getCaiRemitoOficial().catch(() => caiRemitoOficialCacheado())
      const g = await generarComprobanteVenta(venta, cliente, cai)
      return g.ok ? { ...g, titulo, fuente: 'app' } : g
    }
  }
  const detalle = await getRemitoTangoDetalle(empresa, numeroRemito).catch(() => null)
  if (detalle) {
    const datos = armarRemitoTangoPdf(detalle)
    const { generateRemitoPdf } = await import('@/utils/remitoPdf')
    const blob = (await generateRemitoPdf(datos, { descargar: false })) as Blob
    return { ok: true, blob, nombre: datos.archivo, titulo, fuente: 'tango' }
  }
  return { ok: false, motivo: SIN_REMITO }
}

export async function entregarRemito(numeroRemito: string, empresa: EmpresaTango, modo: 'ver' | 'enviar', clienteNombre: string): Promise<string> {
  let r: FacturaObtenida
  try {
    r = await obtenerRemitoPdf(numeroRemito, empresa)
  } catch {
    return 'No se pudo obtener el remito. Revisá la señal y probá de nuevo.'
  }
  return entregar(r, modo, clienteNombre)
}

async function entregar(r: FacturaObtenida, modo: 'ver' | 'enviar', clienteNombre: string): Promise<string> {
  if (!r.ok) return r.motivo
  if (modo === 'ver') { descargarArchivo(r.blob, r.nombre); return '' }
  const res = await compartirArchivo(r.blob, r.nombre, { titulo: r.titulo, texto: `${r.titulo} — ${clienteNombre}` })
  return res === 'descargado' ? 'Este dispositivo no puede compartir archivos: se descargó el PDF.' : ''
}
