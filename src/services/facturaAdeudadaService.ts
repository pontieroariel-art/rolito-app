import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { getUserDocument } from './userService'
import { blobFacturaArchivada, getFacturaArchivada } from './facturasArchivadasService'
import { generarComprobanteVenta } from '@/utils/comprobanteDeVenta'
import { armarFacturaDeVenta } from '@/utils/facturaDeVenta'
import { formatoFactura, parsearClaveTango } from '@/utils/facturaClave'
import { compartirArchivo, descargarArchivo } from '@/utils/compartir'
import type { ComprobanteSaldoTango, EmpresaTango, VentaCamion, VentaVentanilla } from '@/types'

// PDF de una factura adeudada (comprobante de la composición de saldos de
// Tango), para que el supervisor se lo comparta al cliente. Tres fuentes, en
// orden: (1) venta de la app facturada por ARCA (ventasCamion /
// ventasVentanilla, misma numeración que Tango: letra + PV + número); (2)
// factura X de promo, que en Tango entra con letra A/B y el número del
// comprobante interno; (3) factura emitida por Tango y archivada por
// administración desde Recupero de facturas. Si no está en ninguna, se le
// pide a administración.

export type FacturaObtenida =
  | { ok: true; blob: Blob; nombre: string; titulo: string; fuente: 'app' | 'archivo' }
  | { ok: false; motivo: string }

const SIN_ARCHIVO = 'Esta factura no está en la app: pedila a administración (Recupero de facturas → Guardar en la app).'

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

export async function obtenerFacturaPdf(comp: ComprobanteSaldoTango, empresa: EmpresaTango): Promise<FacturaObtenida> {
  const clave = parsearClaveTango(comp.numero)
  if (!clave) return { ok: false, motivo: `No se reconoce el número ${comp.numero}.` }
  const titulo = `Factura ${formatoFactura(clave)}`

  // (1) Contado facturado por ARCA desde la app (Redonhielo): camión o mostrador.
  if (empresa === 'redonhielo' && clave.letra !== 'X') {
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
  if (empresa === 'rolito') {
    const venta = await ventaCamionPor('comprobanteInterno', clave.puntoVenta, clave.numero)
    if (venta?.comprobanteInterno) {
      const cliente = venta.clienteId ? (await getUserDocument(venta.clienteId)) ?? undefined : undefined
      const g = await generarComprobanteVenta(venta, cliente, null)
      return g.ok ? { ...g, titulo, fuente: 'app' } : g
    }
  }

  // (3) Archivada por administración.
  const archivada = await getFacturaArchivada(empresa, comp.numero.trim().toUpperCase())
  if (archivada) {
    const blob = await blobFacturaArchivada(archivada)
    return { ok: true, blob, nombre: `factura-${archivada.clave}.pdf`, titulo, fuente: 'archivo' }
  }
  return { ok: false, motivo: SIN_ARCHIVO }
}

/** Ver (descargar) o enviar (compartir). Devuelve un aviso para pantalla, o '' si salió bien. */
export async function entregarFacturaAdeudada(comp: ComprobanteSaldoTango, empresa: EmpresaTango, modo: 'ver' | 'enviar', clienteNombre: string): Promise<string> {
  let r: FacturaObtenida
  try {
    r = await obtenerFacturaPdf(comp, empresa)
  } catch {
    return 'No se pudo obtener la factura. Revisá la señal y probá de nuevo.'
  }
  if (!r.ok) return r.motivo
  if (modo === 'ver') { descargarArchivo(r.blob, r.nombre); return '' }
  const res = await compartirArchivo(r.blob, r.nombre, { titulo: r.titulo, texto: `${r.titulo} — ${clienteNombre}` })
  return res === 'descargado' ? 'Este dispositivo no puede compartir archivos: se descargó el PDF.' : ''
}
