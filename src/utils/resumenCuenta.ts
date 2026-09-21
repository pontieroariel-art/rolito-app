import type { EmpresaTango, FamiliaComprobante } from '@/types'

/**
 * RESUMEN DE CUENTA del cliente (2026-09-20, pedido de Ariel para comercial y
 * los supervisores).
 *
 * La app ya tenía la **composición de saldos**: qué comprobantes forman lo que
 * el cliente debe HOY. Eso sirve para cobrar. Lo que faltaba es la otra
 * pregunta, la que aparece cuando el cliente dice "yo esto lo pagué": qué pasó
 * en la cuenta entre dos fechas, con cada movimiento sumando o restando y un
 * saldo corriendo al costado.
 *
 * No hace falta pedirle nada nuevo a Tango: el índice de comprobantes que
 * publica el lector (`tangoComprobantes/{empresa}_{codigo}.facturas`) ya trae
 * de cada uno su `familia` (factura / débito suman, recibo / crédito restan),
 * su importe, su fecha y su estado.
 *
 * DOS REGLAS QUE NO SE ROMPEN
 *
 * 1. **El saldo corrido vive dentro de UNA empresa.** Redonhielo y Rolito son
 *    dos deudores distintos, con numeración propia. Un saldo que mezcle las dos
 *    no coincide con ningún papel de Tango y no se puede defender frente al
 *    cliente. Los totales de las dos se muestran juntos arriba; el detalle,
 *    siempre de una.
 * 2. **El saldo inicial se calcula hacia atrás.** Lo que conocemos con certeza
 *    es el saldo de HOY (la consulta en vivo). El del comienzo del período sale
 *    de restarle los movimientos posteriores. Así el último renglón del resumen
 *    siempre cierra con el saldo real, que es lo que el cliente va a mirar.
 */

/** Un movimiento de la cuenta corriente, ya con su signo resuelto. */
export interface MovimientoCuenta {
  fecha:   string            // yyyy-MM-dd
  tipo:    string            // FAC, NC, REC, ND…
  numero:  string
  familia: FamiliaComprobante
  /** Lo que aumenta la deuda (factura, nota de débito). */
  debe:    number
  /** Lo que la baja (recibo, nota de crédito). */
  haber:   number
  /** Saldo después de este movimiento. Lo completa `conSaldoCorrido`. */
  saldo:   number
  anulado: boolean
}

/** Lo que guarda el índice de comprobantes de Tango por cada uno. */
export interface ComprobanteIndice {
  tipo?:    string
  familia?: FamiliaComprobante
  numero?:  string
  fecha?:   string
  importe?: number
  estado?:  string
}

/** Las familias que BAJAN la deuda. El resto la sube. */
const RESTAN: FamiliaComprobante[] = ['recibo', 'credito']

const anuladoEn = (estado: unknown): boolean => {
  const e = String(estado ?? '').trim().toUpperCase()
  return e === 'ANU' || e === 'A'
}

/**
 * Pasa las entradas del índice a movimientos con signo, ordenados por fecha.
 * Los anulados NO se listan: en Tango quedan en cero y no mueven la cuenta.
 */
export function movimientosDe(
  comprobantes: Record<string, ComprobanteIndice | undefined> | undefined,
  desde: string,
  hasta: string,
): MovimientoCuenta[] {
  const out: MovimientoCuenta[] = []
  for (const c of Object.values(comprobantes ?? {})) {
    if (!c?.fecha || !c.numero) continue
    if (c.fecha < desde || c.fecha > hasta) continue
    if (anuladoEn(c.estado)) continue
    const importe = Math.abs(Number(c.importe ?? 0))
    if (!importe) continue
    const familia = (c.familia ?? 'otro') as FamiliaComprobante
    const resta = RESTAN.includes(familia)
    out.push({
      fecha:   c.fecha,
      tipo:    String(c.tipo ?? '').trim(),
      numero:  String(c.numero).trim(),
      familia,
      debe:    resta ? 0 : importe,
      haber:   resta ? importe : 0,
      saldo:   0,
      anulado: false,
    })
  }
  // Por fecha y, dentro del día, por número: dos comprobantes del mismo día
  // tienen que salir siempre en el mismo orden o el saldo "baila" entre
  // consultas y el cliente lo nota.
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero))
}

export interface ResumenCuenta {
  /** Saldo al día anterior al inicio del período. */
  saldoInicial: number
  movimientos:  MovimientoCuenta[]
  /** Saldo al final del período: tiene que coincidir con el saldo de hoy si `hasta` es hoy. */
  saldoFinal:   number
  totalDebe:    number
  totalHaber:   number
}

/**
 * Arma el resumen: calcula el saldo inicial hacia atrás desde el saldo actual y
 * completa la columna de saldo corrido.
 *
 * `saldoActual` es el de HOY, no el del final del período. Si el período
 * termina antes de hoy, hay que descontar además lo que pasó después — para
 * eso está `movimientosPosteriores`.
 */
export function armarResumen(
  movimientos: MovimientoCuenta[],
  saldoActual: number,
  movimientosPosteriores: MovimientoCuenta[] = [],
): ResumenCuenta {
  const neto = (ms: MovimientoCuenta[]) => ms.reduce((s, m) => s + m.debe - m.haber, 0)

  const saldoFinal   = saldoActual - neto(movimientosPosteriores)
  const saldoInicial = saldoFinal - neto(movimientos)

  let corriendo = saldoInicial
  const conSaldo = movimientos.map((m) => {
    corriendo = corriendo + m.debe - m.haber
    return { ...m, saldo: redondear(corriendo) }
  })

  return {
    saldoInicial: redondear(saldoInicial),
    movimientos:  conSaldo,
    saldoFinal:   redondear(saldoFinal),
    totalDebe:    redondear(movimientos.reduce((s, m) => s + m.debe, 0)),
    totalHaber:   redondear(movimientos.reduce((s, m) => s + m.haber, 0)),
  }
}

/**
 * Dos decimales: los importes vienen de Tango con siete y la suma arrastra
 * colas. El `|| 0` no es adorno: una cuenta que cierra en cero puede dar `-0`,
 * y en la columna de saldo eso se imprime "-0,00", que el cliente lee como un
 * error de la app.
 */
const redondear = (n: number): number => (Math.round(n * 100) / 100) || 0

/**
 * La lista de sucursales para el selector: la UNIÓN de las dos empresas, porque
 * no siempre coinciden. Verificado sobre producción el 2026-09-20: de 2011
 * clientes con cuenta en las dos, 1970 tienen exactamente los mismos códigos,
 * 40 tienen alguna sucursal en una sola, y 1 los tiene todos distintos. Cada
 * código sabe en qué empresas existe, así que al cambiar de empresa se ve solo
 * si esa sucursal está o no.
 */
export interface SucursalCuenta {
  codigo:   string
  empresas: EmpresaTango[]
}

export function sucursalesDe(
  porEmpresa: Partial<Record<EmpresaTango, string[]>>,
): SucursalCuenta[] {
  const mapa = new Map<string, Set<EmpresaTango>>()
  for (const [empresa, codigos] of Object.entries(porEmpresa) as [EmpresaTango, string[]][]) {
    for (const codigo of codigos ?? []) {
      const k = codigo.trim()
      if (!k) continue
      if (!mapa.has(k)) mapa.set(k, new Set())
      mapa.get(k)!.add(empresa)
    }
  }
  return [...mapa.entries()]
    .map(([codigo, empresas]) => ({ codigo, empresas: [...empresas].sort() }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
}
