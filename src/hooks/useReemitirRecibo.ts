import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getCobranza } from '@/services/cobranzaService'
import { reportError } from '@/services/observability'
import type { Cobranza } from '@/types'

/**
 * "Hacer el recibo correcto" (2026-09-15): la pantalla de cobro abierta con
 * `?reemitir=<cobranzaId>` precarga el recibo anulado (cliente, facturas y
 * medios) para que el cobrador corrija solo lo que estaba mal. Devuelve la
 * cobranza a reemitir, o null si no hay parámetro, no existe o no está anulada.
 */
export function useReemitirRecibo(): Cobranza | null {
  const [searchParams] = useSearchParams()
  const id = searchParams.get('reemitir')
  const [cobranza, setCobranza] = useState<Cobranza | null>(null)
  useEffect(() => {
    if (!id) { setCobranza(null); return }
    let vigente = true
    getCobranza(id)
      .then((c) => { if (vigente) setCobranza(c && c.anulacion?.estado === 'anulada' ? c : null) })
      .catch((err) => { reportError(err, { origen: 'useReemitirRecibo', accion: 'leer la cobranza a reemitir' }); if (vigente) setCobranza(null) })
    return () => { vigente = false }
  }, [id])
  return cobranza
}
