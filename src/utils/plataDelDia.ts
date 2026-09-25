import type { CajaSesion, EmpresaTango, Liquidacion, Sobre } from '@/types'
import type { FilaCalle, FilaSupervisor, FilaVentanilla, PorEmpresaYTotal } from './tesoreriaLive'
import { porEmpresaYTotalVacio } from './tesoreriaLive'
import { esRecibido } from './valoresEnPapel'
import { anticiposDelTurno, claveDeCheque, claveDeRetencion, empresaDeAnticipo, esAnticipo, sistemaVentanilla } from './sobres'
import { delTurno, liquidacionesPorRendir } from './turnoCaja'

// Plata del día (2026-09-23, rediseño caja ↔ tesorería aprobado por Ariel):
// SOLO rendiciones de fondos, nada de mercadería ni de ventas. La plata avanza
// de izquierda a derecha, tres casilleros por caja:
//
//   Rendido por choferes a caja › Cerrado por caja (sobres y anticipos) › Recibido por tesorería
//
// más una fila de "pendiente de rendir" (choferes y cobradores con plata en la
// calle sin liquidar) y los totales. Cada casillero trae el efectivo partido en
// Redonhielo y Rolito y los cheques aparte. Puro: quien lo usa trae los docs
// del día (turnos, sobres, liquidaciones y el resumen en vivo de la calle).

export interface Casillero {
  efectivo:    PorEmpresaYTotal
  cheques:     { cantidad: number; total: number }
  retenciones: { cantidad: number; total: number }
}

export interface LiquidacionRendida {
  id:       string
  codigo:   string
  nombre:   string
  hora:     Date | null
  efectivo: PorEmpresaYTotal
  cheques:  { cantidad: number; total: number }
}

export interface FilaPlataCaja {
  uid:    string
  nombre: string
  /** Los turnos del día del cajero, en orden. */
  turnos: { numero: number; desde: Date; hasta: Date | null }[]
  rendidoACaja:  Casillero & { liquidaciones: LiquidacionRendida[] }
  cerradoPorCaja: Casillero & { sobres: Sobre[]; anticipos: Sobre[]; abierto: boolean }
  recibidoPorTesoreria: Casillero & { sinContar: Sobre[]; contados: Sobre[] }
}

export interface PendienteDeRendir {
  id:      string
  nombre:  string
  /** "viaje RC-DT-000097" o "cobranzas de calle". */
  detalle: string
  efectivo: PorEmpresaYTotal
  cheques:  { cantidad: number; total: number }
  tipo:     'chofer' | 'supervisor'
}

export interface PlataDelDia {
  cajas:      FilaPlataCaja[]
  pendientes: PendienteDeRendir[]
  totales:    { rendidoACaja: Casillero; cerradoPorCaja: Casillero; recibidoPorTesoreria: Casillero }
}

const casilleroVacio = (): Casillero => ({ efectivo: porEmpresaYTotalVacio(), cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 } })
const r2 = (n: number): number => Math.round(n * 100) / 100
const sumar = (a: PorEmpresaYTotal, e: EmpresaTango, n: number): void => { a[e] = r2(a[e] + n); a.total = r2(a.total + n) }
const sumarCasillero = (acum: Casillero, c: Casillero): void => {
  sumar(acum.efectivo, 'redonhielo', c.efectivo.redonhielo); sumar(acum.efectivo, 'rolito', c.efectivo.rolito)
  acum.cheques.cantidad += c.cheques.cantidad; acum.cheques.total = r2(acum.cheques.total + c.cheques.total)
  acum.retenciones.cantidad += c.retenciones.cantidad; acum.retenciones.total = r2(acum.retenciones.total + c.retenciones.total)
}

