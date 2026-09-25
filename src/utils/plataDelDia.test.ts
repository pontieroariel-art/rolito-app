import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { dondeEstaLaPlata, plataDelDia } from './plataDelDia'
import type { CajaSesion, Liquidacion, Sobre } from '@/types'
import type { FilaCalle, FilaSupervisor } from './tesoreriaLive'
import { porEmpresaVacio } from './tesoreriaLive'

const ts = (h: string) => Timestamp.fromDate(new Date(`2026-09-22T${h}:00`))
const cheque = (numero: string, importe: number, extra: Record<string, unknown> = {}) => ({ numero, bancoCodigo: '011', bancoNombre: 'Nación', fechaEmision: '2026-09-22', fechaAcreditacion: '2026-10-22', dias: 30, importe, cobranzaId: `c${numero}`, clienteNombre: 'Cli', ...extra })

const sesion = (uid: string, numero: number, cerrada: boolean): CajaSesion => ({
  id: `2026-09-22_${uid}_${numero}`, plantaId: 'torcuato', cajero: { uid, nombre: uid.toUpperCase() }, fecha: '2026-09-22', numero,
  estado: cerrada ? 'cerrada' : 'abierta', abiertaEn: ts('04:52'), fondoInicial: 0, fondoInicialDe: null, ...(cerrada ? { cerradaEn: ts('13:05') } : {}),
} as CajaSesion)

const sobre = (uid: string, extra: Partial<Sobre> = {}): Sobre => ({
  id: `2026-09-22_${uid}_1`, tipo: 'ventanilla', rindeA: 'tesoreria', plantaId: 'torcuato', fecha: '2026-09-22', numero: 11, codigo: 'RV-DT-000011',
  rindio: { uid, nombre: uid.toUpperCase(), rol: 'caja' }, cajaSesionId: `2026-09-22_${uid}_1`,
  sistema: {
    efectivo: 1587100, cheques: [cheque('1', 150000), cheque('2', 220000)], retenciones: [], transferencias: { cantidad: 0, total: 0 },
    porEmpresa: {
      redonhielo: { ventasEfectivo: 412400, cobranzasEfectivo: 305950, recibidoDeLiquidaciones: 60000, recibidoDeSobres: 0, anticipos: 500000, efectivo: 278350, transferencias: 0, cheques: { cantidad: 2, total: 370000 }, retenciones: { cantidad: 0, total: 0 } },
      rolito:     { ventasEfectivo: 1215350, cobranzasEfectivo: 50000, recibidoDeLiquidaciones: 43400, recibidoDeSobres: 0, anticipos: 0, efectivo: 1308750, transferencias: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 } },
    },
    origenIds: { ventasIds: [], cobranzasIds: [], liquidacionesIds: ['lq45'], sobresRecibidosIds: [], anticiposIds: ['ant1'] },
  },
  declarado: { efectivo: 1587100, cheques: [], retenciones: [] },
  diferenciaDeclarada: { efectivo: 0, valoresFaltantes: { cantidad: 0, total: 0 } },
  firmaRinde: 'x', firmanteRinde: 'N', cerradaEn: ts('13:05'), estado: 'pendiente_recepcion',
  custodia: { uid, nombre: 'N', rol: 'caja', desde: ts('13:05') }, createdAt: ts('13:05'), ...extra,
} as Sobre)

const anticipo = (uid: string, recibido: boolean): Sobre => ({
  ...sobre(uid), id: `2026-09-22_${uid}_1_anticipo_1`, tipo: 'anticipo', codigo: 'VA-DT-000007', anticipo: { empresa: 'redonhielo' },
  sistema: { efectivo: 500000, cheques: [], retenciones: [], transferencias: { cantidad: 0, total: 0 }, origenIds: { ventasIds: [], cobranzasIds: [], liquidacionesIds: [], sobresRecibidosIds: [] } },
  declarado: { efectivo: 500000, cheques: [], retenciones: [] }, estado: recibido ? 'recibida' : 'entregada', cerradaEn: ts('11:40'),
  ...(recibido ? { recepcion: { recibio: { uid: 'tes', nombre: 'Yanina', rol: 'tesoreria' }, en: ts('11:45'), efectivoContado: 500000, cheques: [], retenciones: [], conformidad: 'conforme', firmaRecibe: 'x', firmanteRecibe: 'Y' } } : {}),
} as Sobre)

