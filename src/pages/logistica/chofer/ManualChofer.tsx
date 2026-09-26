import { Download } from 'lucide-react'
import ChoferHeader from '@/components/chofer/ChoferHeader'

// Manual del chofer (2026-09-26, pedido de Ariel: "super práctico"). Se abre
// desde el ícono de ayuda del encabezado del chofer. El contenido es
// public/manuales/chofer.html (maestro en docs/manuales/manual-chofer.html,
// `npm run manuales`); el PDF se baja con un toque explícito, para mandarlo
// por WhatsApp o imprimirlo. El iframe no carga nada de la app: no la traba.
export default function ManualChofer() {
  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900 flex flex-col">
      <ChoferHeader title="Manual del chofer" back />
      <div className="max-w-2xl w-full mx-auto px-4 pt-3 flex justify-end">
        <a href="/manuales/chofer.pdf" download
          className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-[#D3D1C7] bg-white text-sm font-bold text-gray-900 active:scale-[0.98] touch-manipulation">
          <Download size={18} className="text-accent" /> Descargar PDF
        </a>
      </div>
      <div className="flex-1 max-w-2xl w-full mx-auto p-4 pt-3">
        <iframe title="Manual del chofer" src="/manuales/chofer.html" loading="lazy"
          className="w-full h-[calc(100dvh-140px)] rounded-2xl border border-[#D3D1C7] bg-white" />
      </div>
    </div>
  )
}
