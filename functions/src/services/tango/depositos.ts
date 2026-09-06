// Catálogo de DEPÓSITOS de Tango → app (2026-09-06). En Tango cada repartidor
// es un depósito en tránsito (03 SERGIO ALVAREZ … 55, tercerizados como NOAIN
// 01-06, supervisores 23/24/25); la expedición de la app (carga, descarga,
// liquidación) trabaja por depósito, con el usuario de la app como dato
// opcional. Ver docs/tango/INTEGRACION.md §27.
//
//   depositosTango/{codigo} = {
//     codigo, nombre, idSta22, inhabilitado, actualizadoEn,   ← Tango (esta sync)
//     tipo: 'repartidor' | 'planta' | 'interno',              ← editable en la app
//     activo: boolean,                                         ← editable en la app
//     uid?, usuarioNombre?, usuarioRol?                        ← editable en la app
//   }
//
// La sync escribe con merge: nunca pisa lo editable. Solo la primera vez que
// aparece un código le pone el tipo por defecto y activo = !inhabilitado.
// Los códigos son los mismos en Redonhielo y Rolito (verificado 2026-09-04),
// así que se lee una sola empresa.

import type { Firestore } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { TangoClient, PROCESOS } from './client'
import { prop } from './pedido'
import type { ConfigTango } from './writers'

export type TipoDeposito = 'repartidor' | 'planta' | 'interno'

export interface DepositoTangoRow {
  codigo:       string
  nombre:       string
  idSta22:      number
  inhabilitado: boolean
}

/** Códigos que no son personas: plantas y depósitos contables/especiales. */
const PLANTAS = new Set(['01', '02'])
const INTERNOS = new Set(['26', '29', '81', '97', '98', '99'])

export function tipoDefaultDeposito(codigo: string): TipoDeposito {
  if (PLANTAS.has(codigo)) return 'planta'
  if (INTERNOS.has(codigo)) return 'interno'
  return 'repartidor'
}

export function recortarDeposito(f: Record<string, unknown>): DepositoTangoRow | null {
  const codigo = String(prop(f, 'COD_STA22') ?? '').trim()
  const idSta22 = Number(prop(f, 'ID_STA22'))
  if (!codigo || !Number.isInteger(idSta22)) return null
  return {
    codigo,
    nombre: String(prop(f, 'NOMBRE_SUC') ?? '').trim(),
    idSta22,
    inhabilitado: prop(f, 'INHABILITA') === true,
  }
}

export interface ResumenSyncDepositos {
  recibidos: number
  nuevos: number
  actualizados: number
  inhabilitados: number
}

export async function sincronizarDepositosTango(db: Firestore, tango: TangoClient, cfg: ConfigTango): Promise<ResumenSyncDepositos> {
  const company = cfg.companies?.redonhielo
  if (!Number.isInteger(company)) throw new Error('config/tango.companies.redonhielo no está configurado')
  const filas = (await tango.getAll(company as number, PROCESOS.depositos)).map(recortarDeposito).filter((d): d is DepositoTangoRow => !!d)
  const existentes = new Set((await db.collection('depositosTango').select().get()).docs.map((d) => d.id))
  const resumen: ResumenSyncDepositos = { recibidos: filas.length, nuevos: 0, actualizados: 0, inhabilitados: 0 }
  let batch = db.batch(), ops = 0
  for (const d of filas) {
    if (d.inhabilitado) resumen.inhabilitados++
    const ref = db.doc(`depositosTango/${d.codigo}`)
    const base = { codigo: d.codigo, nombre: d.nombre, idSta22: d.idSta22, inhabilitado: d.inhabilitado, actualizadoEn: FieldValue.serverTimestamp() }
    if (existentes.has(d.codigo)) {
      batch.set(ref, base, { merge: true })
      resumen.actualizados++
    } else {
      batch.set(ref, { ...base, tipo: tipoDefaultDeposito(d.codigo), activo: !d.inhabilitado, uid: null, usuarioNombre: null, usuarioRol: null, creadoEn: FieldValue.serverTimestamp() })
      resumen.nuevos++
    }
    if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0 }
  }
  if (ops) await batch.commit()
  return resumen
}
