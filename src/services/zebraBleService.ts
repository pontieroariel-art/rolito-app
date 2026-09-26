/// <reference types="web-bluetooth" />
// Impresora Zebra por Bluetooth de bajo consumo desde el navegador
// (2026-09-14). La ZD421 de planta está emparejada por Bluetooth con la
// tablet; con Web Bluetooth (Chrome en Android) la app le manda ZPL directo
// y el ticket sale sin el diálogo de impresión de Android.
//
// Las impresoras Link-OS exponen el "Zebra Parser Service": todo lo que se
// escribe en su característica de escritura va derecho al intérprete de ZPL.
// Zebra lo documenta como parte del SDK Link-OS para BLE.
//
// Cómo se usa: `conectarImpresora()` desde un toque del operario (Chrome
// exige un gesto para elegir el dispositivo), después `imprimirZpl(...)` las
// veces que haga falta. Si la impresora se desconecta (se apaga, se aleja),
// la próxima impresión intenta reconectar sola. `suscribirImpresora` avisa
// el estado a la pantalla.
import { reportError } from './observability'

export type EstadoImpresora = 'sin_soporte' | 'desconectada' | 'conectando' | 'conectada' | 'imprimiendo'

export interface InfoImpresora { estado: EstadoImpresora; nombre: string | null }

const SERVICIO_PARSER   = '38eb4a80-c570-11e3-9507-0002a5d5c51b'
const CARACT_ESCRITURA  = '38eb4a82-c570-11e3-9507-0002a5d5c51b'
/** Tamaño de cada escritura BLE; si la impresora rechaza el chunk se baja a 20. */
const CHUNK_GRANDE = 100
const CHUNK_CHICO  = 20
const KEY_DISPOSITIVO = 'zebraBleDeviceId'

let dispositivo: BluetoothDevice | null = null
let escritura: BluetoothRemoteGATTCharacteristic | null = null
let estado: EstadoImpresora = 'desconectada'
let chunk = CHUNK_GRANDE
const oyentes = new Set<(info: InfoImpresora) => void>()

export const soportaBluetooth = (): boolean =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator && typeof navigator.bluetooth?.requestDevice === 'function'

function info(): InfoImpresora {
  return { estado: soportaBluetooth() ? estado : 'sin_soporte', nombre: dispositivo?.name ?? null }
}

function avisar(nuevo: EstadoImpresora): void {
  estado = nuevo
  const i = info()
  oyentes.forEach((cb) => cb(i))
}

export function suscribirImpresora(cb: (info: InfoImpresora) => void): () => void {
  oyentes.add(cb)
  cb(info())
  return () => { oyentes.delete(cb) }
}

export const impresoraConectada = (): boolean => estado === 'conectada' || estado === 'imprimiendo'

function alDesconectar(): void {
  escritura = null
  if (estado !== 'conectando') avisar('desconectada')
}

async function abrirGatt(dev: BluetoothDevice): Promise<void> {
  avisar('conectando')
  try {
    const gatt = await dev.gatt!.connect()
    const servicio = await gatt.getPrimaryService(SERVICIO_PARSER)
    escritura = await servicio.getCharacteristic(CARACT_ESCRITURA)
    dev.removeEventListener('gattserverdisconnected', alDesconectar)
    dev.addEventListener('gattserverdisconnected', alDesconectar)
    dispositivo = dev
    try { localStorage.setItem(KEY_DISPOSITIVO, dev.id) } catch { /* sin localStorage: se vuelve a elegir la próxima vez */ }
    avisar('conectada')
  } catch (err) {
    escritura = null
    avisar('desconectada')
    throw err
  }
}

/**
 * ¿Esta tablet ya eligió una impresora alguna vez? (2026-09-25) Si sí, una
 * etiqueta que no pudo salir espera a que la Zebra vuelva, en vez de abrir el
 * diálogo de impresión de Android.
 */
export function hayImpresoraGuardada(): boolean {
  if (!soportaBluetooth()) return false
  try { return !!localStorage.getItem(KEY_DISPOSITIVO) } catch { return false }
}

/** Elegir la impresora (abre el selector de Chrome; necesita un toque del operario). */
export async function conectarImpresora(): Promise<void> {
  if (!soportaBluetooth()) throw new Error('Este navegador no tiene Bluetooth web. Usá Chrome en la tablet.')
  const dev = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICIO_PARSER] }],
    optionalServices: [SERVICIO_PARSER],
  })
  await abrirGatt(dev)
}

/**
 * Volver a la impresora ya elegida sin abrir el selector (al recargar la
 * app). Devuelve false si Chrome no lo permite o la impresora no está.
 */
export async function reconectarImpresoraGuardada(): Promise<boolean> {
  if (!soportaBluetooth() || typeof navigator.bluetooth.getDevices !== 'function') return false
  let id: string | null = null
  try { id = localStorage.getItem(KEY_DISPOSITIVO) } catch { return false }
  if (!id) return false
  try {
    const dev = (await navigator.bluetooth.getDevices()).find((d) => d.id === id)
    if (!dev) return false
    await abrirGatt(dev)
    return true
  } catch (err) {
    // Sin la impresora a mano no es un error: se conecta al primer toque.
    reportError(err, { origen: 'zebraBle.reconectar', silencioso: true })
    return false
  }
}

async function escribirTodo(datos: Uint8Array<ArrayBuffer>): Promise<void> {
  if (!escritura) throw new Error('Impresora sin conectar.')
  for (let i = 0; i < datos.length; i += chunk) {
    const parte = datos.subarray(i, i + chunk)
    try {
      await escritura.writeValueWithResponse(parte)
    } catch (err) {
      // Algunas pilas BLE viejas no negocian MTU: reintentar en partes de 20.
      if (chunk === CHUNK_GRANDE) {
        chunk = CHUNK_CHICO
        for (let j = i; j < datos.length; j += chunk) await escritura.writeValueWithResponse(datos.subarray(j, j + chunk))
        return
      }
      throw err
    }
  }
}

/** Manda una etiqueta ZPL. Reintenta la conexión una vez si se cayó. */
export async function imprimirZpl(zpl: string): Promise<void> {
  if (!dispositivo) throw new Error('Impresora sin conectar.')
  if (!escritura || !dispositivo.gatt?.connected) await abrirGatt(dispositivo)
  avisar('imprimiendo')
  try {
    // Copia a un buffer propio: TextEncoder devuelve Uint8Array<ArrayBufferLike>
    // y la API BLE exige ArrayBuffer estricto.
    await escribirTodo(new Uint8Array(new TextEncoder().encode(zpl)))
    avisar('conectada')
  } catch (err) {
    escritura = null
    avisar('desconectada')
    throw err
  }
}

export async function desconectarImpresora(): Promise<void> {
  try { dispositivo?.gatt?.disconnect() } catch { /* ya estaba cerrada */ }
  escritura = null
  dispositivo = null
  try { localStorage.removeItem(KEY_DISPOSITIVO) } catch { /* nada */ }
  avisar('desconectada')
}
