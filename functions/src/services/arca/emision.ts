/**
 * Orquestación de la emisión de un comprobante, con foco en la idempotencia.
 *
 * El escenario que hay que evitar a toda costa:
 *
 *   Se pide el CAE → ARCA lo autoriza → se corta la red antes de que llegue la
 *   respuesta → creemos que falló → reintentamos con el mismo número → ARCA
 *   rechaza por no correlativo, o peor, se emite un duplicado.
 *
 * Un comprobante duplicado no es un bug que se arregla borrando: existe para
 * ARCA y se corrige con una nota de crédito. Por eso la regla de oro acá es
 * **nunca reintentar a ciegas**: ante cualquier duda se pregunta primero con
 * FECompConsultar quién tiene razón.
 *
 * De ahí que el resultado tenga tres estados y no dos. "Incierto" no es un
 * error: es la respuesta honesta cuando no sabemos, y obliga a resolver antes
 * de seguir emitiendo.
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md.
 */

import type { FECAEDetRequest, DatosComprobante, OpcionesCalculo } from './comprobante'
import { construirDetalle, validarVentanaEmision } from './comprobante'
import type { ResultadoCae, ComprobanteConsultado, ObservacionArca } from './wsfev1'
import { ArcaError } from './wsfev1'
import type { DbLike, ClaveNumeracion } from './numeracion'
import { reservarNumero, marcarNumeroLibre } from './numeracion'

/**
 * Lo que la emisión necesita de ARCA. Se inyecta para poder testear el flujo
 * completo —incluidos los cortes de red— sin tocar la red.
 */
export interface PuertoArca {
  solicitarCae(ptoVta: number, cbteTipo: number, detalle: FECAEDetRequest): Promise<ResultadoCae>
  consultarComprobante(ptoVta: number, cbteTipo: number, numero: number): Promise<ComprobanteConsultado>
}

export type ResultadoEmision =
  | {
      estado: 'emitido'
      numero: number
      cbteTipo: number
      cae: string
      caeFchVto: string | null
      observaciones: ObservacionArca[]
    }
  | {
      estado: 'rechazado'
      numero: number
      cbteTipo: number
      /** El número se devolvió al pozo: se confirmó que ARCA no lo autorizó. */
      numeroLiberado: boolean
      motivo: string
    }
  | {
      estado: 'incierto'
      numero: number
      cbteTipo: number
      /**
       * No sabemos si ARCA autorizó o no. El número queda CONSUMIDO a propósito
       * hasta que `resolverIncierto` averigüe qué pasó. Nunca reintentar con
       * este número sin resolver primero.
       */
      motivo: string
    }

export interface OpcionesEmision {
  db: DbLike
  arca: PuertoArca
  ptoVta: number
  datos: DatosComprobante
  calculo: OpcionesCalculo
  /** Inyectable para testear la ventana de fechas. */
  ahora?: Date
  /**
   * Se llama con el número apenas queda reservado, ANTES de hablar con ARCA.
   *
   * Sirve para dejar constancia persistente de qué número se está por usar. Sin
   * esto, si el proceso muere entre la reserva y la respuesta de ARCA, nadie
   * sabe qué número quedó en el aire: no se puede consultar si se emitió ni
   * liberarlo. Con esto, la reconciliación tiene por dónde empezar.
   *
   * Si falla, se aborta antes de llamar a ARCA y se libera el número: es
   * preferible no emitir a emitir sin poder rastrearlo.
   */
  onNumeroReservado?: (numero: number, cbteTipo: number) => Promise<void>
}

/**
 * Emite un comprobante: reserva número, pide el CAE y resuelve el resultado.
 *
 * Ojo con el orden: el número se reserva ANTES de llamar a ARCA, porque una vez
 * que la llamada sale ya puede haber consumido esa numeración. Reservar después
 * dejaría una ventana en la que dos ventas simultáneas mandan el mismo número.
 */
