// Estado de la liquidación de un viaje (2026-09-18).
//
// Un viaje se cierra en DOS actos independientes, hechos por gente distinta en
// momentos distintos:
//
//   PLATA       la liquida caja, de 6 a 18   → liquidaciones/{remitoId}
//   MERCADERÍA  la cierra muelle al contar   → cierresMercaderia/{remitoId}
//
// Muelle trabaja 24 horas y caja 12, así que el camión que vuelve a las 20
// descarga sin problema pero no tiene a quién rendirle la plata. Antes eso
// obligaba a cerrar las dos cosas juntas: caja elegía entre anotar un faltante
// falso o dejar la rendición abierta. Ahora cada parte se cierra cuando puede, en
// cualquier orden, y el viaje queda CERRADO cuando están las dos.
//
// Este archivo es el único lugar donde se decide eso. Lo usan la pantalla de
// liquidación, liquidaciones abiertas, el historial, el PDF, los dos tableros en
// vivo y la tarjeta del chofer: si cada pantalla lo dedujera por su cuenta, el
// día que no coincidan nadie va a saber cuál tiene razón.

import { CierreMercaderia, Liquidacion } from '../types'

/** Una fecha que puede venir de Firestore o de un test (misma forma mínima). */
export interface ConFecha { toDate(): Date; toMillis(): number }

export interface ParteEstado {
  hecha: boolean
  en?:   ConFecha
  por?:  { uid: string; nombre: string }
}

export type EstadoViaje = 'abierta' | 'cerrada'

export interface EstadoLiquidacion {
  estado:     EstadoViaje
  plata:      ParteEstado
  mercaderia: ParteEstado
  /** Cuándo quedó cerrada: la más tardía de las dos partes. Ausente si falta alguna. */
  cerradaEn?: ConFecha
  /** Qué falta, en palabras, para mostrarlo sin que cada pantalla lo redacte. */
  falta:      'nada' | 'plata' | 'mercaderia' | 'ambas'
}

/**
 * El estado de un viaje a partir de sus dos mitades. Cualquiera de las dos puede
 * faltar, y el orden entre ellas no importa.
 *
 * Los cierres anteriores al 2026-09-18 traían la mercadería adentro del mismo
 * doc (`Liquidacion.productos`): esos cuentan como cerrados enteros, porque en
 * su momento se cerraron las dos cosas de una.
 */
export function estadoDelViaje(
  plata:      Pick<Liquidacion, 'createdAt' | 'cerradaPor' | 'productos'> | null | undefined,
  mercaderia: Pick<CierreMercaderia, 'contadaEn' | 'contadaPor'> | null | undefined,
): EstadoLiquidacion {
  const hayPlata = !!plata
  // Un cierre viejo ya traía la mercadería adentro; no se le puede exigir un doc
  // que no existía cuando se firmó.
  const mercaderiaEnElCierreViejo = !!plata?.productos?.length && !mercaderia
  const hayMercaderia = !!mercaderia || mercaderiaEnElCierreViejo

  const parteDePlata: ParteEstado = hayPlata
    ? { hecha: true, en: plata!.createdAt, por: plata!.cerradaPor }
    : { hecha: false }

  const parteDeMercaderia: ParteEstado = mercaderia
    ? { hecha: true, en: mercaderia.contadaEn, por: mercaderia.contadaPor }
    : mercaderiaEnElCierreViejo
      ? { hecha: true, en: plata!.createdAt, por: plata!.cerradaPor }
      : { hecha: false }

  const cerrada = hayPlata && hayMercaderia
  const falta: EstadoLiquidacion['falta'] =
    cerrada ? 'nada' : !hayPlata && !hayMercaderia ? 'ambas' : !hayPlata ? 'plata' : 'mercaderia'

  return {
    estado: cerrada ? 'cerrada' : 'abierta',
    plata: parteDePlata,
    mercaderia: parteDeMercaderia,
    falta,
    ...(cerrada ? { cerradaEn: masTardia(parteDePlata.en, parteDeMercaderia.en) } : {}),
  }
}

const masTardia = (a?: ConFecha, b?: ConFecha): ConFecha | undefined => {
  if (!a) return b
  if (!b) return a
  return a.toMillis() >= b.toMillis() ? a : b
}

/** Texto corto de lo que falta, para chips y tarjetas. */
export function describirEstado(e: EstadoLiquidacion): string {
  switch (e.falta) {
    case 'nada':       return 'Cerrada'
    case 'plata':      return 'Falta liquidar la plata'
    case 'mercaderia': return 'Falta contar la mercadería'
    case 'ambas':      return 'Sin liquidar'
  }
}

/**
 * La clave con la que se guardan las dos mitades de un viaje. Los cobradores y
 * supervisores no tienen camión ni viaje: su plata se sigue rindiendo por día,
 * con la clave vieja.
 */
export const claveDeViaje = (remitoId: string): string => remitoId
export const claveDeDia = (fecha: string, sujetoId: string): string => `${fecha}_${sujetoId}`
