import { useEffect, useRef, useState } from 'react'
import { SaldoTango, UserProfile } from '@/types'
import { crearConsultaSaldo, subscribeConsulta, subscribeSaldoCliente } from '@/services/saldosTangoService'

// Timeout del refresh on-demand: si el bridge no respondió en este tiempo, la
// UI se queda con el cache y lo dice ("actualizado hace X").
const TIMEOUT_MS = 12_000

export interface SaldoEnVivo {
  saldo:       SaldoTango | null
  cargando:    boolean   // todavía no llegó ni el cache
  refrescando: boolean   // consulta on-demand en vuelo
  esCache:     boolean   // false si la consulta on-demand respondió fresco
}

// Saldo de un cliente para la pantalla de cobro, con el patrón híbrido:
// 1. Se suscribe al cache saldosTango/{uid} (disponible al toque, aun offline).
// 2. En paralelo dispara UNA consulta on-demand a Tango (tango-consultas); si
//    el bridge responde, onConsultaRespondida actualiza el cache y el snapshot
//    de (1) trae el dato fresco solo. Si no responde en 12 s (o da error), se
//    sigue con el cache sin bloquear a nadie.
export function useSaldoClienteEnVivo(
  cliente: Pick<UserProfile, 'uid' | 'idGva14Tango'> | null,
  actor: { uid: string; nombre: string } | null,
): SaldoEnVivo {
  const [saldo, setSaldo] = useState<SaldoTango | null>(null)
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [esCache, setEsCache] = useState(true)
  // La consulta se dispara una sola vez por cliente montado.
  const consultaDisparada = useRef<string | null>(null)

  const clienteUid = cliente?.uid ?? null
  const idGva14 = cliente?.idGva14Tango

  useEffect(() => {
    setSaldo(null)
    setCargando(true)
    setEsCache(true)
    if (!clienteUid) return
    return subscribeSaldoCliente(clienteUid, (s) => {
      setSaldo(s)
      setCargando(false)
    })
  }, [clienteUid])

  useEffect(() => {
    if (!clienteUid || !actor || typeof idGva14 !== 'number') return
    if (consultaDisparada.current === clienteUid) return
    consultaDisparada.current = clienteUid

    let unsubConsulta: (() => void) | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    let terminado = false

    const terminar = (fresco: boolean) => {
      if (terminado) return
      terminado = true
      setRefrescando(false)
      if (fresco) setEsCache(false)
      if (timeout) clearTimeout(timeout)
      if (unsubConsulta) unsubConsulta()
    }

    setRefrescando(true)
    crearConsultaSaldo({ clienteUid, idGva14 }, actor)
      .then((consultaId) => {
        if (terminado) return
        unsubConsulta = subscribeConsulta(consultaId, (c) => {
          if (!c) return
          if (c.estado === 'respondida') terminar(true)
          else if (c.estado === 'error') terminar(false)
        })
        timeout = setTimeout(() => terminar(false), TIMEOUT_MS)
      })
      .catch(() => terminar(false))

    return () => terminar(false)
    // actor es estable dentro de la sesión (uid/nombre del supervisor logueado).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteUid, idGva14])

  return { saldo, cargando, refrescando, esCache }
}
