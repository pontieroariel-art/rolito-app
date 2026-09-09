import type { Cobranza, Liquidacion, PlantaId, RemitoCarga, Rendicion, VentaCamion, VentaVentanilla } from '@/types'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from './medios'

// Cálculo PURO del tablero en vivo de tesorería (2026-09-09): con los docs de
// un día (ventas del camión, ventas de ventanilla de las dos plantas,
// cobranzas de todos los orígenes, remitos de carga, liquidaciones y cierres
// de caja) arma tres bloques — calle por chofer, ventanilla por cajero y
// supervisores — más los totales globales. Todo suma en la pantalla a medida
// que llegan los docs por onSnapshot.

export interface PlataVentas { cantidad: number; efectivo: number; transferencia: number; cuentaCorriente: number; total: number }
export interface PlataCobranzas { cantidad: number; efectivo: number; transferencia: number; cheques: { cantidad: number; total: number }; retenciones: { cantidad: number; total: number }; total: number }
export interface Bulto { productoId: string; nombre: string; cantidad: number }

export interface FilaCalle {
  choferId: string
  nombre: string
  deposito?: string
  remitos: number
  cargaBultos: number
  contado: PlataVentas
  promo: PlataVentas
  bultosVendidos: number
  cobranzas: PlataCobranzas
  liquidacion: Liquidacion | null
  estado: 'sin_carga' | 'cargado' | 'vendiendo' | 'liquidado'
}

export interface FilaVentanilla {
  cajaId: string
  nombre: string
  contado: PlataVentas
  promo: PlataVentas
  bultos: Bulto[]
  cobranzas: PlataCobranzas
  rendicion: Rendicion | null
  estado: 'abierta' | 'cerrada' | 'validada'
}

export interface FilaSupervisor {
  uid: string
  nombre: string
  cobranzas: PlataCobranzas
}

export interface ResumenLive {
  totales: {
    ventasCalle: { contado: PlataVentas; promo: PlataVentas }
    ventasVentanilla: { contado: PlataVentas; promo: PlataVentas }
    cobranzas: { calle: PlataCobranzas; ventanilla: PlataCobranzas; supervisores: PlataCobranzas }
    efectivoDelDia: number   // ventas efectivo + cobranzas efectivo, de todos
  }
  calle: FilaCalle[]
  ventanilla: Record<PlantaId, FilaVentanilla[]>
  supervisores: FilaSupervisor[]
}

const plataVacia = (): PlataVentas => ({ cantidad: 0, efectivo: 0, transferencia: 0, cuentaCorriente: 0, total: 0 })
const cobVacia = (): PlataCobranzas => ({ cantidad: 0, efectivo: 0, transferencia: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 }, total: 0 })

