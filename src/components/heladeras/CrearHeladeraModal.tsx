import { useState, useMemo, FormEvent } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { useModelosHeladera } from '../../hooks/useModelosHeladera'
import { useMotivosIngreso } from '../../hooks/useMotivosIngreso'
import { usePasosTaller } from '../../hooks/usePasosTaller'
import { CodigoHeladeraDuplicadoError } from '../../services/heladeraService'
import { primerPasoActivo } from '../../utils/heladeraPipeline'
import { TIPO_OPERACION_LABELS, TIPO_PIPELINE_LABELS } from '../../utils/heladeraLabels'
import { TipoOperacionIngreso, TipoPipelineHeladera } from '../../types'

export interface CrearHeladeraData {
  numeroSerie:          string
  codigoInterno:        string
  modeloId:             string
  modeloNombre:         string
  tipoPipeline:         TipoPipelineHeladera
  motivoIngresoId?:     string
  motivoIngresoNombre?: string
  tipoOperacion?:       TipoOperacionIngreso
  observaciones?:       string
}

export default function CrearHeladeraModal({
  onClose, onSave,
}: {
  onClose: () => void
  onSave:  (data: CrearHeladeraData) => Promise<void>
}) {
  const { modelos } = useModelosHeladera()
  const modelosActivos = useMemo(() => modelos.filter((m) => m.activo), [modelos])
  const { motivos } = useMotivosIngreso()
  const motivosActivos = useMemo(() => motivos.filter((m) => m.activo), [motivos])
  const { pasos: catalogoPasos } = usePasosTaller()

  const [tipoPipeline,  setTipoPipeline]  = useState<TipoPipelineHeladera>('fabricacion')
  const [numeroSerie,   setNumeroSerie]   = useState('')
  const [codigoInterno, setCodigoInterno] = useState('')
  const [modeloId,      setModeloId]      = useState('')
  const [motivoId,      setMotivoId]      = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  const esReacondicionamiento = tipoPipeline === 'reacondicionamiento'
  const motivoElegido = motivosActivos.find((m) => m.id === motivoId)
  const sinPasos = !primerPasoActivo(catalogoPasos, tipoPipeline)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!numeroSerie.trim() || !codigoInterno.trim() || !modeloId) {
      setError('Completá número de serie, código interno y modelo')
      return
    }
    if (esReacondicionamiento && !motivoId) {
      setError('Elegí el motivo de ingreso')
      return
    }
    const modelo = modelosActivos.find((m) => m.id === modeloId)
    if (!modelo) { setError('Elegí un modelo válido'); return }
    const motivo = esReacondicionamiento ? motivosActivos.find((m) => m.id === motivoId) : undefined
    if (esReacondicionamiento && !motivo) { setError('Elegí un motivo de ingreso válido'); return }
    setSaving(true)
    try {
      await onSave({
        numeroSerie:          numeroSerie.trim(),
        codigoInterno:        codigoInterno.trim(),
        modeloId,
        modeloNombre:         modelo.nombre,
        tipoPipeline,
        motivoIngresoId:      motivo?.id,
        motivoIngresoNombre:  motivo?.nombre,
        tipoOperacion:        motivo?.tipoOperacion,
        observaciones:        observaciones.trim() || undefined,
      })
      onClose()
    } catch (err) {
      setError(err instanceof CodigoHeladeraDuplicadoError ? err.message : 'No se pudo cargar la heladera. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Cargar heladera nueva">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">¿Qué tipo de ingreso es?</label>
          <select
            value={tipoPipeline}
            onChange={(e) => setTipoPipeline(e.target.value as TipoPipelineHeladera)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="fabricacion">{TIPO_PIPELINE_LABELS.fabricacion} (heladera nueva)</option>
            <option value="reacondicionamiento">{TIPO_PIPELINE_LABELS.reacondicionamiento} (equipo usado)</option>
          </select>
          {sinPasos && (
            <p className="text-xs text-amber-600 mt-1">
              Todavía no hay pasos configurados para {TIPO_PIPELINE_LABELS[tipoPipeline].toLowerCase()} — agregá uno primero en "Catálogos de service".
            </p>
          )}
        </div>
        <Input label="Código interno" value={codigoInterno} onChange={(e) => setCodigoInterno(e.target.value)} required placeholder="Tu código propio" />
        <Input label="Número de serie" value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} required placeholder="HL-0042" />
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Modelo</label>
          <select
            value={modeloId}
            onChange={(e) => setModeloId(e.target.value)}
            required
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Elegí un modelo…</option>
            {modelosActivos.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
          {modelosActivos.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">Todavía no hay modelos cargados — agregá uno primero en "Modelos".</p>
          )}
        </div>
        {esReacondicionamiento && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Motivo de ingreso</label>
            <select
              value={motivoId}
              onChange={(e) => setMotivoId(e.target.value)}
              required
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Elegí un motivo…</option>
              {motivosActivos.map((m) => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
            {motivosActivos.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Todavía no hay motivos cargados — agregá uno primero en "Catálogos de service".</p>
            )}
            {motivoElegido && (
              <p className="text-xs text-gray-500 mt-1">Tipo de operación: <span className="font-medium text-gray-700">{TIPO_OPERACION_LABELS[motivoElegido.tipoOperacion]}</span></p>
            )}
          </div>
        )}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Observaciones (opcional)</label>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            placeholder="Detalle adicional del ingreso"
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" loading={saving} disabled={sinPasos} className="flex-1">Cargar</Button>
        </div>
      </form>
    </Modal>
  )
}
