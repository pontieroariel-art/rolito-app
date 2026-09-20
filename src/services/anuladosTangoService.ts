import { crearConsultaSincronizarComprobantes, subscribeConsulta } from './saldosTangoService'
import type { EmpresaTango } from '@/types'

/**
 * "Preguntar a Tango ahora" para los anulados pendientes (2026-09-20).
 *
 * Son dos pasos, y los dos hacen falta: primero el bridge lee Tango para los
 * clientes de la lista (si no, se compara contra el índice de hace una hora) y
 * después corre la misma reconciliación que el barrido horario, que es lo que
 * saca la fila. Nadie marca nada a mano: el único que da por anulado un
 * comprobante sigue siendo Tango.
 */

const TIMEOUT_MS = 30_000

/** Le pide al bridge que lea YA los comprobantes de esos clientes. Resuelve cuando contesta (o al vencer). */
function refrescarUno(
  args: { clienteUid: string; empresa: EmpresaTango; codigos: string[] },
  actor: { uid: string; nombre: string },
): Promise<void> {
  return new Promise((resolve) => {
    let listo = false
    let unsub: (() => void) | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const cerrar = () => {
      if (listo) return
      listo = true
      if (unsub) unsub()
      if (timeout) clearTimeout(timeout)
      resolve()
    }
    crearConsultaSincronizarComprobantes(args, actor)
      .then((id) => {
        if (listo) return
        unsub = subscribeConsulta(id, (c) => {
          if (c && (c.estado === 'respondida' || c.estado === 'error')) cerrar()
        })
        timeout = setTimeout(cerrar, TIMEOUT_MS)
      })
      .catch(cerrar)
  })
}

export interface ClienteAConsultar { clienteUid: string; empresa: EmpresaTango; codigo: string }

export interface ResultadoVerificacion {
  remitos: { pendientes: number; confirmados: number }
  recibos: { pendientes: number; confirmados: number }
}

/**
 * Refresca los comprobantes de los clientes involucrados y después corre la
 * reconciliación. Devuelve cuántas filas se soltaron.
 */
export async function verificarAnuladosEnTango(
  clientes: ClienteAConsultar[],
  actor: { uid: string; nombre: string },
): Promise<ResultadoVerificacion> {
  // Una consulta por cliente y empresa, con todos sus códigos juntos.
  const porClave = new Map<string, ClienteAConsultar & { codigos: string[] }>()
  for (const c of clientes) {
    if (!c.clienteUid || !c.codigo) continue
    const clave = `${c.clienteUid}|${c.empresa}`
    const ya = porClave.get(clave)
    if (ya) { if (!ya.codigos.includes(c.codigo)) ya.codigos.push(c.codigo) }
    else porClave.set(clave, { ...c, codigos: [c.codigo] })
  }
  await Promise.all([...porClave.values()].map((c) =>
    refrescarUno({ clienteUid: c.clienteUid, empresa: c.empresa, codigos: c.codigos }, actor),
  ))

  const { getFunctions, httpsCallable } = await import('firebase/functions')
  const fn = httpsCallable<Record<string, never>, ResultadoVerificacion>(getFunctions(), 'verificarAnuladosEnTango')
  const { data } = await fn({})
  return data
}
