import { useState } from 'react'
import { Eye, FileText, ShieldCheck } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import { useRemitosCargaChofer } from '@/hooks/useRemitosCargaChofer'
import { describirEnvases, envasesDeRemito } from '@/utils/envases'
import { reportError } from '@/services/observability'
import type { RemitoCarga } from '@/types'

/**
 * Los papeles del viaje, en el teléfono del chofer (2026-09-18, pedido de Ariel:
 * "que quede de manera digital tanto el remito como el COT para que el chofer lo
 * pueda mostrar").
 *
 * Es SOLO LECTURA: el chofer no completa ni confirma nada, igual que en todo el
 * resto del circuito. Lo que gana es poder mostrar el remito y el COT si lo para
 * un control en la ruta, sin depender de que el papel esté en la cabina.
 *
 * Funciona sin señal: el PDF se arma en el teléfono con el documento que ya está
 * en la caché, así que un control en la ruta no depende de la cobertura.
 */
export default function MisPapelesCard() {
  const { remitos } = useRemitosCargaChofer()
  const { abrir } = useVisorComprobante()
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!remitos.length) return null

  const ver = async (r: RemitoCarga) => {
    setAbriendo(r.id); setError('')
    try {
      // Los generadores se cargan al tocar el botón, no con el inicio (R9).
      const blob = await (r.remitoR
        ? import('@/utils/remitoCargaOficialPdf').then((m) => m.generateRemitoCargaOficial(r))
        : import('@/utils/pdf').then((m) => m.generateRemitoCarga({
          codigo: r.codigo, plantaId: r.plantaId, camionLabel: r.camionLabel, choferNombre: r.choferNombre,
          items: r.items, palletsCarga: r.palletsCarga, envases: r.envases, creadoPor: r.creadoPor,
          fecha: r.fecha.toDate(),
          ...(r.cot?.estado === 'presentado' && r.cot.numero ? { cot: { numero: r.cot.numero, fechaValidez: r.cot.fechaValidez } } : {}),
          ...(r.kg ? { kg: r.kg } : {}),
        })))
      if (blob) {
        abrir({
          blob,
          nombre: `${r.codigo}.pdf`,
          titulo: r.remitoR ? `Remito R ${r.codigo}` : `Remito de carga ${r.codigo}`,
          subtitulo: `${r.camionLabel} · ${r.choferNombre}`,
        })
      }
    } catch (err) {
      reportError(err, { origen: 'MisPapelesCard', accion: 'verRemito', remitoId: r.id })
      setError('No se pudo abrir el remito. Probá de nuevo.')
    } finally { setAbriendo(null) }
  }

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 shadow-sm space-y-3">
      <h2 className="text-sm font-semibold text-secundario uppercase tracking-wide flex items-center gap-1.5">
        <FileText size={15} /> Mis papeles
      </h2>

      {remitos.map((r) => (
        <div key={r.id} className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-base font-bold text-gray-900 tabular-nums">{r.codigo}</span>
            <span className="text-sm text-secundario truncate" title={r.camionLabel}>{r.camionLabel}</span>
          </div>

          {r.remitoR && (
            <p className="text-sm text-secundario tabular-nums">
              Remito R {String(r.remitoR.puntoVenta).padStart(4, '0')}-{String(r.remitoR.numero).padStart(8, '0')}
            </p>
          )}

          {/* El COT, bien a la vista: es lo que pide un control de ARBA en la
              ruta, y el chofer lo tiene que poder leer sin abrir el PDF. */}
          {r.cotSolicitud && (
            r.cot?.estado === 'presentado' ? (
              <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-secundario flex items-center gap-1">
                  <ShieldCheck size={13} /> COT de ARBA
                </p>
                <p className="text-xl font-black tabular-nums text-gray-900 break-all">{r.cot.numero}</p>
                {r.cot.fechaValidez && <p className="text-sm text-secundario">Vale hasta el {r.cot.fechaValidez}</p>}
              </div>
            ) : (
              <p className="text-sm text-[#8A5203]">
                El COT todavía no salió. No arranques sin el número: pedíselo al muelle.
              </p>
            )
          )}

          <p className="text-sm text-secundario">
            {r.items.reduce((s, i) => s + i.cantidad, 0)} bolsas · {describirEnvases(envasesDeRemito(r)) || 'sin envases'}
          </p>

          <Button variant="outline" onClick={() => ver(r)} loading={abriendo === r.id} className="w-full h-11">
            <Eye size={16} /> Ver el remito
          </Button>
        </div>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  )
}
