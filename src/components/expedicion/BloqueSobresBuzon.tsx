import { Link } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import Badge, { type TonoBadge } from '@/components/common/Badge'
import { NUMERO, TD, TH } from '@/components/common/tabla'
import { haceCuanto } from '@/utils/tiempo'
import type { SobreEsperado } from '@/utils/buzon'

// Un bloque del buzón (2026-09-18): Sin aparecer, Esperados o Recibidos hoy.
//
// Misma lectura que la tira de sobres de tesorería: lo que FALTA arriba y en
// rojo, lo hecho abajo y apagado. El código de la descarga va grande porque es
// lo que el chofer escribió a mano en el sobre y lo que el cajero compara.

export default function BloqueSobresBuzon({ titulo, filas, tono, ayuda, vacio }: {
  titulo: string
  filas:  SobreEsperado[]
  tono:   TonoBadge
  /** Una línea que explica qué es este bloque, sin obligar a preguntar. */
  ayuda:  string
  vacio:  string
}) {
  const alerta = tono === 'cancelado' && filas.length > 0
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario">{titulo}</h2>
        <span className={`text-xs font-semibold tabular-nums ${alerta ? 'text-[#97241F]' : 'text-secundario'}`}>{filas.length}</span>
        <span className="text-xs text-secundario truncate" title={ayuda}>· {ayuda}</span>
      </div>
      <div className={`bg-white border rounded-xl overflow-hidden ${alerta ? 'border-[#F0C7C2]' : 'border-[#D3D1C7]'}`}>
        {filas.length === 0 ? (
          <p className="px-3.5 py-3 text-sm text-secundario flex items-center gap-2"><Inbox size={16} className="text-inerte" /> {vacio}</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Chofer</th>
                <th className={TH}>Código del sobre</th>
                <th className={TH}>Remito</th>
                <th className={TH}>Día del viaje</th>
                <th className={`${TH} ${NUMERO}`}>Contado</th>
                <th className={TH}>Estado</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.remitoId} className={alerta ? 'bg-[#FDF3F2]' : ''}>
                  <td className={`${TD} text-gray-900 max-w-[220px] truncate`} title={f.choferNombre}>{f.choferNombre}</td>
                  <td className={`${TD} font-semibold text-gray-900 tabular-nums`}>{f.descargaCodigo || '—'}</td>
                  <td className={`${TD} text-secundario tabular-nums`}>{f.remitoCodigo}</td>
                  <td className={`${TD} text-secundario tabular-nums`}>{f.diaReparto}</td>
                  <td className={`${TD} ${NUMERO} text-secundario`}>{haceCuanto(f.contadaEn)}</td>
                  <td className={TD}>
                    <Badge tono={tono}>
                      {f.estado === 'sin_aparecer' ? 'No apareció' : f.estado === 'esperado' ? 'Esperando el sobre' : 'Liquidado'}
                    </Badge>
                  </td>
                  <td className={`${TD} text-right`}>
                    {f.estado === 'recibido' ? (
                      <span className="text-xs text-secundario">{f.liquidacion?.codigo ?? 'cerrado'}</span>
                    ) : (
                      <Link
                        to={`/caja/liquidaciones?viaje=${encodeURIComponent(f.remitoId)}&buzon=${encodeURIComponent(f.descargaCodigo)}`}
                        className="text-xs font-semibold text-accent border border-accent rounded-lg px-3 py-1.5 hover:bg-accent/10 whitespace-nowrap"
                      >
                        Liquidar este viaje
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