/** Efectivo por empresa que caja CONTÓ de una liquidación; una vieja sin conteo va entera a Redonhielo. */
export function efectivoDeLiquidacion(l: Liquidacion): PorEmpresaYTotal {
  const out = porEmpresaYTotalVacio()
  if (l.conteoBilletes) { sumar(out, 'redonhielo', l.conteoBilletes.redonhielo.total); sumar(out, 'rolito', l.conteoBilletes.rolito.total) }
  else sumar(out, 'redonhielo', l.efectivoRecibido)
  return out
}

/** Efectivo por empresa de un sobre (lo que dice el sistema, o el fajo contado si tesorería ya lo recibió). */
export function efectivoDeSobre(s: Sobre, contado = false): PorEmpresaYTotal {
  const out = porEmpresaYTotalVacio()
  if (esAnticipo(s)) { sumar(out, empresaDeAnticipo(s), contado ? (s.recepcion?.efectivoContado ?? s.sistema.efectivo) : s.sistema.efectivo); return out }
  if (contado && s.recepcion) {
    const f = s.recepcion.fajos
    if (f) { sumar(out, 'redonhielo', f.redonhielo); sumar(out, 'rolito', f.rolito) }
    else {
      // Sin fajos contados: Rolito exacto, Redonhielo se lleva el resto (misma regla que `fajosDe`).
      const rolito = Math.min(Math.max(s.recepcion.efectivoContado, 0), s.sistema.porEmpresa?.rolito.efectivo ?? 0)
      sumar(out, 'rolito', rolito); sumar(out, 'redonhielo', s.recepcion.efectivoContado - rolito)
    }
    return out
  }
  const pe = s.sistema.porEmpresa
  if (pe) { sumar(out, 'redonhielo', pe.redonhielo.efectivo); sumar(out, 'rolito', pe.rolito.efectivo) }
  else sumar(out, 'redonhielo', s.sistema.efectivo)
  return out
}

const valoresDeSobre = (s: Sobre, soloRecibidos: boolean): Pick<Casillero, 'cheques' | 'retenciones'> => {
  const okC = soloRecibidos ? new Set((s.recepcion?.cheques ?? []).filter((v) => v.recibido).map((v) => v.clave)) : null
  const okR = soloRecibidos ? new Set((s.recepcion?.retenciones ?? []).filter((v) => v.recibido).map((v) => v.clave)) : null
  const ch = s.sistema.cheques.filter((c) => !okC || okC.has(claveDeCheque(c)))
  const re = s.sistema.retenciones.filter((r) => !okR || okR.has(claveDeRetencion(r)))
  return { cheques: { cantidad: ch.length, total: r2(ch.reduce((a, c) => a + c.importe, 0)) }, retenciones: { cantidad: re.length, total: r2(re.reduce((a, r) => a + r.importe, 0)) } }
}

