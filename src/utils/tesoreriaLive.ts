import { cobranzasVigentes } from './anulacionCobranza'
import type { CajaSesion, Cobranza, DescargaCamion, EmpresaTango, Liquidacion, PlantaId, RemitoCarga, Rendicion, Sobre, VentaCamion, VentaVentanilla } from '@/types'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from './medios'
import { importeCobrado, type VentaConImporte } from './importeCobrado'
import { descargasVigentes } from './rectificacionDescarga'
import { empresaDeCobranza, empresaDeVenta } from './liquidacion'

// Cálculo PURO de los dos tableros en vivo (2026-09-09; partido en dos el
// 2026-09-16 por pedido de Ariel): con los docs de un día (ventas del camión,
// ventas de ventanilla de las dos plantas, cobranzas de todos los orígenes,
// remitos de carga, descargas, liquidaciones, cierres de caja, turnos y sobres)
// arma una fila por chofer, por cajero y por supervisor, más los totales.
//
//   · VENTAS en vivo mira la MERCADERÍA: qué salió, qué se vendió y entregó,
//     con qué documento (contado, promo, cuenta corriente), bultos, turnos de
//     ventanilla entregados o en cola, si el camión volvió y muelle contó.
//   · TESORERÍA en vivo mira la PLATA: efectivo a rendir por empresa
//     (Redonhielo = contado con factura, Rolito = promo, cada cobranza con la
//     suya), cheques, retenciones, transferencias (informativas, no pasan por
//     el sobre) y dónde está cada cierre (liquidación, turno, sobre).
//
// Las dos pantallas leen el MISMO resumen; cada una muestra su parte.

export interface PlataVentas { cantidad: number; efectivo: number; transferencia: number; cuentaCorriente: number; total: number }
export interface PlataCobranzas { cantidad: number; efectivo: number; transferencia: number; cheques: { cantidad: number; total: number }; retenciones: { cantidad: number; total: number }; total: number }
export interface Bulto { productoId: string; nombre: string; cantidad: number }
/** Un producto del día (Ventas en vivo, 2026-09-16, pedido de Ariel: "en bultos no nos sirve, nos sirve que se sepa bien qué productos"). */
/** Una cantidad partida por empresa más el total (Ariel: "que siempre esté todo dividido y el total"). */
export interface PorEmpresaYTotal { redonhielo: number; rolito: number; total: number }
export const porEmpresaYTotalVacio = (): PorEmpresaYTotal => ({ redonhielo: 0, rolito: 0, total: 0 })
export interface ProductoLive {
  productoId: string
  nombre: string
  cargado: number
  vendidoCalle: PorEmpresaYTotal
  vendidoVentanilla: PorEmpresaYTotal
  /** Volvió a planta y muelle lo contó (descargas vigentes). */
  descargado: number
}
/** Lo que una persona tiene de UNA empresa: efectivo a rendir, valores en papel y transferencias (no se rinden). */
export interface PlataEmpresaLive { efectivo: number; transferencia: number; cheques: { cantidad: number; total: number }; retenciones: { cantidad: number; total: number } }
export type PorEmpresaLive = Record<EmpresaTango, PlataEmpresaLive>
/** Turnos de ventanilla: vendidos, ya entregados por muelle y todavía en la cola. */
export interface TurnosVentanilla { vendidos: number; entregados: number; enCola: number }

export type EstadoCalle = 'sin_carga' | 'cargado' | 'vendiendo' | 'volvio' | 'descargado' | 'liquidado'
export interface FilaCalle {
  choferId: string
  nombre: string
  deposito?: string
  remitos: number
  cargaBultos: number
  contado: PlataVentas
  promo: PlataVentas
  bultosVendidos: number
  /** Por producto: cargado, vendido y lo que volvió, de este repartidor. */
  productos: ProductoLive[]
  cobranzas: PlataCobranzas
  porEmpresa: PorEmpresaLive
  /** El camión volvió a planta (`remitosCarga.regreso`, 2026-09-13). */
  volvio: boolean
  /** Descargas contadas por muelle (vigentes: una rectificación reemplaza a la original). */
  descargas: number
  bultosDescargados: number
  liquidacion: Liquidacion | null
  estado: EstadoCalle
}

