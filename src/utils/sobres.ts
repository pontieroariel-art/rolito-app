import { cobranzasVigentes } from './anulacionCobranza'
// Rendición de fondos a tesorería (2026-09-14): lógica PURA del sobre.
//
// Un sobre es lo que alguien rinde: el sistema dice cuánto tiene que haber,
// quien rinde declara lo que tiene en mano SIN ver el sistema (arqueo ciego),
// y quien recibe cuenta y firma (doble conformidad). Acá viven los cálculos
// compartidos por las tres puntas (quien rinde, quien recibe, el tablero de
// custodia), sin React ni Firebase, con tests.
import type {
  CajaSesion, ChequeRendido, Cobranza, Conformidad, DiferenciaSobre, Liquidacion, PlantaId, RetencionRendida,
  Sobre, SobreDeclarado, SobreRecepcion, SobreSistema, TipoSobre, ValorDeclarado, ValorRecibido, VentaVentanilla,
} from '@/types'
import { PLANTA_INFO } from './constants'
import { chequesDe, retencionesDe } from './medios'
import { calcularMostrador } from './rendicionMostrador'
import { claveCheque, claveRetencion, esRecibido } from './valoresEnPapel'

// ── Ids y códigos ────────────────────────────────────────────────────────────

export const sesionId = (fecha: string, uid: string, n: number): string => `${fecha}_${uid}_${n}`

/** Ventanilla puede tener más de un sobre por día (uno por turno); cobrador y chofer, uno. */
export function sobreId(tipo: TipoSobre, fecha: string, sujetoId: string, n = 1): string {
  return tipo === 'ventanilla' ? `${fecha}_${sujetoId}_${n}` : `${fecha}_${sujetoId}`
}

/** RV = ventanilla → tesorería (por planta) · RC = cobrador → caja (global) · RQ = chofer → caja (por depósito). */
export function codigoSobre(tipo: TipoSobre, numero: number, serie: { plantaId?: PlantaId; deposito?: string }): string {
  const n = String(numero).padStart(6, '0')
  if (tipo === 'ventanilla') return `RV-${PLANTA_INFO[serie.plantaId ?? 'torcuato'].prefijoCodigo}-${n}`
  if (tipo === 'chofer') return `RQ-${serie.deposito ?? 'SD'}-${n}`
  return `RC-${n}`
}

/** Nombre del contador en `config/`. */
export function contadorDeSobre(tipo: TipoSobre, serie: { plantaId?: PlantaId; deposito?: string }): string {
  if (tipo === 'ventanilla') return `sobreVentanillaCounter_${serie.plantaId ?? 'torcuato'}`
  if (tipo === 'chofer') return `sobreChoferCounter_${serie.deposito ?? 'SD'}`
  return 'sobreCobradorCounter'
}

// ── Sistema (teórico) ────────────────────────────────────────────────────────

export const claveDeCheque    = (c: Pick<ChequeRendido, 'cobranzaId' | 'numero'>): string => claveCheque(c)
export const claveDeRetencion = (r: Pick<RetencionRendida, 'cobranzaId' | 'nroCertificado'>): string => claveRetencion(r)

export interface FuentesVentanilla {
  fondoInicial: number
  ventas: VentaVentanilla[]
  cobranzas: Cobranza[]
  /** Liquidaciones de choferes que este turno cerró (Fase 1: siguen en `liquidaciones`). */
  liquidacionesRecibidas: Liquidacion[]
  /** Sobres de cobradores que este turno recibió (Fase 2). */
  sobresRecibidos: Sobre[]
}

/**
 * Lo que tiene que haber en el sobre de la ventanilla: el fondo con el que
 * abrió + ventas en efectivo + cobranzas de mostrador en efectivo + el
 * efectivo que CONTÓ al recibir a choferes y cobradores. Los valores en papel
 * son los propios más los que recibió de ellos (solo los tildados como
 * recibidos: un cheque que el chofer no entregó no puede aparecer acá).
 */