const liquidacion = (cajero: string): Liquidacion => ({
  id: 'lq45', codigo: 'LQ-45-000009', fecha: '2026-09-22', plantaId: 'torcuato', choferId: 'ch1', choferNombre: 'ZANLONGO',
  importes: { contadoEfectivo: 60000, contadoTransferencia: 0, cuentaCorriente: 0, total: 60000 },
  efectivoARendir: 103400, efectivoRecibido: 103400, diferenciaEfectivo: 0,
  conteoBilletes: { redonhielo: { billetes: {}, cambioChico: 0, sinEfectivo: false, total: 60000 }, rolito: { billetes: {}, cambioChico: 0, sinEfectivo: false, total: 43400 } },
  cheques: [cheque('2', 220000, { recibido: true })], cerradaPor: { uid: cajero, nombre: cajero.toUpperCase() }, createdAt: ts('09:40'),
} as unknown as Liquidacion)

const filaCalle = (id: string, efectivo: number, liq: Liquidacion | null): FilaCalle => ({
  choferId: id, nombre: id.toUpperCase(), remitos: 1, cargaBultos: 0, contado: { cantidad: 0, efectivo, transferencia: 0, cuentaCorriente: 0, total: efectivo }, promo: { cantidad: 0, efectivo: 0, transferencia: 0, cuentaCorriente: 0, total: 0 },
  bultosVendidos: 0, productos: [], cobranzas: { cantidad: 0, efectivo: 0, transferencia: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 }, total: 0 },
  porEmpresa: { ...porEmpresaVacio(), redonhielo: { efectivo, transferencia: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 } } },
  volvio: false, descargas: 0, bultosDescargados: 0, liquidacion: liq, estado: liq ? 'liquidado' : 'vendiendo',
})

describe('plataDelDia', () => {
  it('tres casilleros por caja: rendido a caja, cerrado por caja (sobre + anticipo) y recibido por tesorería (solo lo contado)', () => {
    const r = plataDelDia({
      sesiones: [sesion('nico', 1, true)],
      sobres: [sobre('nico'), anticipo('nico', true)],
      liquidaciones: [liquidacion('nico')],
      calle: [filaCalle('ch1', 60000, liquidacion('nico')), filaCalle('orona', 1037717, null)],
      supervisores: [],
    })
    expect(r.cajas).toHaveLength(1)
    const c = r.cajas[0]!
    expect(c.turnos[0]).toMatchObject({ numero: 1 })
    expect(c.rendidoACaja.efectivo).toEqual({ redonhielo: 60000, rolito: 43400, total: 103400 })
    expect(c.rendidoACaja.cheques).toEqual({ cantidad: 1, total: 220000 })
    expect(c.rendidoACaja.liquidaciones[0]).toMatchObject({ codigo: 'LQ-45-000009', nombre: 'ZANLONGO' })
    // Sobre (sistema por empresa) + anticipo de Redonhielo.
    expect(c.cerradoPorCaja.efectivo).toEqual({ redonhielo: 778350, rolito: 1308750, total: 2087100 })
    expect(c.cerradoPorCaja.cheques).toEqual({ cantidad: 2, total: 370000 })
    expect(c.cerradoPorCaja.anticipos).toHaveLength(1)
    // Tesorería contó solo el anticipo; el sobre sigue sin contar.
    expect(c.recibidoPorTesoreria.efectivo).toEqual({ redonhielo: 500000, rolito: 0, total: 500000 })
    expect(c.recibidoPorTesoreria.sinContar.map((s) => s.codigo)).toEqual(['RV-DT-000011'])
    // Pendiente: Orona con plata en la calle y sin liquidar; Zanlongo ya liquidó.
    expect(r.pendientes.map((p) => p.nombre)).toEqual(['ORONA'])
    expect(r.pendientes[0]!.efectivo.total).toBe(1037717)
    expect(r.totales.cerradoPorCaja.efectivo.total).toBe(2087100)
    expect(r.totales.recibidoPorTesoreria.efectivo.total).toBe(500000)
  })

  it('un sobre recibido reparte lo contado por fajo; sin fajos, Rolito exacto y Redonhielo el resto', () => {
    const conFajos = sobre('nico', { estado: 'recibida', recepcion: { recibio: { uid: 't', nombre: 'Y', rol: 'tesoreria' }, en: ts('14:00'), efectivoContado: 1587000, fajos: { redonhielo: 278250, rolito: 1308750 }, cheques: [{ clave: 'c1|cheque|1', recibido: true }, { clave: 'c2|cheque|2', recibido: false, motivoNoRecibido: 'no vino' }], retenciones: [], conformidad: 'con_diferencia', diferencia: { efectivo: -100, valoresFaltantes: { cantidad: 1, total: 220000 }, motivo: 'faltante_entrega', nota: 'x' }, firmaRecibe: 'x', firmanteRecibe: 'Y' } })
    const r = plataDelDia({ sesiones: [sesion('nico', 1, true)], sobres: [conFajos], liquidaciones: [], calle: [], supervisores: [] })
    const rec = r.cajas[0]!.recibidoPorTesoreria
    expect(rec.efectivo).toEqual({ redonhielo: 278250, rolito: 1308750, total: 1587000 })
    expect(rec.cheques).toEqual({ cantidad: 1, total: 150000 })
    const sinFajos = sobre('nico', { estado: 'recibida', recepcion: { recibio: { uid: 't', nombre: 'Y', rol: 'tesoreria' }, en: ts('14:00'), efectivoContado: 1587100, cheques: [], retenciones: [], conformidad: 'conforme', firmaRecibe: 'x', firmanteRecibe: 'Y' } })
    const r2 = plataDelDia({ sesiones: [], sobres: [sinFajos], liquidaciones: [], calle: [], supervisores: [] })
    expect(r2.cajas[0]!.recibidoPorTesoreria.efectivo).toEqual({ redonhielo: 278350, rolito: 1308750, total: 1587100 })
  })

  it('un cobrador con recibos y sin liquidación queda pendiente; con turno abierto la caja se marca abierta', () => {
    const sup: FilaSupervisor = { uid: 'sup', nombre: 'MATÍAS', cobranzas: { cantidad: 2, efectivo: 80000, transferencia: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 }, total: 80000 }, porEmpresa: { ...porEmpresaVacio(), redonhielo: { efectivo: 80000, transferencia: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 } } }, liquidacion: null }
    const r = plataDelDia({ sesiones: [sesion('nico', 1, false)], sobres: [], liquidaciones: [], calle: [], supervisores: [sup] })
    expect(r.pendientes[0]).toMatchObject({ nombre: 'MATÍAS', detalle: 'cobranzas de calle', tipo: 'supervisor' })
    expect(r.cajas[0]!.cerradoPorCaja.abierto).toBe(true)
  })
})

