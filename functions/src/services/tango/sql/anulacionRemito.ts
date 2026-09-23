// Anular en Tango el remito que el chofer anuló en la app (2026-09-20).
//
// Hasta hoy ese remito lo anulaba la oficina a mano y la app solo avisaba. En
// la práctica tardaba días —cuatro, seis, ocho— y en esa ventana Tango llegaba
// a FACTURAR la mercadería: el 20/09, de siete remitos anulados en la app, tres
// ya estaban facturados y no se podían anular más. Eso es una factura al
// cliente por mercadería que no se entregó, y una divergencia entre la app y
// Tango que no se arregla nunca.
//
// La secuencia está copiada de la traza real de una anulación hecha desde
// Tango Ventas → Anulación de remitos (R0110500000957 de KLIVE, 20/09), no
// inventada. La receta completa, con las tablas y los valores medidos, está en
// docs/tango/ANULACION-REMITO-receta.md.
//
// Lo esencial: **el remito no se borra, se vacía**. Los renglones se eliminan,
// el stock vuelve al depósito y la cabecera queda con ESTADO_MOV = 'A' y los
// campos de anulación. El cliente NO se toca (a diferencia de lo que Tango hace
// con los recibos, que sí quedan sin cliente).

import {
  varchar, datetime, int, soloDia, horaHHMMSS,
  type EjecutorSql, type SentenciaSql,
} from './tipos'
import { updateSta19, insertSta19, leerStock } from './comun'

export interface ConfigAnulacionRemito {
  /** Queda en STA14.USUARIO_ANU. Conviene que se distinga de una anulación a mano. */
  usuario:  string
  /** Queda en STA14.TERMINAL_ANU. */
  terminal: string
}

/** La cabecera del remito en Tango, tal como hace falta para anularlo. */
export interface CabeceraRemito {
  idSta14:     number
  nComp:       string
  tcompInS:    string   // 'RE'
  ncompInS:    string   // el comprobante interno de stock, p. ej. '00408839'
  codDeposito: string
  talonario:   number
  estadoMov:   string   // 'P' vigente · 'F' facturado · 'A' ya anulado
}

export interface RenglonAnulacion {
  nRenglon:  number
  codArticu: string
  cantidad:  number
  /** Saldo actual del artículo en el depósito; `null` si no hay fila en STA19. */
  stockActual: number | null
}

/** ¿Existe el remito y en qué estado está? */
export function sentenciaCabecera(nComp: string): SentenciaSql {
  return {
    etiqueta: 'SELECT STA14 cabecera',
    sql: `SELECT ID_STA14, N_COMP, TCOMP_IN_S, NCOMP_IN_S, COD_DEPOSI, TALONARIO, ESTADO_MOV
          FROM STA14 WHERE T_COMP = 'REM' AND N_COMP = @N_COMP`,
    params: [varchar('N_COMP', nComp, 14)],
  }
}

/**
 * Las sentencias de la anulación, en el mismo orden que las hace Tango. Puras:
 * no tocan la base. `renglones` sale de leerRenglones (o del test).
 */
export function sentenciasAnulacion(
  cab: CabeceraRemito,
  renglones: RenglonAnulacion[],
  cfg: ConfigAnulacionRemito,
  ahora = new Date(),
): SentenciaSql[] {
  const out: SentenciaSql[] = []
  const clave = [varchar('TCOMP', cab.tcompInS, 2), varchar('NCOMP', cab.ncompInS, 8)]
  const claveRenglon = (n: number) => [...clave.map((p) => ({ ...p })), int('RENGL', n)]

  // 1. Por renglón: devolver el stock y limpiar lo que cuelga del movimiento.
  for (const ren of renglones) {
    // El stock vuelve al depósito por la cantidad del renglón. Si no hay fila de
    // saldo (nunca debería, el remito la creó al salir) se crea, igual que hace
    // el writer del remito.
    out.push(ren.stockActual === null
      ? insertSta19(`INSERT STA19 stock ${ren.codArticu}`, ren.codArticu, cab.codDeposito, ren.cantidad)
      : updateSta19(`UPDATE STA19 stock ${ren.codArticu}`, ren.codArticu, cab.codDeposito, ren.stockActual, ren.cantidad))

    for (const tabla of ['STA09', 'STA07', 'GVA106', 'GVA54']) {
      out.push({
        etiqueta: `DELETE ${tabla} renglón ${ren.nRenglon}`,
        sql: `DELETE FROM ${tabla} WHERE TCOMP_IN_S = @TCOMP AND NCOMP_IN_S = @NCOMP AND N_RENGL_S = @RENGL`,
        params: claveRenglon(ren.nRenglon),
      })
    }
  }

  // 2. Los renglones del movimiento de stock, todos juntos.
  out.push({
    etiqueta: 'DELETE STA20 renglones',
    sql: `DELETE FROM STA20 WHERE TCOMP_IN_S = @TCOMP AND NCOMP_IN_S = @NCOMP`,
    params: clave,
  })

  // 3. Lo que cuelga del comprobante de ventas.
  out.push({
    etiqueta: 'DELETE GVA45',
    sql: `DELETE FROM GVA45 WHERE TALONARIO = @TALONARIO AND T_COMP = 'REM' AND N_COMP = @N_COMP`,
    params: [int('TALONARIO', cab.talonario), varchar('N_COMP', cab.nComp, 14)],
  })
  out.push({
    etiqueta: 'DELETE GVA55',
    sql: `DELETE FROM GVA55 WHERE T_COMP = 'REM' AND N_COMP = @N_COMP`,
    params: [varchar('N_COMP', cab.nComp, 14)],
  })

  // 4. Recién ahora la cabecera queda anulada. COD_PRO_CL no se toca: Tango se
  //    lo deja al remito (al recibo sí se lo borra), y gracias a eso el remito
  //    anulado se sigue viendo en la ficha del cliente.
  out.push({
    etiqueta: 'UPDATE STA14 anulación',
    sql: `UPDATE "STA14" SET "ESTADO_MOV" = 'A', "FECHA_ANU" = @FECHA_ANU, "HORA_ANU" = @HORA_ANU,
          "USUARIO_ANU" = @USUARIO_ANU, "TERMINAL_ANU" = @TERMINAL_ANU
          WHERE "ID_STA14" = @ID_STA14 AND "ESTADO_MOV" = 'P'`,
    params: [
      datetime('FECHA_ANU', soloDia(ahora)),
      varchar('HORA_ANU', horaHHMMSS(ahora), 6),
      varchar('USUARIO_ANU', cfg.usuario.slice(0, 10), 10),
      varchar('TERMINAL_ANU', cfg.terminal.slice(0, 8), 8),
      int('ID_STA14', cab.idSta14),
    ],
  })

  return out
}