export function plataDelDia(args: {
  sesiones: CajaSesion[]
  sobres: Sobre[]
  /** Liquidaciones cerradas por caja (choferes, cobradores, supervisores) que se ven en el día. */
  liquidaciones: Liquidacion[]
  calle: FilaCalle[]
  supervisores: FilaSupervisor[]
}): PlataDelDia {
  const { sesiones, sobres, liquidaciones, calle, supervisores } = args
  // Una fila por cajero que abrió turno hoy o rindió algo hoy.
  const cajeros = new Map<string, string>()
  for (const s of sesiones) cajeros.set(s.cajero.uid, s.cajero.nombre)
  for (const s of sobres) if (!cajeros.has(s.rindio.uid)) cajeros.set(s.rindio.uid, s.rindio.nombre)
  for (const l of liquidaciones) if (l.cerradaPor?.uid && !cajeros.has(l.cerradaPor.uid)) cajeros.set(l.cerradaPor.uid, l.cerradaPor.nombre)

  const totales = { rendidoACaja: casilleroVacio(), cerradoPorCaja: casilleroVacio(), recibidoPorTesoreria: casilleroVacio() }
  const cajas: FilaPlataCaja[] = []
  for (const [uid, nombre] of cajeros) {
    const turnos = sesiones.filter((s) => s.cajero.uid === uid).sort((a, b) => a.numero - b.numero)
      .map((s) => ({ numero: s.numero, desde: s.abiertaEn.toDate(), hasta: s.cerradaEn?.toDate() ?? null }))
    const propios = sobres.filter((s) => s.rindio.uid === uid)
    const sobresV = propios.filter((s) => s.tipo === 'ventanilla').sort((a, b) => a.cerradaEn.toMillis() - b.cerradaEn.toMillis())
    const anticipos = propios.filter(esAnticipo).sort((a, b) => a.cerradaEn.toMillis() - b.cerradaEn.toMillis())

    // 1. Rendido por choferes y cobradores a esta caja.
    const rendido: FilaPlataCaja['rendidoACaja'] = { ...casilleroVacio(), liquidaciones: [] }
    for (const l of liquidaciones.filter((x) => x.cerradaPor?.uid === uid).sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))) {
      const ef = efectivoDeLiquidacion(l)
      const ch = (l.cheques ?? []).filter(esRecibido)
      const re = (l.retenciones ?? []).filter(esRecibido)
      const cheques = { cantidad: ch.length, total: r2(ch.reduce((a, c) => a + c.importe, 0)) }
      rendido.liquidaciones.push({ id: l.id, codigo: l.codigo ?? l.id, nombre: l.choferNombre, hora: l.createdAt?.toDate() ?? null, efectivo: ef, cheques })
      sumarCasillero(rendido, { efectivo: ef, cheques, retenciones: { cantidad: re.length, total: r2(re.reduce((a, x) => a + x.importe, 0)) } })
    }

    // 2. Cerrado por caja: los sobres del día (sistema) más los anticipos.
    const cerrado: FilaPlataCaja['cerradoPorCaja'] = { ...casilleroVacio(), sobres: sobresV, anticipos, abierto: turnos.some((t) => !t.hasta) }
    for (const s of [...sobresV, ...anticipos]) sumarCasillero(cerrado, { efectivo: efectivoDeSobre(s), ...valoresDeSobre(s, false) })

    // 3. Recibido por tesorería: lo contado.
    const recibido: FilaPlataCaja['recibidoPorTesoreria'] = { ...casilleroVacio(), sinContar: [], contados: [] }
    for (const s of [...sobresV, ...anticipos]) {
      if (s.recepcion) { recibido.contados.push(s); sumarCasillero(recibido, { efectivo: efectivoDeSobre(s, true), ...valoresDeSobre(s, true) }) }
      else recibido.sinContar.push(s)
    }

    cajas.push({ uid, nombre, turnos, rendidoACaja: rendido, cerradoPorCaja: cerrado, recibidoPorTesoreria: recibido })
    sumarCasillero(totales.rendidoACaja, rendido); sumarCasillero(totales.cerradoPorCaja, cerrado); sumarCasillero(totales.recibidoPorTesoreria, recibido)
  }
  cajas.sort((a, b) => (a.turnos[0]?.desde.getTime() ?? 0) - (b.turnos[0]?.desde.getTime() ?? 0) || a.nombre.localeCompare(b.nombre, 'es'))

  // Pendiente de rendir: plata en la calle sin liquidación.
  const pendientes: PendienteDeRendir[] = []
  const conPlata = (pe: FilaCalle['porEmpresa']) => pe.redonhielo.efectivo + pe.rolito.efectivo + pe.redonhielo.cheques.total + pe.rolito.cheques.total > 0
  for (const f of calle) {
    if (f.liquidacion || !conPlata(f.porEmpresa)) continue
    const efectivo = porEmpresaYTotalVacio(); sumar(efectivo, 'redonhielo', f.porEmpresa.redonhielo.efectivo); sumar(efectivo, 'rolito', f.porEmpresa.rolito.efectivo)
    pendientes.push({ id: f.choferId, nombre: f.nombre || f.choferId, detalle: f.deposito ? `depósito ${f.deposito}` : 'viaje sin liquidar', efectivo,
      cheques: { cantidad: f.porEmpresa.redonhielo.cheques.cantidad + f.porEmpresa.rolito.cheques.cantidad, total: r2(f.porEmpresa.redonhielo.cheques.total + f.porEmpresa.rolito.cheques.total) }, tipo: 'chofer' })
  }
  for (const s of supervisores) {
    if (s.liquidacion || !conPlata(s.porEmpresa)) continue
    const efectivo = porEmpresaYTotalVacio(); sumar(efectivo, 'redonhielo', s.porEmpresa.redonhielo.efectivo); sumar(efectivo, 'rolito', s.porEmpresa.rolito.efectivo)
    pendientes.push({ id: s.uid, nombre: s.nombre, detalle: 'cobranzas de calle', efectivo,
      cheques: { cantidad: s.porEmpresa.redonhielo.cheques.cantidad + s.porEmpresa.rolito.cheques.cantidad, total: r2(s.porEmpresa.redonhielo.cheques.total + s.porEmpresa.rolito.cheques.total) }, tipo: 'supervisor' })
  }
  pendientes.sort((a, b) => b.efectivo.total - a.efectivo.total)

  return { cajas, pendientes, totales }
}