export async function emitirComprobante(opts: OpcionesEmision): Promise<ResultadoEmision> {
  const { db, arca, ptoVta, datos, calculo } = opts
  const ahora = opts.ahora ?? new Date()

  // 1. Chequeos que no cuestan nada y evitan quemar un número al pedo.
  const ventana = validarVentanaEmision(datos.fechaVenta, ahora)
  if (!ventana.valida) {
    throw new Error(`No se puede emitir: ${ventana.motivo}`)
  }

  // construirDetalle valida al receptor y tira si no es facturable.
  // Se hace con un número provisorio para no reservar antes de saber si es viable.
  const { cbteTipo } = construirDetalle({ ...datos, numeroComprobante: 1 }, calculo)
  const clave: ClaveNumeracion = { ptoVta, cbteTipo }

  // 2. Recién ahora se toma un número.
  const numero = await reservarNumero(db, clave)

  // 3. Dejar rastro del número ANTES de que salga la llamada. Si esto falla, se
  //    devuelve el número y no se emite: un comprobante que no podemos rastrear
  //    es peor que uno que no existe.
  if (opts.onNumeroReservado) {
    try {
      await opts.onNumeroReservado(numero, cbteTipo)
    } catch (e) {
      await marcarNumeroLibre(db, clave, numero)
      throw new Error(
        `No se pudo registrar el número ${numero} antes de emitir, se abortó sin llamar a ARCA: ` +
        `${(e as Error).message}`,
      )
    }
  }

  const { detalle } = construirDetalle({ ...datos, numeroComprobante: numero }, calculo)

  // 4. La llamada que puede dejarnos sin saber qué pasó.
  try {
    const r = await arca.solicitarCae(ptoVta, cbteTipo, detalle)
    return {
      estado: 'emitido',
      numero,
      cbteTipo,
      cae: r.cae!,
      caeFchVto: r.caeFchVto,
      observaciones: r.observaciones,
    }
  } catch (e) {
    const esRechazoDeArca = e instanceof ArcaError
    const motivo = (e as Error).message

    if (!esRechazoDeArca) {
      // Falla de red o timeout: ARCA pudo haber autorizado igual. No se libera
      // el número ni se reintenta — se marca incierto y se resuelve aparte.
      return { estado: 'incierto', numero, cbteTipo, motivo }
    }

    // ARCA respondió rechazando. Eso normalmente significa que el comprobante
    // NO existe y el número puede reutilizarse. Pero antes de liberarlo se
    // confirma: si por algún motivo sí quedó autorizado, liberar el número
    // terminaría generando un duplicado más adelante.
    try {
      const consulta = await arca.consultarComprobante(ptoVta, cbteTipo, numero)
      if (consulta.existe) {
        return {
          estado: 'emitido',
          numero,
          cbteTipo,
          cae: consulta.cae!,
          caeFchVto: consulta.caeFchVto ?? null,
          observaciones: [],
        }
      }
      await marcarNumeroLibre(db, clave, numero)
      return { estado: 'rechazado', numero, cbteTipo, numeroLiberado: true, motivo }
    } catch {
      // No se pudo confirmar. Se prefiere dejar el número consumido (un hueco
      // se resuelve después) antes que arriesgar un duplicado.
      return { estado: 'rechazado', numero, cbteTipo, numeroLiberado: false, motivo }
    }
  }
}

/**
 * Averigua qué pasó con un comprobante que quedó en estado incierto.
 *
 * Es lo único que se puede hacer con un 'incierto': preguntarle a ARCA. Si el
 * comprobante existe, se recupera su CAE; si no existe, el número vuelve al
 * pozo y la venta se puede volver a emitir.
 *
 * Pensado para correrse desde un job de reconciliación, no en el camino de la
 * venta: si ARCA sigue sin responder, se reintenta más tarde.
 */
export async function resolverIncierto(
  db: DbLike,
  arca: PuertoArca,
  ptoVta: number,
  cbteTipo: number,
  numero: number,
): Promise<ResultadoEmision> {
  const consulta = await arca.consultarComprobante(ptoVta, cbteTipo, numero)

  if (consulta.existe) {
    return {
      estado: 'emitido',
      numero,
      cbteTipo,
      cae: consulta.cae!,
      caeFchVto: consulta.caeFchVto ?? null,
      observaciones: [],
    }
  }

  await marcarNumeroLibre(db, { ptoVta, cbteTipo }, numero)
  return {
    estado: 'rechazado',
    numero,
    cbteTipo,
    numeroLiberado: true,
    motivo: 'ARCA confirma que el comprobante no fue autorizado; el número se liberó',
  }
}