export function sistemaVentanilla(f: FuentesVentanilla): SobreSistema {
  const m = calcularMostrador(f.ventas, f.cobranzas, f.liquidacionesRecibidas)
  const recibidoDeSobres = f.sobresRecibidos.reduce((s, x) => s + (x.recepcion?.efectivoContado ?? 0), 0)
  const propios      = valoresRendidosDe(f.cobranzas)
  const chequesDeLiq = f.liquidacionesRecibidas.flatMap((l) => (l.cheques ?? []).filter(esRecibido))
  const retDeLiq     = f.liquidacionesRecibidas.flatMap((l) => (l.retenciones ?? []).filter(esRecibido))
  const chequesDeSob = f.sobresRecibidos.flatMap((s) => valoresRecibidosDe(s).cheques)
  const retDeSob     = f.sobresRecibidos.flatMap((s) => valoresRecibidosDe(s).retenciones)
  const cheques = [...propios.cheques, ...chequesDeLiq, ...chequesDeSob]
  const retenciones = [...propios.retenciones, ...retDeLiq, ...retDeSob]
  return {
    efectivo: f.fondoInicial + m.ventas.contadoEfectivo + m.ventas.promoEfectivo + m.cobranzas.efectivo + m.recibido.efectivo + recibidoDeSobres,
    cheques,
    retenciones,
    transferencias: { cantidad: 0, total: m.ventas.contadoTransferencia + m.ventas.promoTransferencia + m.cobranzas.transferencia },
    detalle: {
      fondoInicial:            f.fondoInicial,
      ventasEfectivo:          m.ventas.contadoEfectivo + m.ventas.promoEfectivo,
      cobranzasEfectivo:       m.cobranzas.efectivo,
      recibidoDeLiquidaciones: m.recibido.efectivo,
      recibidoDeSobres,
    },
    origenIds: {
      ventasIds:          f.ventas.map((v) => v.id),
      cobranzasIds:       f.cobranzas.map((c) => c.id),
      liquidacionesIds:   f.liquidacionesRecibidas.map((l) => l.id),
      sobresRecibidosIds: f.sobresRecibidos.map((s) => s.id),
    },
  }
}

/** Cheques y retenciones de las cobranzas propias, con la referencia al recibo y al cliente (ChequeRendido / RetencionRendida). */
export function valoresRendidosDe(cobranzas: Cobranza[]): { cheques: ChequeRendido[]; retenciones: RetencionRendida[] } {
  cobranzas = cobranzasVigentes(cobranzas)   // recibos anulados (2026-09-15): sus valores no van al sobre
  const ref = (c: Cobranza) => ({ cobranzaId: c.id, numeroRecibo: c.numeroRecibo, clienteNombre: c.clienteNombre })
  return {
    cheques:     cobranzas.flatMap((c) => chequesDe(c).map((ch) => ({ ...ch, ...ref(c) }))),
    retenciones: cobranzas.flatMap((c) => retencionesDe(c).map((r) => ({ ...r, ...ref(c) }))),
  }
}

/** Los valores que un sobre recibido efectivamente trajo (tildados como recibidos por quien lo recibió). */
export function valoresRecibidosDe(s: Sobre): { cheques: ChequeRendido[]; retenciones: RetencionRendida[] } {
  const rec = s.recepcion
  if (!rec) return { cheques: [], retenciones: [] }
  const okC = new Set(rec.cheques.filter((v) => v.recibido).map((v) => v.clave))
  const okR = new Set(rec.retenciones.filter((v) => v.recibido).map((v) => v.clave))
  return {
    cheques:     s.sistema.cheques.filter((c) => okC.has(claveDeCheque(c))),
    retenciones: s.sistema.retenciones.filter((r) => okR.has(claveDeRetencion(r))),
  }
}

// ── Comparaciones (declarado vs sistema, contado vs sistema) ─────────────────

function faltantesDe(sistema: SobreSistema, presentes: Set<string>): { cantidad: number; total: number } {
  const faltanC = sistema.cheques.filter((c) => !presentes.has(claveDeCheque(c)))
  const faltanR = sistema.retenciones.filter((r) => !presentes.has(claveDeRetencion(r)))
  return { cantidad: faltanC.length + faltanR.length, total: faltanC.reduce((s, c) => s + c.importe, 0) + faltanR.reduce((s, r) => s + r.importe, 0) }
}

/** Diferencia de quien rinde: lo que declaró contra lo que el sistema dice. Negativo = falta. */
export function diferenciaDeclarada(sistema: SobreSistema, declarado: SobreDeclarado): DiferenciaSobre {
  const presentes = new Set([...declarado.cheques, ...declarado.retenciones].filter((v) => v.presente).map((v) => v.clave))
  return { efectivo: redondear(declarado.efectivo - sistema.efectivo), valoresFaltantes: faltantesDe(sistema, presentes) }
}

/** Diferencia de quien recibe: lo que contó contra lo que el sistema dice (no contra lo declarado: el sistema es el que manda). */
export function diferenciaRecepcion(sistema: SobreSistema, rec: Pick<SobreRecepcion, 'efectivoContado' | 'cheques' | 'retenciones'>): DiferenciaSobre {
  const presentes = new Set([...rec.cheques, ...rec.retenciones].filter((v) => v.recibido).map((v) => v.clave))
  return { efectivo: redondear(rec.efectivoContado - sistema.efectivo), valoresFaltantes: faltantesDe(sistema, presentes) }
}

export const hayDiferencia = (d: DiferenciaSobre): boolean => d.efectivo !== 0 || d.valoresFaltantes.cantidad > 0
export const conformidadDe = (d: DiferenciaSobre): Conformidad => (hayDiferencia(d) ? 'con_diferencia' : 'conforme')

