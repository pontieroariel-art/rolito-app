import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { enviarComprobantePorMail } from './envioComprobanteService'
import { getEmailClienteTango } from './tangoComprobantesService'
import { caiRemitoOficialCacheado, getCaiRemitoOficial } from './remitoOficialConfigService'
import { generarComprobanteVenta } from '@/utils/comprobanteDeVenta'
import { comprobanteListoParaMail, mailDeVenta } from '@/utils/mailDeVenta'
import type { VentaCamion } from '@/types'

// Envío automático del comprobante al cliente al registrar la venta del
// camión (2026-09-11, pedido de Ariel: "los remitos emitidos al momento de la
// venta deben enviarse automáticamente al mail del cliente registrado en
// Tango"). El PDF se arma en el teléfono (como en Mis ventas) y sale por la
// misma Cloud Function del envío manual, que anota `envioMail` en la venta y
// no manda dos veces. Corre sobre las ventas recientes del propio chofer cada
// vez que cambian (nueva venta, llegó el CAE, volvió la señal): sin señal
// espera, y si el cliente no tiene mail en Tango lo recuerda en el teléfono
// para no buscarlo de nuevo. Interruptor: configuracion/notificaciones.
// mailAutomaticoVentas = false (ausente = encendido).

export type EstadoEnvioLocal = { estado: 'sin_mail' } | { estado: 'error'; intentos: number; motivo: string } | { estado: 'enviando' }

const CLAVE = 'envioAutomaticoVentas'
const MAX_INTENTOS = 3
const enviando = new Set<string>()
const mailPorCliente = new Map<string, Promise<string>>()
let habilitadoCache: { valor: boolean; en: number } | null = null

function leerLocal(): Record<string, EstadoEnvioLocal> {
  try { return JSON.parse(localStorage.getItem(CLAVE) ?? '{}') } catch { return {} }
}
function guardarLocal(ventaId: string, estado: EstadoEnvioLocal | null): void {
  try {
    const todo = leerLocal()
    if (estado) todo[ventaId] = estado; else delete todo[ventaId]
    // No crece sin límite: se quedan los últimos 300.
    const ids = Object.keys(todo)
    for (const id of ids.slice(0, Math.max(0, ids.length - 300))) delete todo[id]
    localStorage.setItem(CLAVE, JSON.stringify(todo))
  } catch { /* sin storage: se reintenta en la próxima pasada */ }
}

/** Estado local de una venta (para el chip de Mis ventas), si no hay `envioMail` en el doc. */
export function estadoEnvioLocal(ventaId: string): EstadoEnvioLocal | null {
  if (enviando.has(ventaId)) return { estado: 'enviando' }
  return leerLocal()[ventaId] ?? null
}

async function envioHabilitado(): Promise<boolean> {
  if (habilitadoCache && Date.now() - habilitadoCache.en < 5 * 60_000) return habilitadoCache.valor
  try {
    const cfg = (await getDoc(doc(db, 'configuracion', 'notificaciones'))).data()
    habilitadoCache = { valor: cfg?.mailAutomaticoVentas !== false, en: Date.now() }
  } catch {
    habilitadoCache = { valor: true, en: Date.now() }
  }
  return habilitadoCache.valor
}

function mailDelCliente(clienteId: string): Promise<string> {
  let p = mailPorCliente.get(clienteId)
  if (!p) {
    p = getEmailClienteTango(clienteId).catch(() => '')
    mailPorCliente.set(clienteId, p)
    // Un fallo de red no se cachea: se vuelve a buscar en la próxima pasada.
    p.then((e) => { if (!e) mailPorCliente.delete(clienteId) })
  }
  return p
}

/** ¿Esta venta todavía necesita que la mandemos? */
export function pendienteDeEnvio(venta: VentaCamion, local: Record<string, EstadoEnvioLocal> = leerLocal()): boolean {
  if (venta.envioMail?.estado === 'enviado') return false
  if (!venta.clienteId || !comprobanteListoParaMail(venta)) return false
  const l = local[venta.id]
  if (l?.estado === 'sin_mail') return false
  if (l?.estado === 'error' && l.intentos >= MAX_INTENTOS) return false
  return true
}

/**
 * Manda lo que falte de `ventas` (del propio chofer), de a una. Devuelve
 * cuántas mandó. Segura de llamar seguido: lo que está en curso se saltea.
 */
export async function procesarEnviosAutomaticos(ventas: VentaCamion[], opts: { online: boolean }): Promise<number> {
  if (!opts.online) return 0
  const local = leerLocal()
  const candidatas = ventas.filter((v) => pendienteDeEnvio(v, local) && !enviando.has(v.id))
  if (!candidatas.length) return 0
  if (!(await envioHabilitado())) return 0
  const cai = await getCaiRemitoOficial().catch(() => caiRemitoOficialCacheado())
  let enviadas = 0
  for (const venta of candidatas) {
    if (enviando.has(venta.id)) continue
    enviando.add(venta.id)
    try {
      const para = (await mailDelCliente(venta.clienteId)).trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) { guardarLocal(venta.id, { estado: 'sin_mail' }); continue }
      const g = await generarComprobanteVenta(venta, undefined, cai)
      if (!g.ok) { guardarLocal(venta.id, { estado: 'error', intentos: MAX_INTENTOS, motivo: g.motivo }); continue }
      const m = mailDeVenta(venta)
      await enviarComprobantePorMail({
        para, asunto: m.asunto, mensaje: m.mensaje, nombreArchivo: g.nombre, pdf: g.blob,
        comprobante: m.comprobante, clienteUid: m.clienteUid, clienteNombre: m.clienteNombre, presentacion: m.presentacion,
        venta: { coleccion: 'ventasCamion', id: venta.id }, automatico: true,
      })
      guardarLocal(venta.id, null)
      enviadas++
    } catch (err) {
      const previo = local[venta.id]
      const intentos = (previo?.estado === 'error' ? previo.intentos : 0) + 1
      guardarLocal(venta.id, { estado: 'error', intentos, motivo: err instanceof Error ? err.message : String(err) })
      if (intentos >= MAX_INTENTOS) reportError(err, { origen: 'envioAutomaticoVentas', ventaId: venta.id })
    } finally {
      enviando.delete(venta.id)
    }
  }
  return enviadas
}