// ── ¿Dónde está la plata? (2026-09-24) ───────────────────────────────────────
//
// Ariel miró "Plata del día" (tres columnas por caja, Efectivo y Cheques en
// cada una, partido por empresa, códigos de sobre) y dijo que no se entendía
// para qué era. Lo que tesorería necesita es UNA pregunta: dónde está la plata
// hoy. Cuatro lugares, en el orden en que la plata avanza, con quién la tiene:
//
//   En la calle › En caja › Entregada, sin contar › Contada por tesorería
//
// Va como tira arriba de Recepción, que abajo tiene las liquidaciones una por
// una. Puro: quien lo usa trae los docs del día y los sobres a la vista.

export interface PersonaConPlata { id: string; nombre: string; detalle: string; efectivo: number }
export interface LugarPlata {
  efectivo: number
  cheques:  { cantidad: number; total: number }
  personas: PersonaConPlata[]
}
export interface DondeEstaLaPlata {
  /** Choferes y cobradores con plata sin liquidar. */
  calle:     LugarPlata
  /** Turnos abiertos (lo que la ventanilla junta ahora) más liquidaciones de caja cerradas y todavía no entregadas en mano. */
  caja:      LugarPlata
  /** Entregadas en mano a tesorería (con firma) y todavía sin contar. */
  entregada: LugarPlata
  /** Contadas y validadas, con la diferencia acumulada contra lo que decía el sistema. */
  contada:   LugarPlata & { diferencia: number }
}

const lugarVacio = (): LugarPlata => ({ efectivo: 0, cheques: { cantidad: 0, total: 0 }, personas: [] })
const sumarLugar = (l: LugarPlata, p: PersonaConPlata, cheques: { cantidad: number; total: number }): void => {
  l.efectivo = r2(l.efectivo + p.efectivo)
  l.cheques.cantidad += cheques.cantidad; l.cheques.total = r2(l.cheques.total + cheques.total)
  l.personas.push(p)
}
const totalCheques = (xs: { importe: number }[]) => ({ cantidad: xs.length, total: r2(xs.reduce((a, c) => a + c.importe, 0)) })

