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

export type SonidoMuelle =
  | 'industrial' | 'timbre' | 'campana' | 'sirena' | 'chicharra'
  | 'anden' | 'ping' | 'retorno' | 'demora'

export interface OpcionSonido {
  id:     SonidoMuelle
  nombre: string
  /** Para qué sirve / cuándo conviene, en criollo. */
  detalle: string
  /** El evento para el que fue pensado (los "fuertes" sirven para cualquiera). */
  para?:  string
}

export const SONIDOS: OpcionSonido[] = [
  // Pensados por EVENTO (2026-09-13): que el muelle sepa QUÉ pasó sin mirar la
  // pantalla. Un tablero con un solo sonido obliga a levantar la vista siempre.
  { id: 'anden',   nombre: 'Campana de andén', para: 'Llamado a dársena o ventanilla',
    detalle: 'Acorde de tres notas que se apaga solo, como el de una estación o un aeropuerto.' },
  { id: 'ping',    nombre: 'Ping de logística', para: 'Confirmación o asignación',
    detalle: 'Doble pulso agudo y rápido. Dice "listo" sin interrumpir a nadie.' },
  { id: 'retorno', nombre: 'Retorno de camión', para: 'Volvió y falta contarlo',
    detalle: 'Dos tonos graves y secos. Avisa sin sobresaltar: el camión ya está en casa.' },
  { id: 'demora',  nombre: 'Demora en dársena', para: 'Se pasó del tiempo',
    detalle: 'Advertencia suave de tres pulsos. Marca que algo se está estirando, sin gritar.' },
  // Los fuertes: para cuando hay que cortar el ruido de las máquinas.
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

    // ── Por evento ──
    // Campana de andén: acorde de Fa mayor (F5-A5-C6) con las notas entrando
    // escalonadas y una cola larga, como el aviso de una estación. Limpio a
    // propósito: es un llamado a una persona, no una alarma.
    case 'anden':
      [698.46, 880, 1046.5].forEach((f, i) => {
        pulso(ctx, { tipo: 'sine', desde: f, inicio: t + i * 0.06, dur: 2.2 - i * 0.3, vol: 0.85 - i * 0.12 })
      })
      // Segundo golpe del acorde, más flojo: el "din-don" de andén.
      ;[698.46, 1046.5].forEach((f, i) => {
        pulso(ctx, { tipo: 'sine', desde: f, inicio: t + 0.55 + i * 0.05, dur: 1.6, vol: 0.55 - i * 0.1 })
      })
      break
    // Ping de logística: dos pulsos cortos que suben una octava (880 → 1760).
    // Dice "hecho" y se va; no interrumpe una conversación.
    case 'ping':
      pulso(ctx, { tipo: 'triangle', desde: 880,  inicio: t,        dur: 0.09, vol: 0.75 })
      pulso(ctx, { tipo: 'triangle', desde: 1760, inicio: t + 0.11, dur: 0.14, vol: 0.8 })
      break
    // Retorno de camión: dos tonos que BAJAN (440 → 330), secos y sin brillo.
    // Un sonido descendente se lee como "algo llegó y se detuvo", que es
    // exactamente lo que pasó; no sobresalta a nadie.
    case 'retorno':
      pulso(ctx, { tipo: 'triangle', desde: 440, inicio: t,        dur: 0.2, vol: 0.85 })
      pulso(ctx, { tipo: 'triangle', desde: 330, inicio: t + 0.24, dur: 0.28, vol: 0.85 })
      break
    // Demora en dársena: tres pulsos iguales, medios y suaves. Repetir sin
    // subir de tono marca insistencia sin sonar a emergencia — es un recordatorio,
    // y si suena a alarma la gente lo termina apagando.
    case 'demora':
      for (let r = 0; r < 3; r++) {
        pulso(ctx, { tipo: 'sine', desde: 587.33, inicio: t + r * 0.22, dur: 0.13, vol: 0.6 })
      }
      break
  }
}
