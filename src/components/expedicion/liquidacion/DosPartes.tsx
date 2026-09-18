// Las dos mitades del viaje, una al lado de la otra (2026-09-18).
//
// La liquidación se cierra en dos actos independientes: caja liquida la PLATA de
// 6 a 18, y muelle cierra la MERCADERÍA al contar la descarga, a cualquier hora.
// El viaje queda cerrado cuando están las dos, en cualquier orden.
//
// Se muestran con la misma jerarquía y ninguna adentro de un plegable. La
// mercadería está casi siempre, y justamente por eso: el día que falte es el que
// importa, y si viviera escondida detrás de un "ver más" nadie lo notaría.

import { Banknote, Package } from 'lucide-react'
import Badge from '@/components/common/Badge'
import { haceCuanto } from '@/utils/tiempo'
import type { EstadoLiquidacion, ParteEstado } from '@/utils/estadoLiquidacion'

const Parte = ({
  titulo, icono, parte, pendiente, detalle,
}: {
  titulo: string
  icono: React.ReactNode
  parte: ParteEstado
  /** Qué decir cuando falta. No es un error: es el estado normal de media jornada. */
  pendiente: string
  detalle?: React.ReactNode
}) => (
  <div className="flex-1 min-w-[240px] bg-white rounded-2xl border border-[#D3D1C7] p-4">
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="flex items-center gap-2">
        <span className="text-secundario">{icono}</span>
        <h3 className="text-xs uppercase tracking-wide text-secundario font-semibold">{titulo}</h3>
      </div>
      {/* Color + palabra siempre: esto se mira a contraluz y en pantallas lavadas. */}
      <Badge tono={parte.hecha ? 'entregado' : 'pendiente'}>{parte.hecha ? 'Cerrada' : 'Pendiente'}</Badge>
    </div>
    {parte.hecha ? (
      <p className="text-sm text-gray-900">
        {parte.por?.nombre}
        {parte.en && <span className="text-secundario"> · {haceCuanto(parte.en)}</span>}
      </p>
    ) : (
      <p className="text-sm text-secundario">{pendiente}</p>
    )}
    {detalle && <div className="mt-2 text-xs text-secundario">{detalle}</div>}
  </div>
)

export default function DosPartes({
  estado, detallePlata, detalleMercaderia,
}: {
  estado: EstadoLiquidacion
  detallePlata?: React.ReactNode
  detalleMercaderia?: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap gap-4">
        <Parte
          titulo="Plata"
          icono={<Banknote size={16} />}
          parte={estado.plata}
          pendiente="Falta liquidarla en caja"
          detalle={detallePlata}
        />
        <Parte
          titulo="Mercadería"
          icono={<Package size={16} />}
          parte={estado.mercaderia}
          // No es una falta de nadie: el camión puede seguir en la calle, o
          // haber vuelto de noche y esperar a que muelle lo cuente.
          pendiente="En la calle: el camión todavía no se contó"
          detalle={detalleMercaderia}
        />
      </div>
      {estado.estado === 'cerrada' && (
        <p className="text-xs text-secundario">
          El viaje quedó cerrado cuando llegó la segunda parte{estado.cerradaEn ? `, ${haceCuanto(estado.cerradaEn)}` : ''}.
        </p>
      )}
    </section>
  )
}
