import { useCallback, useEffect, useRef, useState } from 'react'
import type { EmpresaTango, UserProfile } from '@/types'
import { crearConsultaSincronizarComprobantes, subscribeConsulta } from '@/services/saldosTangoService'
import { tangoIdsDe } from '@/utils/tangoEmpresas'

const TIMEOUT_MS = 30_000

// "Actualizar desde Tango" en la ficha (2026-09-10): una consulta por empresa con los
// códigos del cliente; el bridge corre el lector para esos códigos y responde por el
// mismo doc. Los índices tangoComprobantes están suscriptos, así que la ficha se
// actualiza sola cuando el bridge escribe. Si el bridge no contesta en 30 s, lo dice.
export function useRefrescarComprobantesTango(
  cliente: Pick<UserProfile, 'uid' | 'idGva14Tango' | 'codigoTango' | 'tangoIds'> | null,
  actor: { uid: string; nombre: string } | null,
): { refrescar: () => void; refrescando: boolean; aviso: string } {
  const [refrescando, setRefrescando] = useState(false)
  const [aviso, setAviso] = useState('')
  const limpiezas = useRef<Array<() => void>>([])

  useEffect(() => () => limpiezas.current.forEach((f) => f()), [])

  const refrescar = useCallback(() => {
    if (!cliente || !actor || refrescando) return
    const ids = tangoIdsDe(cliente)
    const empresas = (Object.keys(ids) as EmpresaTango[]).filter((e) => (ids[e]?.length ?? 0) > 0)
    if (!empresas.length) return
    setRefrescando(true)
    setAviso('')
    let pendientes = empresas.length
    let fallas = 0
    const terminarUna = (ok: boolean) => {
      if (!ok) fallas++
      if (--pendientes > 0) return
      setRefrescando(false)
      setAviso(fallas ? 'Tango no respondió: se muestra lo último sincronizado.' : 'Actualizado desde Tango.')
      setTimeout(() => setAviso(''), 6000)
    }
    for (const empresa of empresas) {
      let listo = false
      let unsub: (() => void) | null = null
      let timeout: ReturnType<typeof setTimeout> | null = null
      const cerrar = (ok: boolean) => {
        if (listo) return
        listo = true
        if (unsub) unsub()
        if (timeout) clearTimeout(timeout)
        terminarUna(ok)
      }
      limpiezas.current.push(() => { if (!listo) { listo = true; if (unsub) unsub(); if (timeout) clearTimeout(timeout) } })
      crearConsultaSincronizarComprobantes({ clienteUid: cliente.uid, empresa, codigos: ids[empresa]!.map((x) => x.codigo) }, actor)
        .then((id) => {
          if (listo) return
          unsub = subscribeConsulta(id, (c) => {
            if (!c) return
            if (c.estado === 'respondida') cerrar(true)
            else if (c.estado === 'error') cerrar(false)
          })
          timeout = setTimeout(() => cerrar(false), TIMEOUT_MS)
        })
        .catch(() => cerrar(false))
    }
  }, [cliente, actor, refrescando])

  return { refrescar, refrescando, aviso }
}
