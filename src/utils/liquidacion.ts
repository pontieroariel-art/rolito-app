import {
  CambioCamion, Cobranza, DescargaCamion, Liquidacion, LiquidacionResumenProducto,
  RemitoCarga, VentaCamion, VentaCamionItem,
} from '../types'
import { nombreDelCambio, productoDelCambio } from './cambios'
import { cuadrarEnvases } from './envases'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from './medios'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { ventaAnulada, ventasVigentes } from './anulacionVenta'

// Cálculo puro de la liquidación del repartidor — replica la hoja
// "Liquidación de repartidores" del sistema viejo: por producto, carga −
// ventas − cambios = devolución teórica, contra la descarga contada por
// muelle; más el cuadre de envases (tarimas, pallets de metal, puntales, aros
// y racks, desde 2026-09-07) y de plata. Ver el plan del módulo expedición y
// la foto de la hoja (2026-08-29).

export type LiquidacionCalculada = Omit<Liquidacion,
  'id' | 'numero' | 'codigo' | 'fecha' | 'plantaId' | 'choferId' | 'choferNombre' | 'efectivoRecibido' | 'diferenciaEfectivo' | 'cerradaPor' | 'createdAt' | 'pallets'
  | 'diferencia' | 'firmaRepartidor' | 'firmanteRepartidor' | 'firmaRecibe' | 'firmanteRecibe' | 'confirmoSinPendientes' | 'cheques' | 'retenciones' | 'valoresFaltantes' | 'entregaId'
> & { envases: NonNullable<Liquidacion['envases']> }