describe('dondeEstaLaPlata', () => {
  it('cuatro lugares: calle (sin liquidar), caja (turno abierto + cerradas sin entregar), entregada sin contar y contada con su diferencia', () => {
    const abierto = sesion('nico', 2, false)
    const cerradaSinEntregar = sobre('nico')                                    // estado pendiente_recepcion
    const entregada = sobre('nico', { id: 'e1', codigo: 'RV-DT-000012', estado: 'entregada' })
    const contada = sobre('nico', { id: 'c1', codigo: 'RV-DT-000010', estado: 'recibida', recepcion: { recibio: { uid: 't', nombre: 'Y', rol: 'tesoreria' }, en: ts('14:00'), efectivoContado: 1587000, cheques: [{ clave: 'c1|cheque|1', recibido: true }, { clave: 'c2|cheque|2', recibido: false, motivoNoRecibido: 'no vino' }], retenciones: [], conformidad: 'con_diferencia', diferencia: { efectivo: -100, valoresFaltantes: { cantidad: 1, total: 220000 }, motivo: 'faltante_entrega', nota: 'x' }, firmaRecibe: 'x', firmanteRecibe: 'Y' } })
    const r = dondeEstaLaPlata({
      sesiones: [abierto], sobres: [cerradaSinEntregar, entregada, contada], liquidaciones: [],
      calle: [filaCalle('orona', 1037717, null)], supervisores: [], ventanilla: [],
      porRecibir: [cerradaSinEntregar], aContar: [entregada], contados: [contada],
    })
    expect(r.calle.efectivo).toBe(1037717)
    expect(r.calle.personas.map((p) => p.nombre)).toEqual(['ORONA'])
    // Turno abierto sin ventas todavía (fondo 0) + la cerrada sin entregar.
    expect(r.caja.personas.map((p) => p.detalle)).toEqual(['turno 2 abierto', 'RV-DT-000011 cerrada, sin entregar'])
    expect(r.caja.efectivo).toBe(1587100)
    expect(r.caja.cheques).toEqual({ cantidad: 2, total: 370000 })
    expect(r.entregada.efectivo).toBe(1587100)
    expect(r.entregada.personas[0]).toMatchObject({ nombre: 'NICO', detalle: 'RV-DT-000012' })
    // Contada: lo que tesorería contó, solo los cheques recibidos, y la diferencia.
    expect(r.contada.efectivo).toBe(1587000)
    expect(r.contada.cheques).toEqual({ cantidad: 1, total: 150000 })
    expect(r.contada.diferencia).toBe(-100)
    expect(r.contada.personas[0]!.detalle).toContain('con diferencia')
  })
})
