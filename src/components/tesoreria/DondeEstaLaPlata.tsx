import type { ReactNode } from 'react'
import { CheckCircle2, HandCoins, Landmark, Truck } from 'lucide-react'
import { formatoARS } from '@/utils/money'
import type { DondeEstaLaPlata as Datos, LugarPlata } from '@/utils/plataDelDia'

// La tira "¿Dónde está la plata?" (2026-09-24, arriba de Recepción): cuatro
// lugares en el orden en que la plata avanza, cada uno con su efectivo, sus
// cheques y quién la tiene. Reemplaza a "Plata del día" (Ariel: "no se entiende
// qué es"). Nada de empresas ni códigos acá: eso está adentro de cada liquidación.

const LUGARES: { clave: keyof Datos; titulo: string; bajada: string; icono: ReactNode; texto: string; borde: string; fondo: string }[] = [
  { clave: 'calle',     titulo: 'En la calle',           bajada: 'choferes y cobradores sin liquidar',      icono: <Truck size={18} />,        texto: 'text-[#97241F]', borde: 'border-[#F0C7C3]', fondo: 'bg-[#FDF3F2]' },
  { clave: 'caja',      titulo: 'En caja',               bajada: 'turnos abiertos y cerradas sin entregar', icono: <HandCoins size={18} />,    texto: 'text-[#8A5203]', borde: 'border-[#EFDCB4]', fondo: 'bg-[#FBF6EA]' },
  { clave: 'entregada', titulo: 'Entregada, sin contar', bajada: 'en tus manos, con firma de entrega',      icono: <Landmark size={18} />,     texto: 'text-[#14538C]', borde: 'border-[#BFD8EE]', fondo: 'bg-[#EEF4FA]' },
  { clave: 'contada',   titulo: 'Contada y validada',    bajada: 'ya entró a tesorería',                    icono: <CheckCircle2 size={18} />, texto: 'text-[#0F6B4E]', borde: 'border-[#AFD9C6]', fondo: 'bg-[#EEF7F2]' },
]

export default function DondeEstaLaPlata({ datos, cargando }: { datos: Datos; cargando?: boolean }) {
  return (
    <section aria-label="Dónde está la plata">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">¿Dónde está la plata hoy?</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LUGARES.map((l) => <Lugar key={l.clave} {...l} lugar={datos[l.clave]} diferencia={l.clave === 'contada' ? datos.contada.diferencia : undefined} cargando={cargando} />)}
      </div>
    </section>
  )
}

function Lugar({ titulo, bajada, icono, texto, borde, fondo, lugar, diferencia, cargando }: {
  titulo: string; bajada: string; icono: ReactNode; texto: string; borde: string; fondo: string; lugar: LugarPlata; diferencia?: number; cargando?: boolean
}) {
  const vacio = lugar.efectivo === 0 && lugar.cheques.cantidad === 0 && lugar.personas.length === 0
  return (
    <article className={`rounded-2xl border ${vacio ? 'border-[#D3D1C7] bg-white' : `${borde} ${fondo}`} p-4 flex flex-col gap-2 min-w-0`}>
      <div className={`flex items-center gap-2 ${vacio ? 'text-secundario' : texto}`}>
        <span className="shrink-0">{icono}</span>
        <h3 className="text-base font-bold leading-tight">{titulo}</h3>
      </div>
      <p className={`text-3xl font-black leading-none tabular-nums ${vacio ? 'text-secundario' : 'text-gray-900'}`}>{cargando && vacio ? '…' : formatoARS(lugar.efectivo)}</p>
      <p className="text-sm text-secundario tabular-nums">
        {lugar.cheques.cantidad ? <>{lugar.cheques.cantidad} {lugar.cheques.cantidad === 1 ? 'cheque' : 'cheques'} · {formatoARS(lugar.cheques.total)}</> : 'sin cheques'}
        {diferencia !== undefined && diferencia !== 0 && <span className="block font-semibold text-red-700">diferencia {diferencia > 0 ? '+' : ''}{formatoARS(diferencia)}</span>}
      </p>
      <p className="text-xs text-secundario">{bajada}</p>
      {lugar.personas.length > 0 && (
        <ul className="mt-1 border-t border-[#E7E5DC] pt-2 space-y-1">
          {lugar.personas.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-gray-900" title={`${p.nombre} · ${p.detalle}`}><b>{p.nombre}</b> <span className="text-secundario">· {p.detalle}</span></span>
              <span className="shrink-0 font-semibold tabular-nums text-gray-900">{formatoARS(p.efectivo)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