function sumarVenta(p: PlataVentas, v: { formaPago: string; total: number }): void {
  p.cantidad++
  if (v.formaPago === 'contado_efectivo') p.efectivo += v.total
  else if (v.formaPago === 'contado_transferencia') p.transferencia += v.total
  else p.cuentaCorriente += v.total
  p.total += v.total
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

const bultosDe = (items: { productoId: string; nombre: string; cantidad: number }[], acum: Map<string, Bulto>): void => {
  for (const i of items) {
    const b = acum.get(i.productoId) ?? { productoId: i.productoId, nombre: i.nombre, cantidad: 0 }
    b.cantidad += i.cantidad
    acum.set(i.productoId, b)
  }
}

export function resumenLive(d: {
  ventasCamion: VentaCamion[]
  ventasVentanilla: VentaVentanilla[]
  cobranzas: Cobranza[]
  remitos: RemitoCarga[]
  liquidaciones: Liquidacion[]
  rendiciones: Rendicion[]
}): ResumenLive {
  // ── Calle: por identidad del depósito (uid del chofer, o 'dep:<código>').
  const calle = new Map<string, FilaCalle>()
  const fila = (id: string, nombre: string, deposito?: string): FilaCalle => {
    let f = calle.get(id)
    if (!f) { f = { choferId: id, nombre, deposito, remitos: 0, cargaBultos: 0, contado: plataVacia(), promo: plataVacia(), bultosVendidos: 0, cobranzas: cobVacia(), liquidacion: null, estado: 'sin_carga' }; calle.set(id, f) }
    if (!f.nombre && nombre) f.nombre = nombre
    if (!f.deposito && deposito) f.deposito = deposito
    return f
  }
  for (const r of d.remitos) {
    const f = fila(r.choferId, r.choferNombre, r.depositoTango)
    f.remitos++
    f.cargaBultos += r.items.reduce((s, i) => s + i.cantidad, 0)
  }
  for (const v of d.ventasCamion) {
    const f = fila(v.choferId, v.choferNombre, v.depositoTango)
    sumarVenta(v.canal === 'promo' ? f.promo : f.contado, v)
    f.bultosVendidos += v.items.reduce((s, i) => s + i.cantidad, 0)
  }
  for (const c of d.cobranzas) if (c.origen === 'cobrador') sumarCobranza(fila(c.registradoPor.uid, c.registradoPor.nombre, c.depositoTango).cobranzas, c)
  for (const l of d.liquidaciones) fila(l.choferId, l.choferNombre, l.depositoTango).liquidacion = l
  for (const f of calle.values()) {
    f.estado = f.liquidacion ? 'liquidado' : (f.contado.cantidad + f.promo.cantidad + f.cobranzas.cantidad > 0) ? 'vendiendo' : f.remitos > 0 ? 'cargado' : 'sin_carga'
  }

  // ── Ventanilla: por planta y cajero.
  const ventanilla: Record<PlantaId, Map<string, FilaVentanilla>> = { torcuato: new Map(), merlo: new Map() }
  const bultosPorCaja = new Map<string, Map<string, Bulto>>()
  const filaV = (planta: PlantaId, id: string, nombre: string): FilaVentanilla => {
    const m = ventanilla[planta] ?? (ventanilla[planta] = new Map())
    let f = m.get(id)
    if (!f) { f = { cajaId: id, nombre, contado: plataVacia(), promo: plataVacia(), bultos: [], cobranzas: cobVacia(), rendicion: null, estado: 'abierta' }; m.set(id, f) }
    return f
  }
  for (const v of d.ventasVentanilla) {
    const f = filaV(v.plantaId, v.cajaId, v.cajaNombre)
    sumarVenta(v.canal === 'promo' ? f.promo : f.contado, v)
    const acum = bultosPorCaja.get(`${v.plantaId}|${v.cajaId}`) ?? new Map<string, Bulto>()
    bultosDe(v.items, acum)
    bultosPorCaja.set(`${v.plantaId}|${v.cajaId}`, acum)
  }
  for (const c of d.cobranzas) if (c.origen === 'caja' && c.plantaId) sumarCobranza(filaV(c.plantaId, c.registradoPor.uid, c.registradoPor.nombre).cobranzas, c)
  for (const r of d.rendiciones) if (r.tipo === 'mostrador') filaV(r.plantaId, r.sujetoId, r.sujetoNombre).rendicion = r
  for (const planta of Object.keys(ventanilla) as PlantaId[]) {
    for (const f of ventanilla[planta].values()) {
      f.bultos = [...(bultosPorCaja.get(`${planta}|${f.cajaId}`)?.values() ?? [])].sort((a, b) => b.cantidad - a.cantidad)
      f.estado = f.rendicion ? (f.rendicion.validacion ? 'validada' : 'cerrada') : 'abierta'
    }
  }

  // ── Supervisores.
  const sup = new Map<string, FilaSupervisor>()
  for (const c of d.cobranzas) {
    if (c.origen !== 'supervisor') continue
    let f = sup.get(c.registradoPor.uid)
    if (!f) { f = { uid: c.registradoPor.uid, nombre: c.registradoPor.nombre, cobranzas: cobVacia() }; sup.set(c.registradoPor.uid, f) }
    sumarCobranza(f.cobranzas, c)
  }

  // ── Totales.
  const t = {
    ventasCalle: { contado: plataVacia(), promo: plataVacia() },
    ventasVentanilla: { contado: plataVacia(), promo: plataVacia() },
    cobranzas: { calle: cobVacia(), ventanilla: cobVacia(), supervisores: cobVacia() },
    efectivoDelDia: 0,
  }
  for (const v of d.ventasCamion) sumarVenta(v.canal === 'promo' ? t.ventasCalle.promo : t.ventasCalle.contado, v)
  for (const v of d.ventasVentanilla) sumarVenta(v.canal === 'promo' ? t.ventasVentanilla.promo : t.ventasVentanilla.contado, v)
  for (const c of d.cobranzas) sumarCobranza(c.origen === 'caja' ? t.cobranzas.ventanilla : c.origen === 'supervisor' ? t.cobranzas.supervisores : t.cobranzas.calle, c)
  t.efectivoDelDia = t.ventasCalle.contado.efectivo + t.ventasCalle.promo.efectivo + t.ventasVentanilla.contado.efectivo + t.ventasVentanilla.promo.efectivo
    + t.cobranzas.calle.efectivo + t.cobranzas.ventanilla.efectivo + t.cobranzas.supervisores.efectivo

  const porNombre = <T extends { nombre: string }>(a: T, b: T) => a.nombre.localeCompare(b.nombre, 'es')
  return {
    totales: t,
    calle: [...calle.values()].sort(porNombre),
    ventanilla: { torcuato: [...ventanilla.torcuato.values()].sort(porNombre), merlo: [...ventanilla.merlo.values()].sort(porNombre) },
    supervisores: [...sup.values()].sort(porNombre),
  }
}
