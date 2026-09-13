import { ReactNode } from 'react'

/**
 * PULSO OPERATIVO en una sola tira (convenciones de diseño, 2026-09-13).
 *
 * Por qué no son seis tarjetas: seis cajas de 84 px para seis números de dos
 * cifras gastan unos 40 px de alto de más y doce bordes, y al estar separadas
 * los números no se comparan de un vistazo, que es justo para lo que se mira
 * este dato. Una caja con borde se gana cuando el número trae unidad,
 * comparación contra el período anterior o una acción; si es etiqueta más
 * número, va acá.
 *
 * EL CERO: pierde el color del estado y baja a `text-secundario`, pero NO se
 * lava. Un cero es información ("hoy no se canceló nada"), no un campo
 * deshabilitado, así que nunca baja del piso de contraste de la app.
 */

export type TonoSegmento = 'pendiente' | 'confirmado' | 'enCamino' | 'entregado' | 'cancelado' | 'neutro'

const TONOS: Record<TonoSegmento, { texto: string; realce: string; punto: string }> = {
  pendiente:  { texto: 'text-[#8A5203]', realce: 'bg-[#FDF8EE]', punto: 'bg-[#C98A16]' },
  confirmado: { texto: 'text-[#14538C]', realce: 'bg-[#F2F7FC]', punto: 'bg-[#2C7CC4]' },
  enCamino:   { texto: 'text-[#0F6E56]', realce: 'bg-[#F1F9F6]', punto: 'bg-[#1D9E75]' },
  entregado:  { texto: 'text-[#0B5A3C]', realce: 'bg-[#F1F9F5]', punto: 'bg-[#14865C]' },
  cancelado:  { texto: 'text-[#97241F]', realce: 'bg-[#FDF3F2]', punto: 'bg-[#C0392F]' },
  neutro:     { texto: 'text-gray-900',  realce: 'bg-[#F8F7F2]', punto: 'bg-[#8C8A80]' },
}

export interface SegmentoEstado {
  id:       string
  etiqueta: string
  valor:    number
  icono?:   ReactNode
  tono?:    TonoSegmento
  sufijo?:  string
  /** Con valor distinto de cero, el segmento se realza: hay que ir a mirarlo. */
  alerta?:  boolean
}

export default function StatusStrip({
  segmentos, titulo, pie,
}: {
  segmentos: SegmentoEstado[]
  /** Título del bloque. 12 px: las mayúsculas de 11 px no se leen en la tablet. */
  titulo?:   ReactNode
  pie?:      ReactNode
}) {
  return (
    <section>
      {titulo && (
        <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">{titulo}</h2>
      )}
      <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
        <div className="flex flex-wrap sm:flex-nowrap divide-y sm:divide-y-0 sm:divide-x divide-[#E7E5DC]">
          {segmentos.map((s) => {
            const enCero   = s.valor === 0
            const destacar = !!s.alerta && !enCero
            const t        = TONOS[s.tono ?? 'neutro']
            return (
              <div
                key={s.id}
                className={`flex-1 min-w-[33.333%] sm:min-w-0 px-3.5 py-2.5 ${destacar ? t.realce : ''}`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  {s.icono && <span className={`shrink-0 ${enCero ? 'text-secundario' : t.texto}`}>{s.icono}</span>}
                  <p className={`text-xs font-medium truncate ${destacar ? t.texto : 'text-secundario'}`} title={s.etiqueta}>
                    {s.etiqueta}
                  </p>
                  {destacar && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.punto}`} />}
                </div>
                <p className={`text-2xl font-bold leading-none tabular-nums ${
                  enCero ? 'text-secundario' : destacar ? t.texto : 'text-gray-900'
                }`}>
                  {s.valor.toLocaleString('es-AR')}
                  {s.sufijo && <span className="text-xs font-medium ml-1 text-secundario">{s.sufijo}</span>}
                </p>
              </div>
            )
          })}
        </div>
        {pie && <div className="border-t border-[#E7E5DC] px-3.5 py-2 bg-[#F8F7F2]">{pie}</div>}
      </div>
    </section>
  )
}
