import { ETIQUETA_MORA, type NivelMora } from '@/utils/mora'

// Colores del nivel de mora (Clientes con deuda, ficha del cliente).
export const CLASE_MORA: Record<NivelMora, string> = {
  ok:       'text-amber-700 bg-amber-50 border-amber-200',
  amarillo: 'text-amber-800 bg-amber-100 border-amber-300',
  rojo:     'text-red-700 bg-red-50 border-red-300',
}

export const BORDE_MORA: Record<NivelMora, string> = {
  ok:       'border-[#D3D1C7]',
  amarillo: 'border-amber-300',
  rojo:     'border-red-300',
}

export default function ChipMora({ nivel }: { nivel: NivelMora }) {
  if (nivel === 'ok') return null
  return <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${CLASE_MORA[nivel]}`}>{ETIQUETA_MORA[nivel]}</span>
}