/** Lo que un turno ABIERTO tiene ahora mismo: la misma cuenta que ve el cajero en su pantalla (`sistemaVentanilla`). */
export function plataDelTurnoAbierto(sesion: CajaSesion, fila: Pick<FilaVentanilla, 'ventas' | 'recibos'> | undefined, liquidaciones: Liquidacion[], sobres: Sobre[]): { efectivo: number; cheques: { cantidad: number; total: number } } {
  const uid = sesion.cajero.uid
  const sobresDelCajero = sobres.filter((s) => s.rindio.uid === uid && s.tipo === 'ventanilla')
  const sistema = sistemaVentanilla({
    fondoInicial: sesion.fondoInicial,
    ventas: delTurno(fila?.ventas ?? [], sesion),
    cobranzas: delTurno(fila?.recibos ?? [], sesion),
    liquidacionesRecibidas: liquidacionesPorRendir(liquidaciones, uid, sobresDelCajero),
    sobresRecibidos: [],
    anticipos: anticiposDelTurno(sobres, sesion.id),
  })
  return { efectivo: r2(sistema.efectivo), cheques: totalCheques(sistema.cheques) }
}

export function dondeEstaLaPlata(args: {
  sesiones: CajaSesion[]
  sobres: Sobre[]
  liquidaciones: Liquidacion[]
  calle: FilaCalle[]
  supervisores: FilaSupervisor[]
  ventanilla: FilaVentanilla[]
  /** Los sobres que Recepción tiene a la vista (de cualquier día). */
  porRecibir: Sobre[]
  aContar: Sobre[]
  contados: Sobre[]
}): DondeEstaLaPlata {
  const { sesiones, sobres, liquidaciones, calle, supervisores, ventanilla, porRecibir, aContar, contados } = args
  const out: DondeEstaLaPlata = { calle: lugarVacio(), caja: lugarVacio(), entregada: lugarVacio(), contada: { ...lugarVacio(), diferencia: 0 } }

  // 1. En la calle: los pendientes de rendir de Plata del día.
  for (const p of plataDelDia({ sesiones, sobres, liquidaciones, calle, supervisores }).pendientes) {
    sumarLugar(out.calle, { id: p.id, nombre: p.nombre, detalle: p.detalle, efectivo: p.efectivo.total }, p.cheques)
  }

  // 2. En caja: turnos abiertos (lo que junta la ventanilla ahora) + liquidaciones cerradas sin entregar.
  for (const s of sesiones.filter((x) => x.estado === 'abierta').sort((a, b) => a.abiertaEn.toMillis() - b.abiertaEn.toMillis())) {
    const fila = ventanilla.find((f) => f.cajaId === s.cajero.uid)
    const t = plataDelTurnoAbierto(s, fila, liquidaciones, sobres)
    sumarLugar(out.caja, { id: s.id, nombre: s.cajero.nombre, detalle: `turno ${s.numero} abierto`, efectivo: t.efectivo }, t.cheques)
  }
  for (const s of porRecibir) {
    sumarLugar(out.caja, { id: s.id, nombre: s.rindio.nombre, detalle: `${s.codigo} cerrada, sin entregar`, efectivo: s.sistema.efectivo }, totalCheques(s.sistema.cheques))
  }

  // 3. Entregada en mano, sin contar.
  for (const s of aContar) {
    sumarLugar(out.entregada, { id: s.id, nombre: s.rindio.nombre, detalle: `${esAnticipo(s) ? 'anticipo ' : ''}${s.codigo}`, efectivo: s.sistema.efectivo }, totalCheques(s.sistema.cheques))
  }

  // 4. Contada por tesorería: lo que contó, con la diferencia.
  for (const s of contados) {
    const r = s.recepcion
    if (!r) continue
    const okC = new Set(r.cheques.filter((v) => v.recibido).map((v) => v.clave))
    sumarLugar(out.contada, { id: s.id, nombre: s.rindio.nombre, detalle: `${esAnticipo(s) ? 'anticipo ' : ''}${s.codigo}${r.conformidad === 'conforme' ? '' : ' · con diferencia'}`, efectivo: r.efectivoContado }, totalCheques(s.sistema.cheques.filter((c) => okC.has(claveDeCheque(c)))))
    out.contada.diferencia = r2(out.contada.diferencia + (r.diferencia?.efectivo ?? 0))
  }
  return out
}
