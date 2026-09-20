import { describe, it, expect } from 'vitest'
import {
  anularRemitoEnTango, sentenciasAnulacion, sentenciaCabecera,
  type CabeceraRemito, type ConfigAnulacionRemito, type RenglonAnulacion,
} from './anulacionRemito'
import type { EjecutorSql, ParametroSql } from './tipos'

// Los números son los de la traza real del 2026-09-20: R0110500000957 de KLIVE,
// depósito 06, tres renglones de 40 + 20 + 20, con los saldos que tenía STA19.
// Ver docs/tango/ANULACION-REMITO-receta.md.

const cfg: ConfigAnulacionRemito = { usuario: 'APP', terminal: 'APP' }

const cab: CabeceraRemito = {
  idSta14: 891840, nComp: 'R0110500000957', tcompInS: 'RE', ncompInS: '00408839',
  codDeposito: '06', talonario: 1105, estadoMov: 'P',
}

const renglones: RenglonAnulacion[] = [
  { nRenglon: 1, codArticu: 'PTHIBOLROLI0003', cantidad: 40, stockActual: -11714 },
  { nRenglon: 2, codArticu: 'PTACANT0006',     cantidad: 20, stockActual: -109 },
  { nRenglon: 3, codArticu: 'PTANNAT0006SG',   cantidad: 20, stockActual: -50 },
]

const param = (ps: ParametroSql[], nombre: string) => ps.find((p) => p.nombre === nombre)?.valor

describe('sentenciasAnulacion', () => {
  const ss = sentenciasAnulacion(cab, renglones, cfg, new Date(2026, 8, 20, 19, 36, 35))

  it('devuelve el stock al depósito por la cantidad de cada renglón', () => {
    const updates = ss.filter((s) => s.etiqueta.startsWith('UPDATE STA19'))
    expect(updates).toHaveLength(3)
    // Los mismos saldos que quedaron en Tango después de la anulación real.
    expect(param(updates[0].params, 'CANT_NUEVA')).toBe(-11674)
    expect(param(updates[1].params, 'CANT_NUEVA')).toBe(-89)
    expect(param(updates[2].params, 'CANT_NUEVA')).toBe(-30)
    // Concurrencia optimista: el saldo anterior viaja en el WHERE.
    expect(param(updates[0].params, 'CANT_ANTERIOR')).toBe(-11714)
  })

  it('borra lo que cuelga de cada renglón y después los renglones enteros', () => {
    const orden = ss.map((s) => s.etiqueta)
    for (const tabla of ['STA09', 'STA07', 'GVA106', 'GVA54']) {
      expect(orden.filter((e) => e.startsWith(`DELETE ${tabla}`))).toHaveLength(3)
    }
    // STA20 una sola vez, y después de los renglones individuales.
    expect(orden.filter((e) => e === 'DELETE STA20 renglones')).toHaveLength(1)
    expect(orden.indexOf('DELETE STA20 renglones')).toBeGreaterThan(orden.lastIndexOf('DELETE GVA54 renglón 3'))
  })

  it('la cabecera se marca ÚLTIMA, y solo si sigue vigente', () => {
    const ultima = ss[ss.length - 1]
    expect(ultima.etiqueta).toBe('UPDATE STA14 anulación')
    expect(ultima.sql).toContain("\"ESTADO_MOV\" = 'A'")
    expect(ultima.sql).toContain("\"ESTADO_MOV\" = 'P'")   // en el WHERE
    expect(param(ultima.params, 'ID_STA14')).toBe(891840)
    expect(param(ultima.params, 'HORA_ANU')).toBe('193635')
    expect(param(ultima.params, 'USUARIO_ANU')).toBe('APP')
  })

  it('no toca el cliente: Tango se lo deja al remito anulado', () => {
    for (const s of ss) expect(s.sql).not.toContain('COD_PRO_CL')
  })

  it('el remito se vacía, no se borra', () => {
    for (const s of ss) expect(s.sql).not.toMatch(/DELETE FROM STA14/i)
  })
})