export type EstadoCaja = 'sin_turno' | 'abierta' | 'en_camino' | 'recibida' | 'cerrada' | 'validada'
export interface FilaVentanilla {
  cajaId: string
  nombre: string
  contado: PlataVentas
  promo: PlataVentas
  bultos: Bulto[]
  turnos: TurnosVentanilla
  cobranzas: PlataCobranzas
  porEmpresa: PorEmpresaLive
  /** Cierre viejo (`rendiciones` tipo 'mostrador', antes del turno de caja). */
  rendicion: Rendicion | null
  /** Último turno del día del cajero (rendición de fondos, 2026-09-14). */
  sesion: CajaSesion | null
  /** Último sobre de ventanilla del día del cajero. */
  sobre: Sobre | null
  /** 'cerrada' / 'validada' son los cierres viejos; desde el turno de caja: sin_turno → abierta → en_camino → recibida. */
  estado: EstadoCaja
  /** Las ventas del cajero una por una, por hora (2026-09-14): INCLUYE las anuladas (con su `anulacion`) para verlas tachadas; en las sumas no cuentan. */
  ventas: VentaVentanilla[]
  /** Las cobranzas de mostrador del cajero (`origen === 'caja'`), una por una, por hora. */
  recibos: Cobranza[]
}

export interface FilaSupervisor {
  uid: string
  nombre: string
  cobranzas: PlataCobranzas
  porEmpresa: PorEmpresaLive
  liquidacion: Liquidacion | null
}

export interface ResumenLive {
  totales: {
    ventasCalle: { contado: PlataVentas; promo: PlataVentas }
    ventasVentanilla: { contado: PlataVentas; promo: PlataVentas }
    cobranzas: { calle: PlataCobranzas; ventanilla: PlataCobranzas; supervisores: PlataCobranzas }
    efectivoDelDia: number   // ventas efectivo + cobranzas efectivo, de todos
    /** La plata del día por empresa, de todos los puntos (tesorería). */
    porEmpresa: PorEmpresaLive
    /** Bultos del día (ventas). */
    bultos: { cargadosCalle: number; vendidosCalle: number; descargadosCalle: number; vendidosVentanilla: number }
    /** Por producto, de todo el día (calle y ventanilla). */
    productos: ProductoLive[]
    turnos: TurnosVentanilla
  }
  calle: FilaCalle[]
  ventanilla: Record<PlantaId, FilaVentanilla[]>
  supervisores: FilaSupervisor[]
}

export const EMPRESAS_LIVE: EmpresaTango[] = ['redonhielo', 'rolito']

const plataVacia = (): PlataVentas => ({ cantidad: 0, efectivo: 0, transferencia: 0, cuentaCorriente: 0, total: 0 })
const cobVacia = (): PlataCobranzas => ({ cantidad: 0, efectivo: 0, transferencia: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 }, total: 0 })
const empresaVacia = (): PlataEmpresaLive => ({ efectivo: 0, transferencia: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 } })
export const porEmpresaVacio = (): PorEmpresaLive => ({ redonhielo: empresaVacia(), rolito: empresaVacia() })
const turnosVacios = (): TurnosVentanilla => ({ vendidos: 0, entregados: 0, enCola: 0 })

function sumarVenta(p: PlataVentas, v: VentaConImporte & { formaPago: string }): void {
  const importe = importeCobrado(v)   // con IVA si hay factura de ARCA (2026-09-14)
  p.cantidad++
  if (v.formaPago === 'contado_efectivo') p.efectivo += importe
  else if (v.formaPago === 'contado_transferencia') p.transferencia += importe
  else p.cuentaCorriente += importe
  p.total += importe
}

function sumarCobranza(p: PlataCobranzas, c: Cobranza): void {
  const ch = chequesDe(c), re = retencionesDe(c)
  p.cantidad++
  p.efectivo += efectivoDe(c)
  p.transferencia += transferenciaDe(c)
  p.cheques.cantidad += ch.length; p.cheques.total += sumaImportes(ch)
  p.retenciones.cantidad += re.length; p.retenciones.total += sumaImportes(re)
  p.total = p.efectivo + p.transferencia + p.cheques.total + p.retenciones.total
}

