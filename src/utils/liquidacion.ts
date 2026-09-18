import { cobranzasVigentes } from './anulacionCobranza'
import {
  CambioCamion, Cobranza, DescargaCamion, EmpresaTango, Liquidacion, LiquidacionResumenProducto,
  PlataEmpresa, PlataPorEmpresa, RemitoCarga, VentaCamion, VentaCamionItem,
} from '../types'
import { nombreDelCambio, productoDelCambio } from './cambios'
import { cuadrarEnvases } from './envases'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from './medios'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { ventaAnulada, ventasVigentes } from './anulacionVenta'
import { descargasVigentes } from './rectificacionDescarga'
import { importeCobrado, sumaCobrada } from './importeCobrado'

// Cálculo puro de la liquidación del repartidor — replica la hoja
// "Liquidación de repartidores" del sistema viejo: por producto, carga −
// ventas − cambios = devolución teórica, contra la descarga contada por
// muelle; más el cuadre de envases (tarimas, pallets de metal, puntales, aros
// y racks, desde 2026-09-07) y de plata. Ver el plan del módulo expedición y
// la foto de la hoja (2026-08-29).

/**
 * El cálculo está partido en dos mitades (2026-09-18) porque las dos mitades del
 * viaje se cierran por separado: la PLATA la liquida caja, de 6 a 18, y la
 * MERCADERÍA la cierra muelle al contar la descarga, a cualquier hora. Antes
 * esto devolvía todo junto y obligaba a tener las dos cosas para cerrar
 * cualquiera de las dos.
 *
 * `calcularLiquidacion` sigue existiendo y devuelve las dos, para lo que
 * necesita la foto entera del viaje (reparto en vivo, liquidaciones abiertas,
 * el PDF).
 */
export interface MercaderiaCalculada {
  productos: LiquidacionResumenProducto[]
  envases:   NonNullable<Liquidacion['envases']>
  cambios:   { registrados: number; rotasRecibidas: number }
}

export type PlataCalculada = Pick<Liquidacion, 'importes' | 'cobranzasCalle' | 'efectivoARendir'> & { porEmpresa: PlataPorEmpresa }

export type LiquidacionCalculada = PlataCalculada & MercaderiaCalculada

/** De qué empresa es la plata de una venta del camión: contado con factura = Redonhielo, promo = Rolito. */
export const empresaDeVenta = (v: Pick<VentaCamion, 'canal'>): EmpresaTango => (v.canal === 'promo' ? 'rolito' : 'redonhielo')
/** De qué empresa es una cobranza: la que dice el recibo; las viejas sin empresa son de Redonhielo. */
export const empresaDeCobranza = (c: Pick<Cobranza, 'empresa'>): EmpresaTango => c.empresa ?? 'redonhielo'

/**
 * Lo que se rinde de CADA empresa (rendición por sobres, etapa 1, 2026-09-16):
 * efectivo de ventas y cobranzas, transferencias (informativas), cheques y
 * retenciones. Es la base de las dos hojas impresas y del conteo por empresa.
 */
export function plataPorEmpresa(ventas: VentaCamion[], cobranzas: Cobranza[]): PlataPorEmpresa {
  const vacia = (): PlataEmpresa => ({
    efectivo: 0, transferencia: 0, ventas: { cantidad: 0, total: 0 }, cobranzas: { cantidad: 0, total: 0 }, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 },
    ventasContado: { cantidad: 0, total: 0 }, ventasEfectivo: 0, ventasTransferencia: 0, cobranzasEfectivo: 0, cobranzasTransferencia: 0,
  })
  const out: PlataPorEmpresa = { redonhielo: vacia(), rolito: vacia() }
  for (const v of ventas) {
    const e = out[empresaDeVenta(v)]
    const importe = importeCobrado(v)
    e.ventas.cantidad++; e.ventas.total += importe
    if (v.formaPago === 'contado_efectivo') { e.efectivo += importe; e.ventasEfectivo! += importe }
    else if (v.formaPago === 'contado_transferencia') { e.transferencia += importe; e.ventasTransferencia! += importe }
    if (v.formaPago !== 'cuenta_corriente') { e.ventasContado!.cantidad++; e.ventasContado!.total += importe }
  }
  for (const c of cobranzas) {
    const e = out[empresaDeCobranza(c)]
    e.cobranzas.cantidad++; e.cobranzas.total += c.importe
    e.efectivo += efectivoDe(c); e.cobranzasEfectivo! += efectivoDe(c)
    e.transferencia += transferenciaDe(c); e.cobranzasTransferencia! += transferenciaDe(c)
    const ch = chequesDe(c), re = retencionesDe(c)
    e.cheques.cantidad += ch.length; e.cheques.total += sumaImportes(ch)
    e.retenciones.cantidad += re.length; e.retenciones.total += sumaImportes(re)
  }
  return out
}

/**
 * MERCADERÍA del viaje: por producto, carga − ventas − cambios = devolución
 * teórica, contra lo que muelle contó; más el cuadre de envases. Es lo que el
 * servidor escribe en `cierresMercaderia/{remitoId}` al registrarse la descarga.
 *
 * No lleva un gramo de plata: el muelle cuenta a ciegas y nunca ve importes.
 */
