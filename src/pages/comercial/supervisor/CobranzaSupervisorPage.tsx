import { useSearchParams } from 'react-router-dom'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import CobranzaCompleta from '@/components/cobranzas/CobranzaCompleta'

// Cobrar (supervisor): la cobranza completa compartida con ventanilla y chofer
// (components/cobranzas/CobranzaCompleta), con el encabezado del supervisor.
export default function CobranzaSupervisorPage() {
  const [searchParams] = useSearchParams()
  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title="Cobrar" back />
      <CobranzaCompleta origen="supervisor" clienteInicial={searchParams.get('cliente') ?? undefined} volverA="/supervisor" />
    </div>
  )
}
