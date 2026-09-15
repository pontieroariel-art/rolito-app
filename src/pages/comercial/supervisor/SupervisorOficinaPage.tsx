import type { ReactNode } from 'react'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'

/**
 * Una pantalla de oficina dentro de la app del supervisor (2026-09-15, pedido
 * de Ariel: "tendría que mantener el mismo estilo que tienen ellos, sin la barra
 * de costado"). Envuelve la pantalla de escritorio con la cabecera del supervisor
 * (con Volver) en vez del shell de dominio; la pantalla sigue siendo la misma
 * (p. ej. LiquidacionesPage con base '/supervisor', en modo lectura).
 */
export default function SupervisorOficinaPage({ titulo, volverA = '/supervisor', children }: { titulo: string; volverA?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title={titulo} back volverA={volverA} />
      {children}
    </div>
  )
}
