import { ReactNode } from 'react'

/**
 * MICRO-BADGE de estado (convenciones de diseño, 2026-09-13).
 *
 * Semántica triple: fondo tenue del color MÁS la palabra MÁS un punto (o un
 * ícono, que lo reemplaza). Nunca solo color: las pantallas de planta se miran
 * a contraluz y no todo el mundo distingue los tonos.
 *
 * Los colores son los mismos que ya usaban los estados de pedido en la app; acá
 * quedan en un solo lugar en vez de repetidos pantalla por pantalla.
 */
export type TonoBadge =
  | 'pendiente' | 'confirmado' | 'enCamino' | 'entregado' | 'cancelado'
  | 'neutro' | 'aviso'

const TONOS: Record<TonoBadge, { caja: string; punto: string }> = {
  pendiente:  { caja: 'bg-[#FBF1DF] border-[#EFDCB4] text-[#8A5203]', punto: 'bg-[#C98A16]' },
  confirmado: { caja: 'bg-[#E8F1FA] border-[#BFD8EE] text-[#14538C]', punto: 'bg-[#2C7CC4]' },
  enCamino:   { caja: 'bg-[#E4F3EE] border-[#B3DDD3] text-[#0F6E56]', punto: 'bg-[#1D9E75]' },
  entregado:  { caja: 'bg-[#E4F3EC] border-[#AFD9C6] text-[#0B5A3C]', punto: 'bg-[#14865C]' },
  cancelado:  { caja: 'bg-[#FBE9E7] border-[#F0C7C2] text-[#97241F]', punto: 'bg-[#C0392F]' },
  neutro:     { caja: 'bg-[#F1EFE8] border-[#DEDBD1] text-[#57544C]', punto: 'bg-[#8C8A80]' },
  aviso:      { caja: 'bg-[#FDF1D8] border-[#E9CE92] text-[#8A5203]', punto: 'bg-[#E0A020]' },
}

export default function Badge({
  tono = 'neutro', children, icono, punto = true, title,
}: {
  tono?:    TonoBadge
  children: ReactNode
  icono?:   ReactNode
  /** El puntito de color. Se apaga solo cuando hay ícono. */
  punto?:   boolean
  title?:   string
}) {
  const t = TONOS[tono]
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] font-medium leading-none whitespace-nowrap ${t.caja}`}
    >
      {icono
        ? <span className="shrink-0 [&>svg]:w-3 [&>svg]:h-3">{icono}</span>
        : punto && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.punto}`} />}
      {children}
    </span>
  )
}