/** Los renglones del remito, con el saldo actual de cada artículo en el depósito. */
export async function leerRenglones(db: EjecutorSql, cab: CabeceraRemito): Promise<RenglonAnulacion[]> {
  const filas = await db.query<{ N_RENGL_S: number; COD_ARTICU: string; CANTIDAD: number }>(
    `SELECT N_RENGL_S, COD_ARTICU, CANTIDAD FROM STA20
     WHERE TCOMP_IN_S = @TCOMP AND NCOMP_IN_S = @NCOMP ORDER BY N_RENGL_S`,
    [varchar('TCOMP', cab.tcompInS, 2), varchar('NCOMP', cab.ncompInS, 8)],
  )
  const out: RenglonAnulacion[] = []
  for (const f of filas) {
    const codArticu = String(f.COD_ARTICU).trim()
    out.push({
      nRenglon: Number(f.N_RENGL_S),
      codArticu,
      cantidad: Number(f.CANTIDAD),
      stockActual: await leerStock(db, codArticu, cab.codDeposito),
    })
  }
  return out
}

export type ResultadoAnulacion =
  /** Anulado ahora. */
  | { estado: 'anulado'; idSta14: number; renglones: number }
  /** Ya estaba anulado en Tango: nada que hacer (idempotencia). */
  | { estado: 'ya_anulado'; idSta14: number }
  /** Facturado: no se puede anular el remito sin anular antes la factura. */
  | { estado: 'facturado'; idSta14: number }
  /** No está en Tango (nunca llegó, o el número está mal). */
  | { estado: 'inexistente' }

/**
 * Anula el remito en Tango. El llamador abre la transacción y pasa un ejecutor
 * atado a ella: si algo falla a la mitad, no puede quedar el stock devuelto con
 * el remito todavía vivo.
 *
 * No lanza por los casos previstos (ya anulado, facturado, inexistente): los
 * devuelve, porque cada uno tiene su tratamiento aguas arriba.
 */
export async function anularRemitoEnTango(
  db: EjecutorSql,
  nComp: string,
  cfg: ConfigAnulacionRemito,
  log: (m: string) => void = () => undefined,
): Promise<ResultadoAnulacion> {
  const s = sentenciaCabecera(nComp)
  const filas = await db.query<{
    ID_STA14: number; TCOMP_IN_S: string; NCOMP_IN_S: string
    COD_DEPOSI: string; TALONARIO: number; ESTADO_MOV: string
  }>(s.sql, s.params)
  const fila = filas[0]
  if (!fila) {
    log(`remito ${nComp} no existe en Tango`)
    return { estado: 'inexistente' }
  }

  const cab: CabeceraRemito = {
    idSta14:     Number(fila.ID_STA14),
    nComp,
    tcompInS:    String(fila.TCOMP_IN_S).trim(),
    ncompInS:    String(fila.NCOMP_IN_S).trim(),
    codDeposito: String(fila.COD_DEPOSI).trim(),
    talonario:   Number(fila.TALONARIO),
    estadoMov:   String(fila.ESTADO_MOV).trim().toUpperCase(),
  }

  if (cab.estadoMov === 'A') {
    log(`remito ${nComp} ya estaba anulado en Tango`)
    return { estado: 'ya_anulado', idSta14: cab.idSta14 }
  }
  if (cab.estadoMov !== 'P') {
    // 'F' = facturado. Anular el remito acá dejaría la factura colgada.
    log(`remito ${nComp} está en estado ${cab.estadoMov}: no se anula`)
    return { estado: 'facturado', idSta14: cab.idSta14 }
  }

  const renglones = await leerRenglones(db, cab)
  for (const sent of sentenciasAnulacion(cab, renglones, cfg)) {
    const r = await db.query<{ affected?: number }>(sent.sql, sent.params)
    log(sent.etiqueta)
    // El UPDATE de stock lleva el saldo anterior en el WHERE: si no afectó
    // ninguna fila, alguien lo movió mientras tanto y hay que reintentar todo.
    if (sent.etiqueta.startsWith('UPDATE STA19') && r[0]?.affected === 0) {
      throw new Error(`${sent.etiqueta}: el stock cambió mientras se anulaba el remito; se reintenta`)
    }
    if (sent.etiqueta === 'UPDATE STA14 anulación' && r[0]?.affected === 0) {
      throw new Error(`${sent.etiqueta}: el remito dejó de estar en 'P' mientras se anulaba; se reintenta`)
    }
  }

  log(`remito ${nComp} anulado en Tango (${renglones.length} renglones, stock devuelto al depósito ${cab.codDeposito})`)
  return { estado: 'anulado', idSta14: cab.idSta14, renglones: renglones.length }
}