export function mercaderiaDelViaje(
  remitos:   RemitoCarga[],
  ventas:    VentaCamion[],
  cambios:   CambioCamion[],
  descargas: DescargaCamion[],
): MercaderiaCalculada {
  // Una factura anulada con nota de crédito (2026-09-11) no cuenta: ni en
  // plata ni en productos (la NC devolvió el stock al depósito en Tango).
  ventas = ventasVigentes(ventas)
  // Un conteo rectificado (2026-09-13) no suma dos veces: vale la corrección en
  // lugar del original — ver utils/rectificacionDescarga.ts.
  descargas = descargasVigentes(descargas)
  // ── Por producto ── acumular cada fuente sobre el mismo mapa, indexado por
  // productoId, para que ningún producto quede afuera aunque aparezca en una
  // sola fuente (ej. vendió algo que no figura en la carga → diferencia).
  const porProducto = new Map<string, LiquidacionResumenProducto>()
  const fila = (productoId: string, nombre: string): LiquidacionResumenProducto => {
    let f = porProducto.get(productoId)
    if (!f) {
      f = { productoId, nombre, carga: 0, ventaContado: 0, ventaPromo: 0, cambios: 0, devolucionTeorica: 0, descarga: 0, diferencia: 0, rotas: 0 }
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
  // Rotas por producto (fase B del stock, 2026-09-17): el server las usa para el
  // faltante que va a Tango (carga − ventas − rotas − descarga). El productoId de
  // una rota puede venir con prefijo cambio_ en descargas viejas.
  descargas.forEach((d) => (d.bolsasRotas ?? []).forEach((i) => {
    const f = fila(productoDelCambio(i.productoId), nombreDelCambio(i.nombre))
    f.rotas = (f.rotas ?? 0) + i.cantidad
  }))

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

  return { productos, envases, cambios: { registrados, rotasRecibidas } }
}

/**
 * PLATA del viaje: lo que el repartidor tiene que rendir en caja. Es lo único
 * que mira la pantalla de liquidación del cajero, y se puede cerrar aunque la
 * mercadería siga en la calle.
 */
export function plataDelViaje(
  ventas: VentaCamion[],
  // Cobranzas de cta. cte. hechas en la calle por esta persona (los
  // cobradores son choferes — "Detalle de cobranzas" de la hoja vieja).
  cobranzasCalle: Cobranza[] = [],
): PlataCalculada {
  cobranzasCalle = cobranzasVigentes(cobranzasCalle)   // recibos anulados con autorización (2026-09-15): no cuentan
  ventas = ventasVigentes(ventas)

  const porPago = (fp: VentaCamion['formaPago']) =>
    sumaCobrada(ventas.filter((v) => v.formaPago === fp))
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
    // Rendición por sobres, etapa 1 (2026-09-16): lo mismo, partido por empresa.
    porEmpresa: plataPorEmpresa(ventas, cobranzasCalle),
  }
}

/**
 * Las dos mitades juntas, para lo que necesita la foto entera del viaje: el
 * reparto en vivo, liquidaciones abiertas y el PDF. La pantalla de caja NO usa
 * esto: usa `plataDelViaje`, y la mercadería la lee del cierre que escribió el
 * servidor.
 */
export function calcularLiquidacion(
  remitos:   RemitoCarga[],
  ventas:    VentaCamion[],
  cambios:   CambioCamion[],
  descargas: DescargaCamion[],
  cobranzasCalle: Cobranza[] = [],
): LiquidacionCalculada {
  return {
    ...mercaderiaDelViaje(remitos, ventas, cambios, descargas),
    ...plataDelViaje(ventas, cobranzasCalle),
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
const bloque = (ventas: VentaCamion[]): BloqueVentas => ({ ventas: ventas.slice().sort(porFecha), total: sumaCobrada(ventas) })

export function clasificarReparto(
  ventas: VentaCamion[],
  cobranzas: Cobranza[],
  cambiosLegacy: CambioCamion[] = [],
  descargas: DescargaCamion[] = [],
  problemasDe: (v: VentaCamion) => string[] = () => [],
): RepartoClasificado {
  cobranzas = cobranzasVigentes(cobranzas)
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
    if (v.canal === 'promo') c.promo += importeCobrado(v)
    else if (v.formaPago === 'cuenta_corriente') c.cuentaCorriente += importeCobrado(v)
    else c.contado += importeCobrado(v)
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
    efectivoARendir: contado.efectivo.total + sumaCobrada(promo.contado.ventas.filter((v) => v.formaPago === 'contado_efectivo')) + cob.efectivo,
  }
}

/** Ids y contadores que la liquidación cerrada guarda para poder reconstruir su detalle. */
export function referenciasDelReparto(remitos: RemitoCarga[], ventas: VentaCamion[], descargas: DescargaCamion[], cobranzas: Cobranza[]) {
  cobranzas = cobranzasVigentes(cobranzas)   // recibos anulados (2026-09-15): fuera del cierre
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
