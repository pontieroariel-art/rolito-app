// El buzón de sobres de la vuelta nocturna (2026-09-18).
//
// Muelle trabaja 24 horas y caja de 6 a 18. El chofer que vuelve a las 20
// descarga sin problema, pero no tiene a quién entregarle la plata: deja el
// sobre en el buzón con el código de la descarga escrito a mano y se va. Caja lo
// abre a la mañana y lo liquida contra lo que la app dice que ese viaje tenía
// que cobrar.
//
// Lo que importa de esta pantalla no es lo que está: es lo que FALTA. Un sobre
// esperado que no aparece es el único control real sobre la plata de la noche,
// así que la lista arranca por ahí.
//
// Puro: la pantalla le pasa los viajes con mercadería contada y las
// liquidaciones de plata que ya existen.

import type { CierreMercaderia, Liquidacion } from '../types'

/** Horas a partir de las cuales un sobre esperado deja de ser "de anoche" y pasa a faltar. */
export const HORAS_PARA_RECLAMAR = 18

export type EstadoSobreBuzon = 'esperado' | 'sin_aparecer' | 'recibido'

export interface SobreEsperado {
  remitoId:       string
  remitoCodigo:   string
  descargaCodigo: string
  choferId:       string
  choferNombre:   string
  plantaId:       CierreMercaderia['plantaId']
  diaReparto:     string
  /** Cuándo muelle contó la descarga: desde ahí se espera el sobre. */
  contadaEn:      { toDate(): Date; toMillis(): number }
  horas:          number
  estado:         EstadoSobreBuzon
  /** La liquidación de plata, cuando caja ya lo abrió y lo liquidó. */
  liquidacion:    Liquidacion | null
}

export interface ResumenBuzon {
  sinAparecer: SobreEsperado[]
  esperados:   SobreEsperado[]
  recibidos:   SobreEsperado[]
  /** Para el aviso: choferes con dos o más sobres sin liquidar. Avisa, nunca frena. */
  conArrastre: { choferId: string; choferNombre: string; pendientes: number }[]
}

/**
 * Cruza los viajes con mercadería contada contra las liquidaciones de plata que
 * existen. Un viaje contado sin plata liquidada es un sobre que tiene que estar
 * en el buzón.
 */
export function armarBuzon(
  cierres: CierreMercaderia[],
  liquidaciones: Map<string, Liquidacion>,
  ahora: Date = new Date(),
  horasParaReclamar = HORAS_PARA_RECLAMAR,
): ResumenBuzon {
  const filas: SobreEsperado[] = cierres.map((c) => {
    const liquidacion = liquidaciones.get(c.remitoId) ?? null
    const horas = (ahora.getTime() - c.contadaEn.toMillis()) / 3_600_000
    return {
      remitoId:       c.remitoId,
      remitoCodigo:   c.remitoCodigo,
      descargaCodigo: c.descargaCodigos[0] ?? '',
      choferId:       c.choferId,
      choferNombre:   c.choferNombre,
      plantaId:       c.plantaId,
      diaReparto:     c.diaReparto,
      contadaEn:      c.contadaEn,
      horas,
      estado:         liquidacion ? 'recibido' : horas >= horasParaReclamar ? 'sin_aparecer' : 'esperado',
      liquidacion,
    }
  })

  // El más viejo primero en lo que falta: es el que hay que ir a buscar.
  const porAntiguedad = (a: SobreEsperado, b: SobreEsperado) => b.horas - a.horas
  // En lo recibido, lo último primero: es el trabajo recién hecho.
  const porReciente = (a: SobreEsperado, b: SobreEsperado) => a.horas - b.horas

  const pendientes = filas.filter((f) => !f.liquidacion)
  const porChofer = new Map<string, { choferId: string; choferNombre: string; pendientes: number }>()
  for (const f of pendientes) {
    const e = porChofer.get(f.choferId)
    if (e) e.pendientes++
    else porChofer.set(f.choferId, { choferId: f.choferId, choferNombre: f.choferNombre, pendientes: 1 })
  }

  return {
    sinAparecer: filas.filter((f) => f.estado === 'sin_aparecer').sort(porAntiguedad),
    esperados:   filas.filter((f) => f.estado === 'esperado').sort(porAntiguedad),
    recibidos:   filas.filter((f) => f.estado === 'recibido').sort(porReciente),
    // Lo normal es tener uno: la vuelta de anoche, que se liquida a la mañana.
    // Dos significa que hay un sobre arrastrado de un día para el otro.
    conArrastre: [...porChofer.values()].filter((c) => c.pendientes >= 2).sort((a, b) => b.pendientes - a.pendientes),
  }
}

/**
 * Buscar un sobre por lo que el chofer escribió a mano. Acepta el código de la
 * descarga o el del remito, con o sin prefijo, porque a las 4 de la mañana nadie
 * copia un código completo sin equivocarse.
 */
export function buscarSobre(filas: SobreEsperado[], texto: string): SobreEsperado[] {
  const limpio = texto.trim().toUpperCase().replace(/[\s-]/g, '')
  if (!limpio) return filas
  const coincide = (v: string) => v.toUpperCase().replace(/[\s-]/g, '').includes(limpio)
  return filas.filter((f) => coincide(f.descargaCodigo) || coincide(f.remitoCodigo) || coincide(f.choferNombre))
}
