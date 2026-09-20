import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { textoTango, type LecturaTango } from '@/utils/estadoEnTango'

/**
 * Qué dice Tango de este comprobante, en la fila (2026-09-20).
 *
 * Semántica triple como todo badge de la app: color, palabra e ícono. Acá
 * importa más que en otros lados porque la pantalla se mira para decidir qué
 * hacer: "FACTURADO" no es un adorno, es la razón por la que el intento de
 * anular no prosperó y lo que hay que hacer antes.
 */
export default function ChipTango({ lectura, cargando }: { lectura: LecturaTango; cargando?: boolean }) {
  if (cargando) {
    return (
      <span className="text-xs text-secundario inline-flex items-center gap-1">
        <RefreshCw size={11} className="animate-spin" /> preguntando a Tango…
      </span>
    )
  }
  const { texto, ayuda, tono } = textoTango(lectura)
  const estilo = tono === 'alerta'
    ? 'bg-red-100 text-red-800 border-red-300'
    : tono === 'ok'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
      : 'bg-white text-secundario border-[#D3D1C7]'
  return (
    <span title={ayuda} className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap inline-flex items-center gap-1 ${estilo}`}>
      {tono === 'alerta' ? <AlertTriangle size={11} /> : tono === 'ok' ? <Check size={11} /> : null}
      {texto}
    </span>
  )
}