export function calcularLiquidacion(
  remitos:   RemitoCarga[],
  ventas:    VentaCamion[],
  cambios:   CambioCamion[],
  descargas: DescargaCamion[],
  // Cobranzas de cta. cte. hechas en la calle por esta persona (los
  // cobradores son choferes — "Detalle de cobranzas" de la hoja vieja).
  cobranzasCalle: Cobranza[] = [],
): LiquidacionCalculada {
  // Una factura anulada con nota de crédito (2026-09-11) no cuenta: ni en
  // plata ni en productos (la NC devolvió el stock al depósito en Tango).
  ventas = ventasVigentes(ventas)
  // ── Por producto ── acumular cada fuente sobre el mismo mapa, indexado por
  // productoId, para que ningún producto quede afuera aunque aparezca en una
  // sola fuente (ej. vendió algo que no figura en la carga → diferencia).
  const porProducto = new Map<string, LiquidacionResumenProducto>()
  const fila = (productoId: string, nombre: string): LiquidacionResumenProducto => {
    let f = porProducto.get(productoId)
    if (!f) {
      f = { productoId, nombre, carga: 0, ventaContado: 0, ventaPromo: 0, cambios: 0, devolucionTeorica: 0, descarga: 0, diferencia: 0 }
      porProducto.set(productoId, f)
    }
    return f
  }

  remitos.forEach((r) => r.items.forEach((i) => { fila(i.productoId, i.nombre).carga += i.cantidad }))
  ventas.forEach((v) => v.items.forEach((i) => {
    const f = fila(i.productoId, i.nombre)
    if (v.canal === 'contado') f.ventaContado += i.cantidad
    else f.ventaPromo += i.cantidad
  }))
  // Cambios: hoy viajan adentro de la venta (renglones en $0 del mismo papel).
  // La colección `cambiosCamion` es el registro viejo, de cuando el cambio era
  // una pantalla aparte — se sigue leyendo para que los días anteriores a la
  // migración liquiden igual. El productoId de un cambio lleva el prefijo
  // `cambio_`, así que se normaliza al del producto para que caiga en su misma
  // fila (la carga y la descarga lo cuentan como el producto que es).
  ventas.forEach((v) => (v.cambios ?? []).forEach((i) => {
    const productoId = productoDelCambio(i.productoId)
    fila(productoId, nombreDelCambio(i.nombre)).cambios += i.cantidad
  }))
  cambios.forEach((c) => { fila(c.productoId, c.nombre).cambios += c.cantidad })
  descargas.forEach((d) => d.items.forEach((i) => { fila(i.productoId, i.nombre).descarga += i.cantidad }))

  const productos = [...porProducto.values()].map((f) => {
    const devolucionTeorica = f.carga - f.ventaContado - f.ventaPromo - f.cambios
    return { ...f, devolucionTeorica, diferencia: f.descarga - devolucionTeorica }
  }).sort((a, b) => a.nombre.localeCompare(b.nombre))

  // ── Envases ── lo que salió (remitos) vs lo que volvió (descargas), por
  // tipo y por número de rack. Los docs anteriores al 2026-09-07 se normalizan
  // en utils/envases.ts.
  const envases = cuadrarEnvases(remitos, descargas)

  // ── Cambios vs bolsas rotas recibidas ── las dos fuentes: los renglones de
  // cambio de cada venta y el registro viejo de `cambiosCamion`.
  const registrados =
    ventas.reduce((s, v) => s + (v.cambios ?? []).reduce((x, i) => x + i.cantidad, 0), 0) +
    cambios.reduce((s, c) => s + c.cantidad, 0)
  const rotasRecibidas = descargas.reduce((s, d) => s + d.bolsasRotas.reduce((x, i) => x + i.cantidad, 0), 0)

  // ── Plata ──
  const porPago = (fp: VentaCamion['formaPago']) =>
    ventas.filter((v) => v.formaPago === fp).reduce((s, v) => s + v.total, 0)
  const contadoEfectivo      = porPago('contado_efectivo')
  const contadoTransferencia = porPago('contado_transferencia')
  const cuentaCorriente      = porPago('cuenta_corriente')

  // ── Cobranzas de calle ── el efectivo cobrado se rinde junto con el de
  // las ventas, en el mismo cierre (así rendían en el sistema viejo). La
  // cobranza completa (desde 2026-09-05) trae `medios`: se rinde el efectivo
  // que dice ahí; cheques y retenciones no son plata que lleve el chofer
  // (efectivoDe / transferenciaDe viven en utils/medios.ts).
  const cobranzasEfectivo = cobranzasCalle.reduce((s, c) => s + efectivoDe(c), 0)
  const cobranzasTransferencia = cobranzasCalle.reduce((s, c) => s + transferenciaDe(c), 0)
  const chequesCalle = cobranzasCalle.flatMap(chequesDe)
  const retencionesCalle = cobranzasCalle.flatMap(retencionesDe)

  return {
    productos,
    envases,
    cambios: { registrados, rotasRecibidas },
    importes: {
      contadoEfectivo, contadoTransferencia, cuentaCorriente,
      total: contadoEfectivo + contadoTransferencia + cuentaCorriente,
    },
    cobranzasCalle: {
      cantidad:      cobranzasCalle.length,
      efectivo:      cobranzasEfectivo,
      transferencia: cobranzasTransferencia,
      total:         cobranzasEfectivo + cobranzasTransferencia,
      cheques:       { cantidad: chequesCalle.length, total: sumaImportes(chequesCalle) },
      retenciones:   { cantidad: retencionesCalle.length, total: sumaImportes(retencionesCalle) },
    },
    efectivoARendir: contadoEfectivo + cobranzasEfectivo,
  }
}

// ── Clasificación del reparto para la liquidación detallada (2026-09-06) ─────
// Ariel: "que la información esté bien clasificada": contado / cuenta
// corriente / promo / cobranzas / cambios, cada bloque con su subtotal, y un
// resumen por cliente. Puro, sobre los mismos docs del día.

export interface BloqueVentas { ventas: VentaCamion[]; total: number }

export interface CobranzasClasificadas {
  redonhielo: Cobranza[]
  rolito:     Cobranza[]
  efectivo:      number
  transferencia: number
  cheques:       { cantidad: number; total: number }
  retenciones:   { cantidad: number; total: number }
  total:         number
}

export interface CambioDelReparto {
  ventaId:      string
  fecha:        VentaCamion['fecha']
  clienteId:    string
  clienteNombre: string
  clienteCodigoTango?: string
  items:        VentaCamionItem[]
  /** Comprobante de la venta en la que se registró el cambio (para citarlo). */
  venta?:       VentaCamion
}

export interface ClienteDelReparto {
  clienteId:    string
  nombre:       string
  codigoTango:  string
  contado:      number
  cuentaCorriente: number
  promo:        number
  cobrado:      number
  cambios:      number
  ventas:       number
  cobranzas:    number
  problemas:    number
}

