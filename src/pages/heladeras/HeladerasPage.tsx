import { useState, useMemo, FormEvent } from 'react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import CrearHeladeraModal, { CrearHeladeraData } from '../../components/heladeras/CrearHeladeraModal'
import TipoReparacionChecklist from '../../components/heladeras/TipoReparacionChecklist'
import { useAuth } from '../../context/AuthContext'
import { useHeladeras } from '../../hooks/useHeladeras'
import { usePasosTaller } from '../../hooks/usePasosTaller'
import { useTiposReparacion } from '../../hooks/useReparacionCatalogos'
import {
  agarrarPaso, soltarPaso, liberarForzado, liberarSinReacondicionar,
  aprobarPaso, rechazarPaso, marcarBaja, crearHeladera,
  HeladeraNoDisponibleError, TrabajoHecho,
} from '../../services/heladeraService'
import { pasoActual, pasosOrdenados } from '../../utils/heladeraPipeline'
import { AreaHeladera, Heladera, PasoTaller, TipoPipelineHeladera, TipoReparacion } from '../../types'
import { ESTADO_HELADERA_LABELS as ESTADO_LABELS, SECTORES_REPARACION, TIPO_PIPELINE_LABELS } from '../../utils/heladeraLabels'

function StatTile({ value, label, tone }: { value: number; label: string; tone?: 'warn' | 'good' }) {
  return (
    <div className={`bg-white border rounded-xl p-3.5 flex flex-col gap-1 ${
      tone === 'warn' ? 'border-t-4 border-t-amber-500 border-x-[#D3D1C7] border-b-[#D3D1C7]'
        : tone === 'good' ? 'border-t-4 border-t-accent border-x-[#D3D1C7] border-b-[#D3D1C7]'
        : 'border-[#D3D1C7]'
    }`}>
      <span className={`text-2xl font-bold tabular-nums ${
        tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-accent' : 'text-gray-900'
      }`}>{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  )
}

// Filtra el catálogo de tipos de reparación al sector del paso — solo
// aplica a pasos de pintura/lijado/refrigeración (los de fabricación, ej.
// plástico o terminación, no tienen "tipos de reparación").
function tiposDelSector(area: AreaHeladera | undefined, tipos: TipoReparacion[]): TipoReparacion[] {
  if (!area || !SECTORES_REPARACION.includes(area)) return []
  return tipos.filter((t) => t.activo && t.area === area)
}

function SoltarModal({
  area, tipos, onClose, onSave,
}: {
  area?:   AreaHeladera
  tipos:   TipoReparacion[]
  onClose: () => void
  onSave:  (trabajo: TrabajoHecho) => Promise<void>
}) {
  const [seleccionados, setSeleccionados] = useState<string[]>([])
  const [notas, setNotas]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const opciones = tiposDelSector(area, tipos)
  const toggle = (id: string) => setSeleccionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (opciones.length > 0 && seleccionados.length === 0) { setError('Tildá al menos un arreglo'); return }
    if (opciones.length === 0 && !notas.trim()) { setError('Contá qué le hiciste'); return }
    setSaving(true)
    try {
      const tipos = opciones.filter((t) => seleccionados.includes(t.id)).map((t) => ({ tipoId: t.id, tipoNombre: t.nombre }))
      await onSave({ tipos, notas: notas.trim() || undefined })
      onClose()
    } catch {
      setError('No se pudo guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Soltar heladera" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <TipoReparacionChecklist tipos={opciones} seleccionados={seleccionados} onToggle={toggle} showSearch={opciones.length > 6} />
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Notas adicionales (opcional)</label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            placeholder="Algo que no esté en la lista de arriba"
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <p className="text-xs text-gray-500 -mt-2">Pasa al siguiente paso del pipeline.</p>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" loading={saving} className="flex-1">Soltar</Button>
        </div>
      </form>
    </Modal>
  )
}

function AprobacionModal({
  area, tipos, onClose, onAprobar, onRechazar,
}: {
  area?:      AreaHeladera
  tipos:      TipoReparacion[]
  onClose:    () => void
  onAprobar:  (trabajo: TrabajoHecho) => Promise<void>
  onRechazar: (motivo: string) => Promise<void>
}) {
  const [rechazando, setRechazando]       = useState(false)
  const [seleccionados, setSeleccionados] = useState<string[]>([])
  const [notas, setNotas]                 = useState('')
  const [motivo, setMotivo]               = useState('')
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState('')

  const opciones = tiposDelSector(area, tipos)
  const toggle = (id: string) => setSeleccionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const handleAprobar = async () => {
    if (opciones.length > 0 && seleccionados.length === 0) { setError('Tildá al menos un arreglo'); return }
    setSaving(true); setError('')
    try {
      const tipos = opciones.filter((t) => seleccionados.includes(t.id)).map((t) => ({ tipoId: t.id, tipoNombre: t.nombre }))
      await onAprobar({ tipos, notas: notas.trim() || undefined })
      onClose()
    } catch { setError('No se pudo aprobar. Intentá de nuevo.') } finally { setSaving(false) }
  }

  const handleRechazar = async (e: FormEvent) => {
    e.preventDefault()
    if (!motivo.trim()) { setError('Contá por qué se rechaza'); return }
    setSaving(true); setError('')
    try { await onRechazar(motivo.trim()); onClose() } catch { setError('No se pudo rechazar. Intentá de nuevo.') } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Aprobar paso" wide>
      {!rechazando ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">¿La heladera pasa este control?</p>
          <TipoReparacionChecklist tipos={opciones} seleccionados={seleccionados} onToggle={toggle} showSearch={opciones.length > 6} />
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Notas adicionales (opcional)</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Algo que no esté en la lista de arriba"
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 text-red-500 border-red-200 hover:bg-red-50" onClick={() => setRechazando(true)}>Rechazar</Button>
            <Button className="flex-1" loading={saving} onClick={handleAprobar}>Aprobar — disponible</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleRechazar} className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Motivo del rechazo</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder="Ej: sigue perdiendo gas"
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <p className="text-xs text-gray-500 -mt-2">Vuelve al primer paso para reprocesarse desde cero (nuevo ciclo).</p>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" type="button" className="flex-1" onClick={() => setRechazando(false)}>Volver</Button>
            <Button type="submit" className="flex-1 bg-red-500 hover:bg-red-600" loading={saving}>Confirmar rechazo</Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function HeladeraCard({
  heladera, paso, isEncargado, isMine, onAgarrar, onSoltar, onBaja, onLiberar, onDisponibleSinArreglo,
}: {
  heladera:    Heladera
  paso?:       PasoTaller
  isEncargado: boolean
  isMine:      boolean
  onAgarrar?:  () => void
  onSoltar?:   () => void
  onBaja?:     () => void
  onLiberar?:  () => void
  onDisponibleSinArreglo?: () => void
}) {
  const badge = heladera.estado === 'en_taller' ? (paso?.nombre ?? 'En taller') : ESTADO_LABELS[heladera.estado]
  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-bold text-sm text-gray-900">{heladera.codigoInterno}</p>
        <p className="text-gray-500 text-xs">{heladera.modelo} · serie {heladera.numeroSerie}</p>
        <p className="text-xs text-gray-400 mt-1">
          {heladera.motivoIngresoNombre ?? TIPO_PIPELINE_LABELS[heladera.tipoPipeline]}
          {heladera.cicloActual > 1 ? ` · ciclo ${heladera.cicloActual}` : ''}
        </p>
        {heladera.enProceso && (
          <p className="text-xs text-gray-400">con {heladera.enProceso.nombre}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs px-2 py-1 rounded-full bg-accent/10 text-accent border border-accent/25 font-medium">
          {badge}
        </span>
        {onAgarrar && <Button size="sm" onClick={onAgarrar}>Agarrar</Button>}
        {isMine && onSoltar && <Button size="sm" onClick={onSoltar}>Soltar</Button>}
        {isEncargado && onLiberar && <Button size="sm" variant="outline" onClick={onLiberar}>Liberar</Button>}
        {isEncargado && onDisponibleSinArreglo && (
          <Button size="sm" variant="outline" onClick={onDisponibleSinArreglo}>Disponible sin arreglo</Button>
        )}
        {isEncargado && onBaja && <Button size="sm" variant="outline" onClick={onBaja}>Baja</Button>}
      </div>
    </div>
  )
}

const TIPOS_PIPELINE = ['fabricacion', 'reacondicionamiento'] as const

export default function HeladerasPage() {
  const { user } = useAuth()
  const { heladeras, loading }              = useHeladeras()
  const { pasos: catalogo, isLoading: loadingPasos } = usePasosTaller()
  const { tipos: tiposReparacion }          = useTiposReparacion()
  const [crearModal, setCrearModal]             = useState<TipoPipelineHeladera | null>(null)
  const [soltarId, setSoltarId]                 = useState<string | null>(null)
  const [aprobacionId, setAprobacionId]         = useState<string | null>(null)
  const [error, setError]                       = useState('')

  // super_admin ya no llega a esta pantalla (ver Fase 2 del plan de
  // migración del Backoffice) — gerente_comercial sí, y antes se quedaba
  // sin ver ninguna de las acciones de gestión pese a poder entrar por
  // ruta (App.tsx). Bug cerrado: ahora coincide con el allowedRoles real.
  const isEncargado = user?.rol === 'heladeras_encargado' || user?.rol === 'gerente_comercial'
  const actor = user ? { uid: user.uid, nombre: user.nombre } : null

  const misEnProceso = useMemo(
    () => heladeras.filter((h) => h.enProceso?.uid === user?.uid),
    [heladeras, user?.uid],
  )

  if (loading || loadingPasos || !user || !actor) return <LoadingSpinner fullScreen />

  const runAction = async (fn: () => Promise<void>) => {
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err instanceof HeladeraNoDisponibleError ? err.message : 'No se pudo completar la acción. Intentá de nuevo.')
    }
  }

  const soltando  = soltarId     ? heladeras.find((h) => h.id === soltarId) : null
  const aprobando = aprobacionId ? heladeras.find((h) => h.id === aprobacionId) : null

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-3xl mx-auto p-4 space-y-8 pb-10">

        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Heladeras</h1>
            <p className="text-gray-500 text-sm">Taller: fabricación y reacondicionamiento</p>
          </div>
          {isEncargado && (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={() => setCrearModal('fabricacion')}>+ Fabricar heladera nueva</Button>
              <button
                onClick={() => setCrearModal('reacondicionamiento')}
                className="text-xs text-gray-500 hover:text-accent underline-offset-2 hover:underline"
              >
                Registrar equipo usado no cargado
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        {/* Las que tengo yo — de cualquiera de los dos pipelines */}
        {misEnProceso.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Las que tengo yo</h2>
            <div className="space-y-2">
              {misEnProceso.map((h) => {
                const paso = pasoActual(h, catalogo)
                return (
                  <HeladeraCard
                    key={h.id} heladera={h} paso={paso} isEncargado={isEncargado} isMine
                    onSoltar={() => (paso?.requiereAprobacion ? setAprobacionId(h.id) : setSoltarId(h.id))}
                  />
                )
              })}
            </div>
          </section>
        )}

        {TIPOS_PIPELINE.map((tipo) => {
          const pasosDelTipo     = pasosOrdenados(catalogo, tipo)
          const heladerasDelTipo = heladeras.filter((h) => h.tipoPipeline === tipo)
          const disponibles      = heladerasDelTipo.filter((h) => h.estado === 'disponible')
          const primerPaso       = pasosDelTipo[0]

          return (
            <section key={tipo} className="space-y-6 border-t border-[#D3D1C7] pt-6 first:border-0 first:pt-0">
              <h2 className="text-xl font-bold text-gray-900">{TIPO_PIPELINE_LABELS[tipo]}</h2>

              {pasosDelTipo.length === 0 ? (
                <p className="text-gray-400 text-sm">Todavía no hay pasos configurados para este pipeline.</p>
              ) : (
                <>
                  {/* Tablero en vivo */}
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                    {primerPaso && (
                      <StatTile
                        value={heladerasDelTipo.filter((h) => h.pasoActualId === primerPaso.id && !h.enProceso).length}
                        label={`Esperando ${primerPaso.nombre.toLowerCase()}`}
                      />
                    )}
                    {pasosDelTipo.map((paso) => (
                      <StatTile
                        key={paso.id}
                        value={heladerasDelTipo.filter((h) => h.pasoActualId === paso.id && h.enProceso).length}
                        label={paso.nombre}
                        tone={paso.requiereAprobacion ? 'warn' : undefined}
                      />
                    ))}
                    <StatTile value={disponibles.length} label="Disponible" tone="good" />
                  </div>

                  {/* Un bloque por paso: cola esperando + en proceso de otra persona */}
                  {pasosDelTipo.map((paso) => {
                    const cola = heladerasDelTipo.filter((h) => h.pasoActualId === paso.id && !h.enProceso)
                    const enProcesoAjeno = heladerasDelTipo.filter(
                      (h) => h.pasoActualId === paso.id && h.enProceso && h.enProceso.uid !== user.uid,
                    )
                    const puedeAgarrar = user.area === paso.area
                    return (
                      <section key={paso.id} className="space-y-3">
                        <h3 className="text-lg font-semibold">Esperando {paso.nombre.toLowerCase()}</h3>
                        {cola.length === 0 ? (
                          <p className="text-gray-400 text-sm">No hay heladeras esperando este paso.</p>
                        ) : (
                          <div className="space-y-2">
                            {cola.map((h) => (
                              <HeladeraCard
                                key={h.id} heladera={h} paso={paso} isEncargado={isEncargado} isMine={false}
                                onAgarrar={puedeAgarrar ? () => runAction(() => agarrarPaso(h.id, actor, paso.area, catalogo)) : undefined}
                                onBaja={isEncargado ? () => runAction(() => marcarBaja(h.id, actor, 'Sin arreglo posible')) : undefined}
                                onDisponibleSinArreglo={
                                  isEncargado && h.pasoActualId === h.primerPasoId
                                    ? () => runAction(() => liberarSinReacondicionar(h.id, actor))
                                    : undefined
                                }
                              />
                            ))}
                          </div>
                        )}
                        {isEncargado && enProcesoAjeno.length > 0 && (
                          <div className="space-y-2">
                            {enProcesoAjeno.map((h) => (
                              <HeladeraCard
                                key={h.id} heladera={h} paso={paso} isEncargado isMine={false}
                                onLiberar={() => runAction(() => liberarForzado(h.id, actor))}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </>
              )}
            </section>
          )
        })}
      </main>

      {crearModal && (
        <CrearHeladeraModal
          tipoPipeline={crearModal}
          onClose={() => setCrearModal(null)}
          onSave={(data: CrearHeladeraData) => crearHeladera(data, actor, catalogo)}
        />
      )}

      {soltando && soltarId && (
        <SoltarModal
          area={pasoActual(soltando, catalogo)?.area}
          tipos={tiposReparacion}
          onClose={() => setSoltarId(null)}
          onSave={(trabajo) => soltarPaso(soltarId, actor, trabajo, catalogo)}
        />
      )}

      {aprobando && aprobacionId && (
        <AprobacionModal
          area={pasoActual(aprobando, catalogo)?.area}
          tipos={tiposReparacion}
          onClose={() => setAprobacionId(null)}
          onAprobar={(trabajo) => aprobarPaso(aprobacionId, actor, catalogo, trabajo)}
          onRechazar={(motivo) => rechazarPaso(aprobacionId, actor, motivo, catalogo)}
        />
      )}
    </div>
  )
}
