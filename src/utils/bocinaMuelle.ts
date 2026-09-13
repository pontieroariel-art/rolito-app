/**
 * Sonidos de aviso del TV del muelle (2026-09-13).
 *
 * El muelle tiene MUCHO ruido ambiente (máquinas, autoelevadores, cámara), así
 * que esto no es una campanita de escritorio: tiene que cortar el ruido y
 * escucharse a diez metros. Hay varias opciones porque lo que funciona en una
 * planta molesta en otra, y la única forma de saberlo es probarlas ahí, con el
 * ruido real — el TV trae un botón para escucharlas.
 *
 * Todo se genera con Web Audio (sin archivos que descargar ni que se pierdan al
 * quedar el TV sin señal). La elección se guarda por dispositivo, no por
 * usuario: es una propiedad del televisor, como el volumen del aparato.
 *
 * Cómo se leen los parámetros:
 *  - `square`/`sawtooth` traen armónicos y atraviesan el ruido; `sine` es suave
 *    y se pierde entre máquinas.
 *  - 1000-1500 Hz es la zona donde el oído es más sensible.
 *  - `gain` alto (0.9) porque el TV suele estar lejos y con el volumen del
 *    aparato a media asta.
 */

export type SonidoMuelle = 'industrial' | 'timbre' | 'campana' | 'sirena' | 'chicharra'

export interface OpcionSonido {
  id:     SonidoMuelle
  nombre: string
  /** Para qué sirve / cuándo conviene, en criollo. */
  detalle: string
}

export const SONIDOS: OpcionSonido[] = [
  { id: 'industrial', nombre: 'Industrial', detalle: 'Tres ráfagas duras. La más penetrante, corta cualquier ruido de máquina.' },
  { id: 'timbre',     nombre: 'Timbre de fábrica', detalle: 'Dos tonos alternados, más grave. Se escucha fuerte sin ser molesto.' },
  { id: 'campana',    nombre: 'Campana', detalle: 'Un gong que se apaga solo. Elegante, pero se pierde con mucho ruido.' },
  { id: 'sirena',     nombre: 'Sirena corta', detalle: 'Barrido de grave a agudo, dos veces. Llama la atención sin ser alarma de incendio.' },
  { id: 'chicharra',  nombre: 'Chicharra', detalle: 'Zumbido grave y seco, dos toques. El más corto de todos.' },
]

const DEFECTO: SonidoMuelle = 'industrial'
const CLAVE = 'muelleTvSonido'

export const leerSonidoElegido = (): SonidoMuelle => {
  try {
    const v = localStorage.getItem(CLAVE) as SonidoMuelle | null
    return v && SONIDOS.some((s) => s.id === v) ? v : DEFECTO
  } catch { return DEFECTO }
}

export const guardarSonidoElegido = (id: SonidoMuelle): void => {
  try { localStorage.setItem(CLAVE, id) } catch { /* el TV puede tener el storage bloqueado: vale para esta sesión */ }
}

/** Un pulso: tipo de onda, frecuencia (o barrido), cuándo empieza y cuánto dura. */
function pulso(
  ctx: AudioContext,
  { tipo, desde, hasta, inicio, dur, vol = 0.9 }:
  { tipo: OscillatorType; desde: number; hasta?: number; inicio: number; dur: number; vol?: number },
) {
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = tipo
  osc.frequency.setValueAtTime(desde, inicio)
  if (hasta && hasta !== desde) osc.frequency.linearRampToValueAtTime(hasta, inicio + dur)
  // Ataque rápido y caída exponencial: un corte seco "clickea" en los parlantes.
  gain.gain.setValueAtTime(0.0001, inicio)
  gain.gain.exponentialRampToValueAtTime(vol, inicio + 0.02)
  gain.gain.setValueAtTime(vol, inicio + dur * 0.85)
  gain.gain.exponentialRampToValueAtTime(0.0001, inicio + dur)
  osc.connect(gain).connect(ctx.destination)
  osc.start(inicio)
  osc.stop(inicio + dur + 0.05)
}

/** Toca el sonido elegido. Sin AudioContext armado no hace nada. */
export function tocarSonido(ctx: AudioContext | null, id: SonidoMuelle): void {
  if (!ctx) return
  const t = ctx.currentTime
  switch (id) {
    // 3 ráfagas de onda cuadrada alternando 1000/1500 Hz, dos osciladores por
    // ráfaga para que suene más grueso. ~1,8 s.
    case 'industrial':
      for (let r = 0; r < 3; r++) {
        const inicio = t + r * 0.65
        ;[1000, 1500].forEach((f) => pulso(ctx, { tipo: 'square', desde: f, inicio, dur: 0.45 }))
      }
      break
    // Dos tonos alternados, más graves: el "ring" de un timbre de portón.
    case 'timbre':
      for (let r = 0; r < 4; r++) {
        pulso(ctx, { tipo: 'square', desde: r % 2 ? 660 : 880, inicio: t + r * 0.28, dur: 0.22, vol: 0.8 })
      }
      break
    // Gong: fundamental + dos armónicos que caen juntos.
    case 'campana':
      [523, 1047, 1568].forEach((f, i) => {
        pulso(ctx, { tipo: 'sine', desde: f, inicio: t, dur: 1.8 - i * 0.4, vol: 0.9 - i * 0.25 })
      })
      pulso(ctx, { tipo: 'sine', desde: 523, inicio: t + 0.9, dur: 1.4, vol: 0.6 })
      break
    // Barrido de 600 a 1600 Hz, dos veces: sirena corta, no alarma de incendio.
    case 'sirena':
      for (let r = 0; r < 2; r++) {
        pulso(ctx, { tipo: 'sawtooth', desde: 600, hasta: 1600, inicio: t + r * 0.75, dur: 0.6, vol: 0.85 })
      }
      break
    // Zumbido grave y seco, dos toques. El más corto.
    case 'chicharra':
      for (let r = 0; r < 2; r++) {
        pulso(ctx, { tipo: 'sawtooth', desde: 220, inicio: t + r * 0.45, dur: 0.3, vol: 0.9 })
        pulso(ctx, { tipo: 'square',   desde: 110, inicio: t + r * 0.45, dur: 0.3, vol: 0.5 })
      }
      break
  }
}