// ── El orquestador, con una base falsa ───────────────────────────────────────

function baseFalsa(estadoMov: string | null) {
  const ejecutadas: string[] = []
  const db: EjecutorSql = {
    async query<T>(sql: string): Promise<T[]> {
      if (sql.includes('FROM STA14 WHERE')) {
        return (estadoMov === null ? [] : [{
          ID_STA14: 891840, N_COMP: cab.nComp, TCOMP_IN_S: 'RE', NCOMP_IN_S: '00408839',
          COD_DEPOSI: '06', TALONARIO: 1105, ESTADO_MOV: estadoMov,
        }]) as T[]
      }
      if (sql.includes('FROM STA20')) {
        return renglones.map((r) => ({ N_RENGL_S: r.nRenglon, COD_ARTICU: r.codArticu, CANTIDAD: r.cantidad })) as T[]
      }
      if (sql.includes('FROM STA19')) return [{ CANT_STOCK: -100 }] as T[]
      ejecutadas.push(sql.trim().split('\n')[0].trim())
      return [{ affected: 1 }] as T[]
    },
  }
  return { db, ejecutadas }
}

describe('anularRemitoEnTango', () => {
  it('anula el remito vigente y devuelve cuántos renglones tocó', async () => {
    const { db, ejecutadas } = baseFalsa('P')
    const r = await anularRemitoEnTango(db, cab.nComp, cfg)
    expect(r).toEqual({ estado: 'anulado', idSta14: 891840, renglones: 3 })
    expect(ejecutadas.some((s) => s.startsWith('UPDATE "STA14"'))).toBe(true)
  })

  it('no vuelve a anular el que ya está anulado, y no escribe nada', async () => {
    const { db, ejecutadas } = baseFalsa('A')
    expect(await anularRemitoEnTango(db, cab.nComp, cfg)).toEqual({ estado: 'ya_anulado', idSta14: 891840 })
    expect(ejecutadas).toHaveLength(0)
  })

  it('NO toca el remito facturado: primero hay que anular la factura', async () => {
    const { db, ejecutadas } = baseFalsa('F')
    expect(await anularRemitoEnTango(db, cab.nComp, cfg)).toEqual({ estado: 'facturado', idSta14: 891840 })
    expect(ejecutadas).toHaveLength(0)
  })

  it('avisa si el remito no está en Tango en vez de romper', async () => {
    const { db } = baseFalsa(null)
    expect(await anularRemitoEnTango(db, cab.nComp, cfg)).toEqual({ estado: 'inexistente' })
  })

  it('el stock que se movió mientras tanto aborta todo', async () => {
    const db: EjecutorSql = {
      async query<T>(sql: string): Promise<T[]> {
        if (sql.includes('FROM STA14 WHERE')) return [{ ID_STA14: 891840, TCOMP_IN_S: 'RE', NCOMP_IN_S: '00408839', COD_DEPOSI: '06', TALONARIO: 1105, ESTADO_MOV: 'P' }] as T[]
        if (sql.includes('FROM STA20')) return [{ N_RENGL_S: 1, COD_ARTICU: 'PTACANT0006', CANTIDAD: 20 }] as T[]
        if (sql.includes('FROM STA19')) return [{ CANT_STOCK: -109 }] as T[]
        if (sql.startsWith('UPDATE "STA19"')) return [{ affected: 0 }] as T[]
        return [{ affected: 1 }] as T[]
      },
    }
    await expect(anularRemitoEnTango(db, cab.nComp, cfg)).rejects.toThrow(/stock cambió/)
  })
})

describe('sentenciaCabecera', () => {
  it('busca por tipo y número, que es la clave del remito en Tango', () => {
    const s = sentenciaCabecera('R0110500000957')
    expect(s.sql).toContain("T_COMP = 'REM'")
    expect(param(s.params, 'N_COMP')).toBe('R0110500000957')
  })
})