export interface RepartoClasificado {
  contado:         { efectivo: BloqueVentas; transferencia: BloqueVentas; total: number }
  cuentaCorriente: BloqueVentas
  promo:           { contado: BloqueVentas; cuentaCorriente: BloqueVentas; total: number }
  cobranzas:       CobranzasClasificadas
  cambios:         { lista: CambioDelReparto[]; unidades: number; rotasRecibidas: number }
  clientes:        ClienteDelReparto[]
  /** Ventas con algún problema de control (factura rechazada/incierta, sin número, Tango en error). */
  problemas:       Array<{ venta: VentaCamion; motivos: string[] }>
  /** Facturas anuladas con nota de crédito (2026-09-11): se muestran, no suman. */
  anuladas:        VentaCamion[]
  totalVendido:    number
  efectivoARendir: number
}

const porFecha = <T extends { fecha: { toMillis(): number } }>(a: T, b: T) => a.fecha.toMillis() - b.fecha.toMillis()
const bloque = (ventas: VentaCamion[]): BloqueVentas => ({ ventas: ventas.slice().sort(porFecha), total: ventas.reduce((s, v) => s + v.total, 0) })

export function clasificarReparto(
  ventas: VentaCamion[],
  cobranzas: Cobranza[],
  cambiosLegacy: CambioCamion[] = [],
  descargas: DescargaCamion[] = [],
  problemasDe: (v: VentaCamion) => string[] = () => [],
): RepartoClasificado {
  // Las anuladas se listan aparte (`anuladas`) para que caja las vea; en los
  // bloques y totales no entran.
  const anuladas = ventas.filter(ventaAnulada)
  ventas = ventasVigentes(ventas)
  const contadoV = ventas.filter((v) => v.canal !== 'promo')
  const promoV = ventas.filter((v) => v.canal === 'promo')
  const contado = {
    efectivo:      bloque(contadoV.filter((v) => v.formaPago === 'contado_efectivo')),
    transferencia: bloque(contadoV.filter((v) => v.formaPago === 'contado_transferencia')),
    total: 0,
  }
  contado.total = contado.efectivo.total + contado.transferencia.total
  const cuentaCorriente = bloque(contadoV.filter((v) => v.formaPago === 'cuenta_corriente'))
  const promo = {
    contado:         bloque(promoV.filter((v) => v.formaPago !== 'cuenta_corriente')),
    cuentaCorriente: bloque(promoV.filter((v) => v.formaPago === 'cuenta_corriente')),
    total: 0,
  }
  promo.total = promo.contado.total + promo.cuentaCorriente.total

  const cobOrdenadas = cobranzas.slice().sort(porFecha)
  const cheques = cobOrdenadas.flatMap((c) => c.medios?.cheques ?? [])
  const retenciones = cobOrdenadas.flatMap((c) => c.medios?.retenciones ?? [])
  const cob: CobranzasClasificadas = {
    redonhielo: cobOrdenadas.filter((c) => c.empresa !== 'rolito'),
    rolito:     cobOrdenadas.filter((c) => c.empresa === 'rolito'),
    efectivo:      cobOrdenadas.reduce((s, c) => s + efectivoDe(c), 0),
    transferencia: cobOrdenadas.reduce((s, c) => s + transferenciaDe(c), 0),
    cheques:     { cantidad: cheques.length, total: cheques.reduce((s, ch) => s + ch.importe, 0) },
    retenciones: { cantidad: retenciones.length, total: retenciones.reduce((s, r) => s + r.importe, 0) },
    total: cobOrdenadas.reduce((s, c) => s + c.importe, 0),
  }

  const cambiosLista: CambioDelReparto[] = ventas
    .filter((v) => (v.cambios ?? []).length > 0)
    .sort(porFecha)
    .map((v) => ({ ventaId: v.id, fecha: v.fecha, clienteId: v.clienteId, clienteNombre: nombreClienteVenta(v), clienteCodigoTango: v.clienteCodigoTango, items: v.cambios ?? [], venta: v }))
  for (const c of cambiosLegacy.slice().sort(porFecha)) {
    cambiosLista.push({ ventaId: c.id, fecha: c.fecha, clienteId: c.clienteId, clienteNombre: c.clienteNombre, items: [{ productoId: c.productoId, nombre: c.nombre, cantidad: c.cantidad, precioUnitario: 0 }] })
  }
  const unidades = cambiosLista.reduce((s, c) => s + c.items.reduce((x, i) => x + i.cantidad, 0), 0)
  const rotasRecibidas = descargas.reduce((s, d) => s + d.bolsasRotas.reduce((x, i) => x + i.cantidad, 0), 0)

  const problemas = ventas.slice().sort(porFecha).map((venta) => ({ venta, motivos: problemasDe(venta) })).filter((p) => p.motivos.length > 0)
  const problemasPorVenta = new Map(problemas.map((p) => [p.venta.id, p.motivos.length]))

  // Una fila por cliente Y sucursal (código de Tango): dos entregas a distintas
  // sucursales de la misma cuenta no se mezclan (2026-09-11). Sin código, por cliente.
  const clientes = new Map<string, ClienteDelReparto>()
  const cli = (id: string, nombre: string, codigo?: string) => {
    // Sin código (cobranza simple, cambio legacy) cae en la fila que ya exista del cliente.
    const clave = codigo ? `${id}|${codigo}` : ([...clientes.keys()].find((k) => k === id || k.startsWith(`${id}|`)) ?? id)
    let c = clientes.get(clave)
    if (!c) { c = { clienteId: id, nombre, codigoTango: codigo ?? '', contado: 0, cuentaCorriente: 0, promo: 0, cobrado: 0, cambios: 0, ventas: 0, cobranzas: 0, problemas: 0 }; clientes.set(clave, c) }
    if (!c.codigoTango && codigo) c.codigoTango = codigo
    return c
  }
  for (const v of ventas) {
    const c = cli(v.clienteId, nombreClienteVenta(v), v.clienteCodigoTango)
    c.ventas++
    if (v.canal === 'promo') c.promo += v.total
    else if (v.formaPago === 'cuenta_corriente') c.cuentaCorriente += v.total
    else c.contado += v.total
    c.cambios += (v.cambios ?? []).reduce((s, i) => s + i.cantidad, 0)
    c.problemas += problemasPorVenta.get(v.id) ?? 0
  }
  for (const cb of cobranzas) { const c = cli(cb.clienteId, cb.clienteNombre, cb.codigoTango); c.cobranzas++; c.cobrado += cb.importe }
  for (const x of cambiosLegacy) cli(x.clienteId, x.clienteNombre).cambios += x.cantidad

  const totalVendido = contado.total + cuentaCorriente.total + promo.total
  return {
    contado, cuentaCorriente, promo, cobranzas: cob,
    cambios: { lista: cambiosLista, unidades, rotasRecibidas },
    clientes: [...clientes.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    problemas,
    anuladas,
    totalVendido,
    efectivoARendir: contado.efectivo.total + promo.contado.ventas.filter((v) => v.formaPago === 'contado_efectivo').reduce((s, v) => s + v.total, 0) + cob.efectivo,
  }
}

/** Ids y contadores que la liquidación cerrada guarda para poder reconstruir su detalle. */
export function referenciasDelReparto(remitos: RemitoCarga[], ventas: VentaCamion[], descargas: DescargaCamion[], cobranzas: Cobranza[]) {
  return {
    remitosCargaIds: remitos.map((r) => r.id),
    ventasIds:       ventas.map((v) => v.id),
    descargasIds:    descargas.map((d) => d.id),
    cobranzasIds:    cobranzas.map((c) => c.id),
    cantidadVentas:    ventas.length,
    cantidadCobranzas: cobranzas.length,
    clientesVisitados: new Set([...ventas.map((v) => v.clienteId), ...cobranzas.map((c) => c.clienteId)]).size,
  }
}

// ── Numeración por persona (2026-09-09) ──────────────────────────────────────
// Cada repartidor/cobrador/supervisor tiene su serie: la clave del contador es
// su depósito de Tango (config/liquidacionCounter_dep21 → "LQ-21-000015"). Sin
// depósito (identidad huérfana) la serie es por la identidad misma, con
// prefijo SD y la clave saneada para el id del doc.
export function serieLiquidacion(choferId: string, depositoTango?: string | null): { clave: string; prefijo: string } {
  const dep = (depositoTango ?? '').trim()
  if (dep) return { clave: `dep${dep}`, prefijo: dep }
  return { clave: choferId.replace(/[^A-Za-z0-9-]/g, '-'), prefijo: 'SD' }
}

export const codigoLiquidacion = (prefijo: string, numero: number): string => `LQ-${prefijo}-${String(numero).padStart(6, '0')}`
