import type { AlertasMoraConfig, NivelMora } from './mora'
import { nivelMora } from './mora'
import type { ClienteIndex, Cobranza, SaldoTango } from '@/types'

/**
 * La agenda del día del supervisor: quién debe, cuánto, hace cuánto y dónde
 * (2026-09-13, pantalla única de clientes). Puro y testeado — la pantalla solo
 * suscribe y pinta.
 *
 * Tres decisiones que valen la pena explicar:
 *
 * - ORDEN POR PRIORIDAD, no por importe. El que debe más no es necesariamente
 *   al que hay que ir: manda el nivel de mora, después los días de atraso y
 *   recién al final el monto.
 * - LOS YA COBRADOS HOY CAEN AL FINAL. Dejaron de ser objetivo del día y así no
 *   se toca dos veces la misma puerta en una segunda vuelta; siguen en la lista
 *   porque a veces hay que volver a entrar a la ficha.
 * - LA ZONA SE CRUZA CON clientesIndex. `saldosTango` no tiene la localidad, y
 *   el recorrido de la calle es geográfico: sin esto el orden por mora manda al
 *   supervisor de San Fernando a Marcos Paz y de vuelta a Devoto.
 */

export interface FilaDeuda {
  uid:          string
  razonSocial:  string
  codigoTango:  string
  saldoTotal:   number
  comprobantes: number
  diasAtraso:   number
  nivel:        NivelMora
  localidad:    string
  actualizadoEn?: { toDate(): Date }
  /** Debe en las dos empresas: la pantalla muestra el desglose. */
  porEmpresa?:  SaldoTango['porEmpresa']
  /** Ya tiene una cobranza registrada hoy por este usuario. */
  cobradoHoy:   boolean
}

/** Días de atraso de la factura más vieja (0 si no venció nada). */
export const atrasoDe = (s: Pick<SaldoTango, 'comprobantes'>): number =>
  Math.max(0, ...s.comprobantes.map((c) => c.diasAtraso ?? 0))

export function armarFilasDeuda(
  saldos: SaldoTango[],
  indice: ClienteIndex[],
  cobranzasHoy: Pick<Cobranza, 'clienteId'>[],
  alertas: AlertasMoraConfig,
): FilaDeuda[] {
  const localidadPor = new Map(indice.map((c) => [c.uid, c.localidad]))
  const cobrados = new Set(cobranzasHoy.map((c) => c.clienteId))
  return saldos.map((s) => {
    const diasAtraso = atrasoDe(s)
    return {
      uid: s.id,
      razonSocial: s.razonSocial,
      codigoTango: s.codigoTango,
      saldoTotal: s.saldoTotal,
      comprobantes: s.comprobantes.length,
      diasAtraso,
      nivel: nivelMora(s.saldoTotal, diasAtraso, alertas),
      localidad: localidadPor.get(s.id) ?? '',
      actualizadoEn: s.actualizadoEn,
      porEmpresa: s.porEmpresa,
      cobradoHoy: cobrados.has(s.id),
    }
  })
}

const PESO: Record<NivelMora, number> = { rojo: 0, amarillo: 1, ok: 2 }

/** Lo urgente arriba; lo ya cobrado hoy, al fondo. */
export const ordenarPorPrioridad = (filas: FilaDeuda[]): FilaDeuda[] =>
  [...filas].sort((a, b) =>
    Number(a.cobradoHoy) - Number(b.cobradoHoy)
    || PESO[a.nivel] - PESO[b.nivel]
    || b.diasAtraso - a.diasAtraso
    || b.saldoTotal - a.saldoTotal)

export type FiltroDeuda = 'deuda' | 'vencidos' | 'mora'

/** Zonas con al menos un cliente que debe, alfabéticas (las sin localidad no cuentan). */
export const zonasDe = (filas: FilaDeuda[]): string[] =>
  [...new Set(filas.map((f) => f.localidad).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

/**
 * Filtra por estado, zona y texto. OJO con el orden de las condiciones: hasta el
 * 2026-09-13 el filtro de mora se salteaba cuando el buscador estaba vacío (un
 * `return` temprano salía antes de aplicarlo) y "En mora" mostraba todos los
 * vencidos. Acá cada filtro se aplica siempre, sin atajos.
 */
export function filtrarFilas(
  filas: FilaDeuda[],
  f: { estado?: FiltroDeuda; zona?: string; coincide?: (fila: FilaDeuda) => boolean },
): FilaDeuda[] {
  const estado = f.estado ?? 'deuda'
  return filas.filter((fila) => {
    if (estado === 'vencidos' && fila.diasAtraso <= 0) return false
    if (estado === 'mora' && fila.nivel === 'ok') return false
    if (f.zona && fila.localidad !== f.zona) return false
    if (f.coincide && !f.coincide(fila)) return false
    return true
  })
}

export interface ConteosDeuda { deuda: number; vencidos: number; mora: number }

export const conteosDe = (filas: FilaDeuda[]): ConteosDeuda => ({
  deuda: filas.length,
  vencidos: filas.filter((f) => f.diasAtraso > 0).length,
  mora: filas.filter((f) => f.nivel !== 'ok').length,
})
