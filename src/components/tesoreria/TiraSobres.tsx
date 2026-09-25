import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatoARS } from '@/utils/money'
import type { CustodiaPlanta } from '@/utils/sobres'

// La plata de las ventanillas, como el camino que hace un sobre (2026-09-16,
// Ariel: la tira de custodia con "tiene que llegar / en camino / falta" era
// confusa, y "en camino" mostraba el importe del sistema antes de contar):
//
//   Cajas abiertas › Por recibir › Recibidos hoy › Diferencias
//
// Cantidades, no importes, hasta que tesorería haya contado: el sobre se
// recibe a ciegas. Lo usan Recepción y Tesorería en vivo, para que digan lo mismo.

const hora = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

export default function TiraSobres({ custodia, horasAviso, titulo = 'Plata de las ventanillas · hoy', linkRecepcion, error }: {
  custodia: CustodiaPlanta
  /** A partir de cuántas horas un sobre sin recibir se marca en aviso (config/tesoreria). */
  horasAviso: number
  titulo?: string
  /** En Tesorería en vivo: link a la Recepción. */
  linkRecepcion?: boolean
  error?: boolean
}) {
  const abiertas = custodia.cajasAbiertas
  const porRecibir = custodia.enCamino
  const enVentanilla = porRecibir.filter((x) => x.sobre.estado !== 'entregada')
  const entregados = porRecibir.filter((x) => x.sobre.estado === 'entregada')
  const viejos = enVentanilla.filter((x) => x.horas >= horasAviso).length
  const recibidos = custodia.recibidosHoy
  const contado = recibidos.reduce((s, x) => s + (x.recepcion?.efectivoContado ?? 0), 0)
  const diferencia = redondear(recibidos.reduce((s, x) => s + (x.recepcion?.diferencia?.efectivo ?? 0), 0))
  const valoresFaltantes = recibidos.reduce((s, x) => s + (x.recepcion?.diferencia?.valoresFaltantes.cantidad ?? 0), 0)
  const hayDiferencia = diferencia !== 0 || valoresFaltantes > 0

  const pasos: Array<{ id: string; etiqueta: string; valor: string; detalle: ReactNode; tono: string; realce?: boolean }> = [
    {
      id: 'abiertas', etiqueta: 'Cajas abiertas', valor: String(abiertas.length), tono: abiertas.length ? 'text-[#8A5203]' : 'text-secundario',
      detalle: abiertas.length ? abiertas.map((x) => `${x.sesion.cajero.nombre}, desde las ${hora(x.sesion.abiertaEn.toDate())}`).join(' · ') : 'la plata ya no está en ninguna ventanilla',
    },
    {
      id: 'porRecibir', etiqueta: 'Por contar', valor: String(porRecibir.length), tono: porRecibir.length ? (viejos ? 'text-[#97241F]' : 'text-[#14538C]') : 'text-secundario', realce: viejos > 0,
      detalle: porRecibir.length
        ? [
            enVentanilla.length ? `${enVentanilla.length} todavía en la ventanilla (${enVentanilla.map((x) => `${x.sobre.codigo}, hace ${Math.round(x.horas)} h`).join(', ')})` : '',
            entregados.length ? `${entregados.length} entregado${entregados.length === 1 ? '' : 's'} en mano, sin contar (${entregados.map((x) => `${x.sobre.codigo} a ${x.sobre.entrega?.recibio.nombre ?? '—'}`).join(', ')})` : '',
            viejos ? `${viejos === 1 ? 'uno lleva' : `${viejos} llevan`} más de ${horasAviso} h sin contar` : '',
          ].filter(Boolean).join(' · ')
        : 'ningún sobre cerrado esperando',
    },
    {
      id: 'recibidos', etiqueta: 'Contados hoy', valor: String(recibidos.length), tono: recibidos.length ? 'text-[#0B5A3C]' : 'text-secundario',
      detalle: recibidos.length ? `${formatoARS(contado)} contados por tesorería` : 'todavía no recibiste ninguno',
    },
    {
      id: 'diferencias', etiqueta: 'Diferencias', valor: recibidos.length ? formatoARS(diferencia) : '—', tono: hayDiferencia ? 'text-[#97241F]' : 'text-secundario', realce: hayDiferencia,
      detalle: !recibidos.length ? 'se sabe al recibir' : hayDiferencia ? `${diferencia < 0 ? 'faltó' : diferencia > 0 ? 'sobró' : 'efectivo justo'}${valoresFaltantes ? ` · ${valoresFaltantes} valor(es) no entregado(s)` : ''}` : 'nada faltó ni sobró',
    },
  ]

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">{titulo}</h2>
      <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
        <div className="flex flex-wrap sm:flex-nowrap items-stretch px-2 py-2">
          {pasos.map((p, i) => (
            <Fragment key={p.id}>
              {i > 0 && <span className="self-center text-inerte px-1 hidden sm:inline">›</span>}
              <div className={`flex-1 min-w-[45%] sm:min-w-0 rounded-lg px-3 py-2 ${p.realce ? 'bg-[#FDF3F2]' : ''}`}>
                <p className="text-xs font-medium text-secundario">{p.etiqueta}</p>
                <p className={`text-2xl font-bold tabular-nums leading-none mt-1 ${p.tono}`}>{p.valor}</p>
                <p className="text-xs text-secundario mt-1.5 leading-snug">{p.detalle}</p>
              </div>
            </Fragment>
          ))}
        </div>
        {(error || linkRecepcion) && (
          <div className="border-t border-[#E7E5DC] px-3.5 py-2 bg-[#F8F7F2]">
            {error
              ? <p className="text-xs text-red-700">No pudimos leer los sobres o las cajas. Revisá la conexión.</p>
              : <Link to="/tesoreria/recepcion" className="text-xs text-accent underline underline-offset-2">Ir a Sobres para contarlos</Link>}
          </div>
        )}
      </div>
    </section>
  )
}

const redondear = (n: number): number => Math.round(n * 100) / 100
