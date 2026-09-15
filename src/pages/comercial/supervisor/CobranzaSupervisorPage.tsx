import { useSearchParams } from 'react-router-dom'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import CobranzaCompleta from '@/components/cobranzas/CobranzaCompleta'
import { useReemitirRecibo } from '@/hooks/useReemitirRecibo'

// Cobrar (supervisor): la cobranza completa compartida con ventanilla y chofer
// (components/cobranzas/CobranzaCompleta), con el encabezado del supervisor.
// `?reemitir=<cobranzaId>` (2026-09-15): precarga un recibo anulado para hacer el correcto.
export default function CobranzaSupervisorPage() {
  const [searchParams] = useSearchParams()
  const reemitirDe = useReemitirRecibo()
  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title="Cobrar" back />
      <CobranzaCompleta origen="supervisor" clienteInicial={searchParams.get('cliente') ?? undefined} volverA="/supervisor" reemitirDe={reemitirDe} />
    </div>
  )
}
