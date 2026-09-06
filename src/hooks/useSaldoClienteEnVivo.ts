import { useEffect, useMemo, useRef, useState } from 'react'
import { EmpresaTango, SaldoTango, UserProfile } from '@/types'
import { crearConsultaSaldo, subscribeConsulta, subscribeSaldoCliente } from '@/services/saldosTangoService'
import { tangoIdsDe } from '@/utils/tangoEmpresas'

// Timeout del refresh on-demand: si Tango no respondió en este tiempo, la
// UI se queda con el cache y lo dice ("actualizado hace X").
const TIMEOUT_MS = 12_000

export interface SaldoEnVivo {
  saldo:       SaldoTango | null
  cargando:    boolean   // todavía no llegó ni el cache
  refrescando: boolean   // alguna consulta on-demand en vuelo
  esCache:     boolean   // false si TODAS las consultas on-demand respondieron fresco
  /** Empresas que respondieron fresco en esta apertura. */
  frescas:     EmpresaTango[]
}

// Saldo de un cliente para la pantalla de cobro, con el patrón híbrido:
// 1. Se suscribe al cache saldosTango/{uid} (disponible al toque, aun offline).
// 2. En paralelo dispara UNA consulta on-demand a Tango POR EMPRESA en la que
//    el cliente esté vinculado (tango-consultas, 2026-09-06: Redonhielo y
//    Rolito); cada respuesta actualiza su rama del cache y el snapshot de (1)
//    trae el dato fresco solo. La que no responde en 12 s (o da error) queda
//    con el cache sin bloquear a nadie.
export function useSaldoClienteEnVivo(
  cliente: Pick<UserProfile, 'uid' | 'idGva14Tango' | 'codigoTango' | 'tangoIds'> | null,
  actor: { uid: string; nombre: string } | null,
): SaldoEnVivo {
  const [saldo, setSaldo] = useState<SaldoTango | null>(null)
  const [cargando, setCargando] = useState(true)
  const [enVuelo, setEnVuelo] = useState<EmpresaTango[]>([])
  const [frescas, setFrescas] = useState<EmpresaTango[]>([])
  // Las consultas se disparan una sola vez por cliente montado.
  const consultaDisparada = useRef<string | null>(null)

  const clienteUid = cliente?.uid ?? null
  // Identidad por empresa, serializada para que el efecto no se re-dispare por
  // cambios de referencia del perfil.
  const idsPorEmpresaJson = useMemo(() => JSON.stringify(tangoIdsDe(cliente)), [cliente])

  useEffect(() => {
    setSaldo(null)
    setCargando(true)
    setFrescas([])
    if (!clienteUid) return
    return subscribeSaldoCliente(clienteUid, (s) => {
      setSaldo(s)
      setCargando(false)
    })
  }, [clienteUid])

  useEffect(() => {
    if (!clienteUid || !actor) return
    const idsPorEmpresa = JSON.parse(idsPorEmpresaJson) as Partial<Record<EmpresaTango, { idGva14: number; codigo: string }[]>>
    const empresas = (Object.keys(idsPorEmpresa) as EmpresaTango[]).filter((e) => (idsPorEmpresa[e]?.length ?? 0) > 0)
    if (empresas.length === 0) return
    if (consultaDisparada.current === clienteUid) return
    consultaDisparada.current = clienteUid

    const limpiezas: Array<() => void> = []
    setEnVuelo(empresas)

    for (const empresa of empresas) {
      const ids = idsPorEmpresa[empresa]!.map((x) => x.idGva14)
      let unsubConsulta: (() => void) | null = null
      let timeout: ReturnType<typeof setTimeout> | null = null
      let terminado = false
      const terminar = (fresco: boolean) => {
        if (terminado) return
        terminado = true
        setEnVuelo((prev) => prev.filter((e) => e !== empresa))
        if (fresco) setFrescas((prev) => (prev.includes(empresa) ? prev : [...prev, empresa]))
        if (timeout) clearTimeout(timeout)
        if (unsubConsulta) unsubConsulta()
      }
      limpiezas.push(() => terminar(false))

      crearConsultaSaldo({ clienteUid, idGva14: ids[0], idsGva14: ids, empresa }, actor)
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
    }

    return () => limpiezas.forEach((f) => f())
    // actor es estable dentro de la sesión (uid/nombre de quien cobra).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteUid, idsPorEmpresaJson])

  const empresasVinculadas = useMemo(
    () => (Object.keys(JSON.parse(idsPorEmpresaJson) as object) as EmpresaTango[]),
    [idsPorEmpresaJson],
  )
  const esCache = empresasVinculadas.length === 0 || empresasVinculadas.some((e) => !frescas.includes(e))

  return { saldo, cargando, refrescando: enVuelo.length > 0, esCache, frescas }
}
