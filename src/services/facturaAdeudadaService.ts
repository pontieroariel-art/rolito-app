import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { getUserDocument } from './userService'
import { blobFacturaArchivada, getFacturaArchivada } from './facturasArchivadasService'
import { getFacturaTangoDetalle, getRemitoTangoDetalle } from './tangoComprobantesService'
import { caiRemitoOficialCacheado, getCaiRemitoOficial } from './remitoOficialConfigService'
import { generarComprobanteVenta } from '@/utils/comprobanteDeVenta'
import { armarFacturaDeVenta } from '@/utils/facturaDeVenta'
import { formatoFactura, parsearClaveTango } from '@/utils/facturaClave'
import { armarFacturaRolitoTangoPdf, armarFacturaTangoArcaPdf, armarFacturaTangoPdf, armarRemitoTangoPdf, formatoRemito, parsearRemito, usaFormatoTango } from '@/utils/comprobantesTango'
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

// Sin try/catch a propósito: una falla acá (sin señal) tiene que llegar como
// error ("revisá la señal"), no convertirse en "la factura no está en la app".
// Los permisos de lectura para cada rol viven en firestore.rules.
async function ventaCamionPor(campo: 'factura' | 'comprobanteInterno', puntoVenta: number, numero: number): Promise<VentaCamion | null> {
  const snap = await getDocs(query(
    collection(db, 'ventasCamion'),
    where(`${campo}.puntoVenta`, '==', puntoVenta),
    where(`${campo}.numero`, '==', numero),
    limit(1),
  ))
  return snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as VentaCamion)
}

async function ventaVentanillaPor(puntoVenta: number, numero: number): Promise<VentaVentanilla | null> {
  const snap = await getDocs(query(
    collection(db, 'ventasVentanilla'),
    where('factura.puntoVenta', '==', puntoVenta),
    where('factura.numero', '==', numero),
    limit(1),
  ))
  return snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as VentaVentanilla)
}

const TITULO_TIPO: Record<string, string> = { FAC: 'Factura', NC: 'Nota de crédito', ND: 'Nota de débito' }

/** `fechaVencimiento` (yyyy-MM-dd) solo lo trae la composición en vivo: con él la factura de Tango imprime su cuota. */
export async function obtenerFacturaPdf(comp: Pick<ComprobanteSaldoTango, 'tipo' | 'numero'> & { fechaVencimiento?: string }, empresa: EmpresaTango): Promise<FacturaObtenida> {
  const clave = parsearClaveTango(comp.numero)
  if (!clave) return { ok: false, motivo: `No se reconoce el número ${comp.numero}.` }
  const tipo = comp.tipo.replace('/', '').toUpperCase()
  const titulo = `${TITULO_TIPO[tipo] ?? comp.tipo} ${formatoFactura(clave)}`

  // (1) Contado facturado por ARCA desde la app (Redonhielo): camión o mostrador.
  // Las dos búsquedas van en paralelo (2026-09-12): antes eran viajes en serie
  // y en Comprobantes de clientes cada fila tardaba lo que sumaban todos.
  if (empresa === 'redonhielo' && clave.letra !== 'X' && tipo === 'FAC') {
    const [venta, mostrador] = await Promise.all([
      ventaCamionPor('factura', clave.puntoVenta, clave.numero),
      ventaVentanillaPor(clave.puntoVenta, clave.numero),
    ])
    if (venta?.factura?.estado === 'emitida') {
      const cliente = venta.clienteId ? (await getUserDocument(venta.clienteId)) ?? undefined : undefined
      const g = await generarComprobanteVenta(venta, cliente, null)
      return g.ok ? { ...g, titulo, fuente: 'app' } : g
    }
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
    // Orden de compra heredada de los remitos (2026-09-21): cuando la oficina
    // factura en Tango un remito de la app, Tango NO copia la leyenda donde la
    // app dejó la O/C (de 175 facturas así desde el 1/09, solo 28 la tenían, y
    // porque la oficina la volvió a tipear). Si la factura no trae ninguna, se
    // toma la de sus remitos y se imprime igual que si estuviera en la factura.
    if (!detalle.ordenCompra && detalle.remitos?.length) {
      const remitos = await Promise.all(detalle.remitos.map((n) => getRemitoTangoDetalle(empresa, n).catch(() => null)))
      const heredadas = [...new Set(remitos.flatMap((r) => (r?.ordenCompra ? r.ordenCompra.split(',').map((x) => x.trim()) : [])).filter(Boolean))]
      if (heredadas.length) detalle.ordenCompra = heredadas.join(', ')
    }
    // Rolito (2026-09-15): no factura por ARCA; su papel es el interno "PROMOCIÓN"
    // letra X, el mismo que la app imprime para sus promos. Antes esto devolvía
    // "se imprime desde la venta de la app" y los supervisores no veían ninguna
    // factura de Rolito cargada en Tango por la oficina.
    if (detalle.empresa === 'rolito') {
      const interno = armarFacturaRolitoTangoPdf(detalle)
      if (!interno.ok) return interno
      const { generateComprobanteInternoPdf } = await import('@/utils/comprobanteInternoPdf')
      const blob = (await generateComprobanteInternoPdf(interno.datos, { descargar: false })) as Blob
      return { ok: true, blob, nombre: interno.datos.archivo, titulo, fuente: 'tango' }
    }
    // Desde el 20/08/2026 Tango emite con su formato nuevo, que es el de la
    // factura ARCA de la app; lo anterior es Bluesoft y sale con el histórico.
    // Sin CAE ninguno de los dos se arma y se sigue a la archivada (4).
    if (usaFormatoTango(detalle.fecha)) {
      const armado = armarFacturaTangoArcaPdf(detalle, { fechaVencimiento: comp.fechaVencimiento })
      if (armado.ok) {
        const { generateFacturaArcaPdf } = await import('@/utils/facturaArcaPdf')
        const blob = await generateFacturaArcaPdf(armado.datos)
        return { ok: true, blob, nombre: `factura-${comp.numero}.pdf`, titulo, fuente: 'tango' }
      }
    } else {
      const armado = armarFacturaTangoPdf(detalle)
      if (armado.ok) {
        const { generateFacturaPdf } = await import('@/utils/facturaPdf')
        const blob = (await generateFacturaPdf(armado.datos)) as Blob
        return { ok: true, blob, nombre: `factura-${comp.numero}.pdf`, titulo, fuente: 'tango' }
      }
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