// Por empresa (rendición por sobres, 2026-09-16): la venta va a la empresa de
// su canal y la cobranza a la que dice el recibo. La cuenta corriente no es plata.
function sumarVentaEmpresa(pe: PorEmpresaLive, v: VentaCamion | VentaVentanilla): void {
  const e = pe[empresaDeVenta(v)]
  const importe = importeCobrado(v)
  if (v.formaPago === 'contado_efectivo') e.efectivo += importe
  else if (v.formaPago === 'contado_transferencia') e.transferencia += importe
}
function sumarCobranzaEmpresa(pe: PorEmpresaLive, c: Cobranza): void {
  const e = pe[empresaDeCobranza(c)]
  const ch = chequesDe(c), re = retencionesDe(c)
  e.efectivo += efectivoDe(c)
  e.transferencia += transferenciaDe(c)
  e.cheques.cantidad += ch.length; e.cheques.total += sumaImportes(ch)
  e.retenciones.cantidad += re.length; e.retenciones.total += sumaImportes(re)
}
/** Suma de dos desgloses por empresa (para los totales). */
export function sumarPorEmpresa(a: PorEmpresaLive, b: PorEmpresaLive): PorEmpresaLive {
  const out = porEmpresaVacio()
  for (const e of EMPRESAS_LIVE) {
    out[e] = {
      efectivo: a[e].efectivo + b[e].efectivo,
      transferencia: a[e].transferencia + b[e].transferencia,
      cheques: { cantidad: a[e].cheques.cantidad + b[e].cheques.cantidad, total: a[e].cheques.total + b[e].cheques.total },
      retenciones: { cantidad: a[e].retenciones.cantidad + b[e].retenciones.cantidad, total: a[e].retenciones.total + b[e].retenciones.total },
    }
  }
  return out
}
export const efectivoPorEmpresa = (pe: PorEmpresaLive): number => pe.redonhielo.efectivo + pe.rolito.efectivo

const bultosDe = (items: { productoId: string; nombre: string; cantidad: number }[], acum: Map<string, Bulto>): void => {
  for (const i of items) {
    const b = acum.get(i.productoId) ?? { productoId: i.productoId, nombre: i.nombre, cantidad: 0 }
    b.cantidad += i.cantidad
    acum.set(i.productoId, b)
  }
}
const cantidadDe = (items: { cantidad: number }[]): number => items.reduce((s, i) => s + i.cantidad, 0)

// Acumulador por producto: una fila por productoId. Lo vendido se parte por
// la empresa de la venta (contado = Redonhielo, promo = Rolito) más el total.
type CampoProducto = 'cargado' | 'vendidoCalle' | 'vendidoVentanilla' | 'descargado'
function sumarProductos(acum: Map<string, ProductoLive>, items: { productoId: string; nombre: string; cantidad: number }[], campo: CampoProducto, empresa?: EmpresaTango): void {
  for (const i of items) {
    let p = acum.get(i.productoId)
    if (!p) { p = { productoId: i.productoId, nombre: i.nombre, cargado: 0, vendidoCalle: porEmpresaYTotalVacio(), vendidoVentanilla: porEmpresaYTotalVacio(), descargado: 0 }; acum.set(i.productoId, p) }
    if (campo === 'cargado' || campo === 'descargado') p[campo] += i.cantidad
    else { const c = p[campo]; c[empresa ?? 'redonhielo'] += i.cantidad; c.total += i.cantidad }
  }
}
/** Más cargado primero; a igual carga, más vendido; después por nombre. */
const productosOrdenados = (m: Map<string, ProductoLive>): ProductoLive[] =>
  [...m.values()].sort((a, b) => (b.cargado - a.cargado) || ((b.vendidoCalle.total + b.vendidoVentanilla.total) - (a.vendidoCalle.total + a.vendidoVentanilla.total)) || a.nombre.localeCompare(b.nombre, 'es'))
/** Lo que salió y no volvió ni se vendió: sigue en el camión (o falta, si el camión ya se contó). */
export const sinDevolver = (p: Pick<ProductoLive, 'cargado' | 'vendidoCalle' | 'descargado'>): number => p.cargado - p.vendidoCalle.total - p.descargado

