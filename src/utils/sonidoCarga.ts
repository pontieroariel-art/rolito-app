// Sonidos de la tablet de carga de pallets: timbre "Cristal" (2026-09-25,
// elegido por Ariel entre varias opciones).
//
// En planta hay ruido y la tablet suele estar apoyada: la vibración no se
// siente y el operario no siempre mira la pantalla. Tres sonidos de campana
// generados con Web Audio, sin archivos (funciona sin señal):
//   - 'ok':        Mi6 → Si6 subiendo, el pallet quedó cargado;
//   - 'duplicado': Sol6 dos veces, la ventana pregunta "¿Otro pallet de…?";
//   - 'error':     Mi5 → Si4 bajando, no se pudo cargar o la etiqueta espera
//                  a la impresora.
// El sonido es un plus, nunca la única señal: la pantalla siempre muestra lo
// mismo. La vibración la pone la pantalla (utils/tacto).
//
// El navegador solo deja sonar después de un toque: `desbloquearAudio` se
// llama en el primer toque de la pantalla.

export type SonidoCarga = 'ok' | 'error' | 'duplicado'
type Parcial = [multiplicador: number, ganancia: number]

type ConAudioViejo = typeof globalThis & { webkitAudioContext?: typeof AudioContext }
type NavegadorConSesionAudio = Navigator & { audioSession?: { type: string } }

const VOLUMEN = 0.8 // 0 a 1

let ctx: AudioContext | null = null
let master: GainNode | null = null

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = globalThis.AudioContext ?? (globalThis as ConAudioViejo).webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
      // iOS/Safari 17+: que suene aunque el teléfono esté en silencio.
      const nav = navigator as NavegadorConSesionAudio
      if (nav.audioSession) nav.audioSession.type = 'playback'

      // Cadena: master → compresor → salida, con un eco corto para dar cuerpo.
      const comp = ctx.createDynamicsCompressor()
      master = ctx.createGain()
      master.gain.value = VOLUMEN

      const delay = ctx.createDelay()
      delay.delayTime.value = 0.13
      const feedbackGain = ctx.createGain()
      feedbackGain.gain.value = 0.22
      const wet = ctx.createGain()
      wet.gain.value = 0.18
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 3500

      master.connect(comp)
      master.connect(delay)
      delay.connect(lp)
      lp.connect(feedbackGain)
      feedbackGain.connect(delay)
      lp.connect(wet)
      wet.connect(comp)
      comp.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Llamar en el primer toque del operario: los navegadores bloquean el audio hasta entonces. */
export function desbloquearAudio(): void {
  const c = getCtx()
  if (!c) return
  try {
    const buf = c.createBuffer(1, 1, 22050)
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.start(0)
  } catch { /* sin audio: la pantalla ya lo muestra */ }
}

// Timbre de campana: fundamental + armónicos 2x y 3x.
const CAMPANA: Parcial[] = [[1, 1], [2, 0.35], [3.01, 0.15]]

function nota(c: AudioContext, freq: number, inicio: number, dur: number, tipo: OscillatorType = 'sine', vol = 0.5): void {
  if (!master) return
  const t0 = c.currentTime + inicio
  for (const [mult, g] of CAMPANA) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = tipo
    osc.frequency.value = freq * mult
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(vol * g, t0 + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / Math.pow(mult, 0.3))
    osc.connect(gain).connect(master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }
}

const PATRONES: Record<SonidoCarga, (c: AudioContext) => void> = {
  ok:        (c) => { nota(c, 1318.5, 0, 0.5); nota(c, 1975.5, 0.09, 0.7) },
  duplicado: (c) => { nota(c, 1568, 0, 0.35, 'sine', 0.4); nota(c, 1568, 0.16, 0.4, 'sine', 0.4) },
  error:     (c) => { nota(c, 659.3, 0, 0.4, 'triangle'); nota(c, 493.9, 0.14, 0.6, 'triangle') },
}

/** Toca el sonido. Nunca tira error: un fallo de audio jamás frena la carga. */
export function sonar(tipo: SonidoCarga): void {
  const c = getCtx()
  if (!c) return
  try { PATRONES[tipo](c) } catch { /* sin audio, seguimos */ }
}