/** Todos los valores del sistema tienen que estar decididos (tildado sí o no) antes de firmar. */
export function valoresSinDecidir(sistema: SobreSistema, decididos: (ValorDeclarado | ValorRecibido)[]): string[] {
  const vistos = new Set(decididos.map((v) => v.clave))
  return [
    ...sistema.cheques.map(claveDeCheque),
    ...sistema.retenciones.map(claveDeRetencion),
  ].filter((k) => !vistos.has(k))
}

/** Los valores tildados como NO recibidos necesitan motivo. */
export function recibidosSinMotivo(valores: ValorRecibido[]): string[] {
  return valores.filter((v) => !v.recibido && !(v.motivoNoRecibido ?? '').trim()).map((v) => v.clave)
}

// ── Custodia y antigüedad ────────────────────────────────────────────────────

/** Sin contar por tesorería: cerrado en la ventanilla o ya entregado en mano. */
export const sobrePendiente = (s: Pick<Sobre, 'estado'>): boolean => s.estado === 'pendiente_recepcion' || s.estado === 'entregada'
/** Entregado en mano a tesorería y todavía sin contar. */
export const sobreEntregado = (s: Pick<Sobre, 'estado'>): boolean => s.estado === 'entregada'

export function antiguedadHoras(s: Pick<Sobre, 'cerradaEn'>, ahora: number): number {
  return Math.max(0, (ahora - s.cerradaEn.toMillis()) / 3_600_000)
}

export interface CustodiaPlanta {
  /** Cajas abiertas: turnos sin cerrar (la plata está en la ventanilla, todavía sin sobre). */
  cajasAbiertas:  { sesion: CajaSesion }[]
  /** Sobres de ventanilla en camino a tesorería. */
  enCamino:       { sobre: Sobre; horas: number }[]
  /** Sobres de choferes/cobradores esperando que caja los reciba. */
  porRecibirEnCaja: { sobre: Sobre; horas: number }[]
  /** Recibidos por tesorería en el día. */
  recibidosHoy:   Sobre[]
  totales: { enCamino: number; porRecibirEnCaja: number; recibidoHoy: number; tieneQueLlegar: number; falta: number }
}

/**
 * Dónde está la plata ahora, para el tablero de tesorería. "Tiene que llegar"
 * es el SISTEMA de los sobres de ventanilla del día (no lo que caja contó):
 * un faltante de caja se ve como faltante, no se absorbe.
 */
export function custodiaDePlanta(plantaId: PlantaId, fecha: string, sesiones: CajaSesion[], sobres: Sobre[], ahora: number): CustodiaPlanta {
  const dePlanta = sobres.filter((s) => s.plantaId === plantaId)
  const enCamino = dePlanta.filter((s) => s.tipo === 'ventanilla' && sobrePendiente(s)).map((sobre) => ({ sobre, horas: antiguedadHoras(sobre, ahora) }))
  const porRecibirEnCaja = dePlanta.filter((s) => s.rindeA === 'caja' && sobrePendiente(s)).map((sobre) => ({ sobre, horas: antiguedadHoras(sobre, ahora) }))
  const recibidosHoy = dePlanta.filter((s) => s.tipo === 'ventanilla' && s.estado === 'recibida' && s.fecha === fecha)
  const cajasAbiertas = sesiones.filter((x) => x.plantaId === plantaId && x.estado === 'abierta').map((sesion) => ({ sesion }))
  const ventanillaHoy = dePlanta.filter((s) => s.tipo === 'ventanilla' && s.fecha === fecha)
  const tieneQueLlegar = ventanillaHoy.reduce((s, x) => s + x.sistema.efectivo, 0)
  const recibidoHoy = recibidosHoy.reduce((s, x) => s + (x.recepcion?.efectivoContado ?? 0), 0)
  return {
    cajasAbiertas, enCamino, porRecibirEnCaja, recibidosHoy,
    totales: {
      enCamino:         enCamino.reduce((s, x) => s + x.sobre.sistema.efectivo, 0),
      porRecibirEnCaja: porRecibirEnCaja.reduce((s, x) => s + x.sobre.sistema.efectivo, 0),
      recibidoHoy,
      tieneQueLlegar,
      falta: redondear(tieneQueLlegar - recibidoHoy),
    },
  }
}

/** Quién tiene la plata de un sobre ahora. */
export function custodioDe(s: Pick<Sobre, 'estado' | 'rindio' | 'recepcion' | 'entrega'>): { uid: string; nombre: string } {
  if (s.estado === 'recibida' && s.recepcion) return s.recepcion.recibio
  // Entregado en mano: la plata ya es de quien firmó el recibí, aunque no la haya contado.
  if (s.estado === 'entregada' && s.entrega) return s.entrega.recibio
  return s.rindio
}

const redondear = (n: number): number => Math.round(n * 100) / 100