export function resumenLive(d: {
  ventasCamion: VentaCamion[]
  ventasVentanilla: VentaVentanilla[]
  cobranzas: Cobranza[]
  remitos: RemitoCarga[]
  liquidaciones: Liquidacion[]
  rendiciones: Rendicion[]
  /** Descargas contadas por muelle (Ventas en vivo: el camión ya se contó). Opcional para las pantallas viejas. */
  descargas?: DescargaCamion[]
  /** Turnos de caja del día (Tesorería en vivo: caja abierta / cerrada). */
  sesiones?: CajaSesion[]
  /** Sobres del día (Tesorería en vivo: en camino / recibido). */
  sobres?: Sobre[]
}): ResumenLive {
  // Recibos anulados con autorización (2026-09-15): fuera de calle, ventanilla y supervisores.
  d = { ...d, cobranzas: cobranzasVigentes(d.cobranzas) }
  const descargas = descargasVigentes(d.descargas ?? [])
  // ── Calle: por identidad del depósito (uid del chofer, o 'dep:<código>').
  const calle = new Map<string, FilaCalle>()
  const productosPorChofer = new Map<string, Map<string, ProductoLive>>()
  const productosDe = (id: string): Map<string, ProductoLive> => { let m = productosPorChofer.get(id); if (!m) { m = new Map(); productosPorChofer.set(id, m) } return m }
  const fila = (id: string, nombre: string, deposito?: string): FilaCalle => {
    let f = calle.get(id)
    if (!f) { f = { choferId: id, nombre, deposito, remitos: 0, cargaBultos: 0, contado: plataVacia(), promo: plataVacia(), bultosVendidos: 0, productos: [], cobranzas: cobVacia(), porEmpresa: porEmpresaVacio(), volvio: false, descargas: 0, bultosDescargados: 0, liquidacion: null, estado: 'sin_carga' }; calle.set(id, f) }
    if (!f.nombre && nombre) f.nombre = nombre
    if (!f.deposito && deposito) f.deposito = deposito
    return f
  }
  for (const r of d.remitos) {
    const f = fila(r.choferId, r.choferNombre, r.depositoTango)
    f.remitos++
    f.cargaBultos += cantidadDe(r.items)
    sumarProductos(productosDe(r.choferId), r.items, 'cargado')
    if (r.regreso) f.volvio = true
  }
  for (const v of d.ventasCamion) {
    if (v.anulacion?.estado === 'anulada') continue   // factura del camión anulada con NC (2026-09-11)
    const f = fila(v.choferId, v.choferNombre, v.depositoTango)
    sumarVenta(v.canal === 'promo' ? f.promo : f.contado, v)
    sumarVentaEmpresa(f.porEmpresa, v)
    f.bultosVendidos += cantidadDe(v.items)
    sumarProductos(productosDe(v.choferId), v.items, 'vendidoCalle', empresaDeVenta(v))
  }
  for (const c of d.cobranzas) {
    if (c.origen !== 'cobrador') continue
    const f = fila(c.registradoPor.uid, c.registradoPor.nombre, c.depositoTango)
    sumarCobranza(f.cobranzas, c)
    sumarCobranzaEmpresa(f.porEmpresa, c)
  }
  for (const x of descargas) {
    const f = fila(x.choferId, x.choferNombre, x.depositoTango)
    f.descargas++
    f.bultosDescargados += cantidadDe(x.items)
    sumarProductos(productosDe(x.choferId), x.items, 'descargado')
  }
  // Una liquidación es de un chofer (con remito o ventas) o de un supervisor (solo cobranzas): va a la fila que corresponda.
  const supUids = new Set(d.cobranzas.filter((c) => c.origen === 'supervisor').map((c) => c.registradoPor.uid))
  for (const l of d.liquidaciones) if (calle.has(l.choferId) || !supUids.has(l.choferId)) fila(l.choferId, l.choferNombre, l.depositoTango).liquidacion = l
  for (const f of calle.values()) {
    f.productos = productosOrdenados(productosDe(f.choferId))
    f.estado = f.liquidacion ? 'liquidado'
      : f.descargas > 0 ? 'descargado'
      : f.volvio ? 'volvio'
      : (f.contado.cantidad + f.promo.cantidad + f.cobranzas.cantidad > 0) ? 'vendiendo'
      : f.remitos > 0 ? 'cargado' : 'sin_carga'
  }

  // ── Ventanilla: por planta y cajero.
  const ventanilla: Record<PlantaId, Map<string, FilaVentanilla>> = { torcuato: new Map(), merlo: new Map() }
  const bultosPorCaja = new Map<string, Map<string, Bulto>>()
  const filaV = (planta: PlantaId, id: string, nombre: string): FilaVentanilla => {
    const m = ventanilla[planta] ?? (ventanilla[planta] = new Map())
    let f = m.get(id)
    if (!f) { f = { cajaId: id, nombre, contado: plataVacia(), promo: plataVacia(), bultos: [], turnos: turnosVacios(), cobranzas: cobVacia(), porEmpresa: porEmpresaVacio(), rendicion: null, sesion: null, sobre: null, estado: 'sin_turno', ventas: [], recibos: [] }; m.set(id, f) }
    return f
  }
  for (const v of d.ventasVentanilla) {
    const f = filaV(v.plantaId, v.cajaId, v.cajaNombre)
    f.ventas.push(v)
    if (v.anulacion?.estado === 'anulada') continue   // factura anulada con NC (2026-09-09): no cuenta
    sumarVenta(v.canal === 'promo' ? f.promo : f.contado, v)
    sumarVentaEmpresa(f.porEmpresa, v)
    f.turnos.vendidos++
    if (v.estado === 'entregado') f.turnos.entregados++; else f.turnos.enCola++
    const acum = bultosPorCaja.get(`${v.plantaId}|${v.cajaId}`) ?? new Map<string, Bulto>()
    bultosDe(v.items, acum)
    bultosPorCaja.set(`${v.plantaId}|${v.cajaId}`, acum)
  }
  for (const c of d.cobranzas) {
    if (c.origen !== 'caja' || !c.plantaId) continue
    const f = filaV(c.plantaId, c.registradoPor.uid, c.registradoPor.nombre)
    f.recibos.push(c)
    sumarCobranza(f.cobranzas, c)
    sumarCobranzaEmpresa(f.porEmpresa, c)
  }
  for (const r of d.rendiciones) if (r.tipo === 'mostrador') filaV(r.plantaId, r.sujetoId, r.sujetoNombre).rendicion = r
  // Un cajero con turno abierto y sin ventas todavía también es una fila: tesorería tiene que verlo.
  for (const s of d.sesiones ?? []) {
    const f = filaV(s.plantaId, s.cajero.uid, s.cajero.nombre)
    if (!f.sesion || s.numero > f.sesion.numero) f.sesion = s
  }
  for (const s of d.sobres ?? []) {
    if (s.tipo !== 'ventanilla') continue
    const f = filaV(s.plantaId, s.rindio.uid, s.rindio.nombre)
    if (!f.sobre || s.numero > f.sobre.numero) f.sobre = s
  }
  const porFecha = (a: { fecha: { toMillis(): number } }, b: { fecha: { toMillis(): number } }) => a.fecha.toMillis() - b.fecha.toMillis()
  for (const planta of Object.keys(ventanilla) as PlantaId[]) {
    for (const f of ventanilla[planta].values()) {
      f.ventas.sort(porFecha)
      f.recibos.sort(porFecha)
      f.bultos = [...(bultosPorCaja.get(`${planta}|${f.cajaId}`)?.values() ?? [])].sort((a, b) => b.cantidad - a.cantidad)
      f.estado = estadoCaja(f)
    }
  }

  // ── Supervisores.
  const sup = new Map<string, FilaSupervisor>()
  for (const c of d.cobranzas) {
    if (c.origen !== 'supervisor') continue
    let f = sup.get(c.registradoPor.uid)
    if (!f) { f = { uid: c.registradoPor.uid, nombre: c.registradoPor.nombre, cobranzas: cobVacia(), porEmpresa: porEmpresaVacio(), liquidacion: null }; sup.set(c.registradoPor.uid, f) }
    sumarCobranza(f.cobranzas, c)
    sumarCobranzaEmpresa(f.porEmpresa, c)
  }
  for (const l of d.liquidaciones) { const f = sup.get(l.choferId); if (f && !calle.has(l.choferId)) f.liquidacion = l }

  // ── Totales.
  const t: ResumenLive['totales'] = {
    ventasCalle: { contado: plataVacia(), promo: plataVacia() },
    ventasVentanilla: { contado: plataVacia(), promo: plataVacia() },
    cobranzas: { calle: cobVacia(), ventanilla: cobVacia(), supervisores: cobVacia() },
    efectivoDelDia: 0,
    porEmpresa: porEmpresaVacio(),
    bultos: { cargadosCalle: 0, vendidosCalle: 0, descargadosCalle: 0, vendidosVentanilla: 0 },
    productos: [],
    turnos: turnosVacios(),
  }
  const productosDia = new Map<string, ProductoLive>()
  for (const r of d.remitos) sumarProductos(productosDia, r.items, 'cargado')
  for (const v of d.ventasCamion) if (v.anulacion?.estado !== 'anulada') sumarProductos(productosDia, v.items, 'vendidoCalle', empresaDeVenta(v))
  for (const v of d.ventasVentanilla) if (v.anulacion?.estado !== 'anulada') sumarProductos(productosDia, v.items, 'vendidoVentanilla', empresaDeVenta(v))
  for (const x of descargas) sumarProductos(productosDia, x.items, 'descargado')
  t.productos = productosOrdenados(productosDia)
  for (const v of d.ventasCamion) if (v.anulacion?.estado !== 'anulada') sumarVenta(v.canal === 'promo' ? t.ventasCalle.promo : t.ventasCalle.contado, v)
  for (const v of d.ventasVentanilla) if (v.anulacion?.estado !== 'anulada') sumarVenta(v.canal === 'promo' ? t.ventasVentanilla.promo : t.ventasVentanilla.contado, v)
  for (const c of d.cobranzas) sumarCobranza(c.origen === 'caja' ? t.cobranzas.ventanilla : c.origen === 'supervisor' ? t.cobranzas.supervisores : t.cobranzas.calle, c)
  t.efectivoDelDia = t.ventasCalle.contado.efectivo + t.ventasCalle.promo.efectivo + t.ventasVentanilla.contado.efectivo + t.ventasVentanilla.promo.efectivo
    + t.cobranzas.calle.efectivo + t.cobranzas.ventanilla.efectivo + t.cobranzas.supervisores.efectivo
  for (const f of calle.values()) {
    t.porEmpresa = sumarPorEmpresa(t.porEmpresa, f.porEmpresa)
    t.bultos.cargadosCalle += f.cargaBultos; t.bultos.vendidosCalle += f.bultosVendidos; t.bultos.descargadosCalle += f.bultosDescargados
  }
  for (const planta of Object.keys(ventanilla) as PlantaId[]) {
    for (const f of ventanilla[planta].values()) {
      t.porEmpresa = sumarPorEmpresa(t.porEmpresa, f.porEmpresa)
      t.bultos.vendidosVentanilla += cantidadDe(f.bultos)
      t.turnos.vendidos += f.turnos.vendidos; t.turnos.entregados += f.turnos.entregados; t.turnos.enCola += f.turnos.enCola
    }
  }
  for (const f of sup.values()) t.porEmpresa = sumarPorEmpresa(t.porEmpresa, f.porEmpresa)

  const porNombre = <T extends { nombre: string }>(a: T, b: T) => a.nombre.localeCompare(b.nombre, 'es')
  return {
    totales: t,
    calle: [...calle.values()].sort(porNombre),
    ventanilla: { torcuato: [...ventanilla.torcuato.values()].sort(porNombre), merlo: [...ventanilla.merlo.values()].sort(porNombre) },
    supervisores: [...sup.values()].sort(porNombre),
  }
}

/**
 * Estado del cajero: con el turno de caja (2026-09-14) manda el sobre y la
 * sesión; sin ninguno de los dos vale el cierre viejo (`rendiciones` mostrador).
 */
export function estadoCaja(f: Pick<FilaVentanilla, 'sesion' | 'sobre' | 'rendicion'>): EstadoCaja {
  if (f.sesion?.estado === 'abierta') return 'abierta'
  if (f.sobre) return f.sobre.estado === 'recibida' ? 'recibida' : 'en_camino'
  // Turno cerrado sin sobre a la vista: el sobre existe (salen juntos), todavía no llegó el stream.
  if (f.sesion) return 'en_camino'
  if (f.rendicion) return f.rendicion.validacion ? 'validada' : 'cerrada'
  return 'sin_turno'
}
