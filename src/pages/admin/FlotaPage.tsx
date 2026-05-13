import { useState, ChangeEvent } from 'react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import { useFlota } from '../../hooks/useFlota'
import { useChoferes } from '../../hooks/useChoferes'
import { useAllOrders } from '../../hooks/useOrders'
import { addCamion, updateCamion, asignarCamion } from '../../services/flotaService'
import { Camion, UserProfile } from '../../types'

function isConfirmadoHoy(fechaAsignacion?: { toDate?: () => Date } | null): boolean {
  if (!fechaAsignacion?.toDate) return false
  const hoy = new Date().toLocaleDateString('es-AR')
  return fechaAsignacion.toDate().toLocaleDateString('es-AR') === hoy
}

// ── Formulario de camión ───────────────────────────────────────────────────────

function CamionForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Camion>
  onSave:   (data: { patente: string; modelo: string; marca: string }) => Promise<void>
  onCancel: () => void
}) {
  const [patente, setPatente] = useState(initial?.patente ?? '')
  const [modelo,  setModelo]  = useState(initial?.modelo  ?? '')
  const [marca,   setMarca]   = useState(initial?.marca   ?? '')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const handleSubmit = async () => {
    if (!patente.trim() || !modelo.trim()) { setError('Patente y modelo son obligatorios'); return }
    setSaving(true)
    await onSave({ patente: patente.trim().toUpperCase(), modelo: modelo.trim(), marca: marca.trim() })
    setSaving(false)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted mb-1 block">Patente *</label>
          <input
            value={patente}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPatente(e.target.value)}
            placeholder="AB123CD"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent uppercase"
          />
        </div>
        <div>
          <label className="text-xs text-muted mb-1 block">Marca</label>
          <input
            value={marca}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setMarca(e.target.value)}
            placeholder="Iveco, Mercedes..."
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted mb-1 block">Modelo *</label>
        <input
          value={modelo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setModelo(e.target.value)}
          placeholder="Daily 35S14, Sprinter 313..."
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onCancel} className="flex-1 text-sm">Cancelar</Button>
        <Button onClick={handleSubmit} loading={saving} className="flex-1 text-sm">Guardar</Button>
      </div>
    </div>
  )
}

// ── Fila de chofer con asignación ─────────────────────────────────────────────

function ChoferAsignacionRow({
  chofer,
  camiones,
  tieneOrdenesHoy,
  onChange,
}: {
  chofer:          UserProfile
  camiones:        Camion[]
  tieneOrdenesHoy: boolean
  onChange:        () => void
}) {
  const [busy,    setBusy]    = useState(false)
  const confirmadoHoy = isConfirmadoHoy(chofer.camionFechaAsignacion)
  const sinCamion     = !chofer.camionId

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    setBusy(true)
    const camion = camiones.find((c) => c.id === e.target.value) ?? null
    await asignarCamion(chofer.uid, camion)
    onChange()
    setBusy(false)
  }

  const handleConfirmar = async () => {
    if (!chofer.camionId) return
    const camion = camiones.find((c) => c.id === chofer.camionId) ?? null
    setBusy(true)
    await asignarCamion(chofer.uid, camion)
    onChange()
    setBusy(false)
  }

  const needsAttention = tieneOrdenesHoy && (!confirmadoHoy || sinCamion)

  return (
    <div className={`bg-surface border rounded-xl p-4 flex flex-wrap items-center gap-3 ${
      needsAttention ? 'border-orange-500/40' : 'border-border'
    }`}>
      {/* Indicador */}
      <div className="shrink-0">
        {needsAttention ? (
          <span className="text-orange-400 text-lg">⚠</span>
        ) : confirmadoHoy ? (
          <span className="text-success text-lg">✓</span>
        ) : (
          <span className="text-muted text-lg">·</span>
        )}
      </div>

      {/* Nombre */}
      <div className="flex-1 min-w-32">
        <p className="font-semibold text-sm">{chofer.nombreContacto || chofer.nombre}</p>
        {confirmadoHoy && chofer.camionFechaAsignacion?.toDate && (
          <p className="text-xs text-muted mt-0.5">
            Confirmado {chofer.camionFechaAsignacion.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {!confirmadoHoy && chofer.camionId && (
          <p className="text-xs text-orange-400 mt-0.5">Sin confirmar hoy</p>
        )}
        {sinCamion && (
          <p className="text-xs text-orange-400 mt-0.5">Sin camión asignado</p>
        )}
      </div>

      {/* Selector */}
      <select
        value={chofer.camionId ?? ''}
        disabled={busy}
        onChange={handleChange}
        className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-44 max-w-xs disabled:opacity-50"
      >
        <option value="">— Sin camión —</option>
        {camiones.filter((c) => c.activo).map((c) => (
          <option key={c.id} value={c.id}>
            {c.patente} — {c.marca ? `${c.marca} ` : ''}{c.modelo}
          </option>
        ))}
      </select>

      {/* Confirmar (solo si ya tiene asignado y no confirmó hoy) */}
      {chofer.camionId && !confirmadoHoy && (
        <Button
          onClick={handleConfirmar}
          loading={busy}
          className="text-xs py-1.5 px-3 shrink-0"
        >
          ✓ Confirmar
        </Button>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function FlotaPage() {
  const { camiones, loading: loadingCamiones } = useFlota()
  const { choferes, loading: loadingChoferes } = useChoferes()
  const { orders }                              = useAllOrders()
  const [addModal,  setAddModal]   = useState(false)
  const [editCamion, setEditCamion] = useState<Camion | null>(null)
  const [refresh,   setRefresh]    = useState(0)

  const reload = () => setRefresh((n) => n + 1)

  // Choferes con pedidos activos hoy
  const chofereConOrdenesHoy = new Set(
    orders
      .filter((o) => !['entregado', 'cancelado'].includes(o.status) && o.driverId)
      .map((o) => o.driverId!),
  )

  const sinConfirmarHoy = choferes.filter(
    (c) => chofereConOrdenesHoy.has(c.email) && (!isConfirmadoHoy(c.camionFechaAsignacion) || !c.camionId),
  )

  if (loadingCamiones || loadingChoferes) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-8 pb-10" key={refresh}>

        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Flota de camiones</h1>
            <p className="text-muted text-sm">{camiones.filter((c) => c.activo).length} vehículos activos</p>
          </div>
        </div>

        {/* Alerta del día */}
        {sinConfirmarHoy.length > 0 && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-orange-400 text-xl shrink-0">⚠</span>
            <div>
              <p className="text-orange-400 font-semibold text-sm">
                {sinConfirmarHoy.length} chofer{sinConfirmarHoy.length !== 1 ? 'es' : ''} sin camión confirmado para hoy
              </p>
              <p className="text-orange-400/70 text-xs mt-0.5">
                {sinConfirmarHoy.map((c) => c.nombreContacto || c.nombre).join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* ── Asignación del día ──────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Asignación del día</h2>
            <span className="text-xs text-muted">
              {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          </div>

          {choferes.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-6 text-center">
              <p className="text-muted text-sm">No hay choferes activos</p>
            </div>
          ) : (
            <div className="space-y-2">
              {choferes.map((chofer) => (
                <ChoferAsignacionRow
                  key={chofer.uid}
                  chofer={chofer}
                  camiones={camiones}
                  tieneOrdenesHoy={chofereConOrdenesHoy.has(chofer.email)}
                  onChange={reload}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Vehículos ───────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Vehículos</h2>
            <Button onClick={() => setAddModal(true)} className="text-sm">+ Agregar</Button>
          </div>

          {camiones.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-8 text-center">
              <p className="text-4xl mb-3">🚛</p>
              <p className="text-muted text-sm">Todavía no cargaste ningún vehículo</p>
              <p className="text-muted/60 text-xs mt-1">Usá el botón "Agregar" para empezar</p>
            </div>
          ) : (
            <div className="space-y-2">
              {camiones.map((c) => {
                const asignadoA = choferes.find((ch) => ch.camionId === c.id)
                return (
                  <div
                    key={c.id}
                    className={`bg-surface border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 ${
                      c.activo ? 'border-border' : 'border-border/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🚛</span>
                      <div>
                        <p className="font-bold text-sm tracking-wide">{c.patente}</p>
                        <p className="text-muted text-xs">
                          {c.marca ? `${c.marca} · ` : ''}{c.modelo}
                        </p>
                        {asignadoA && (
                          <p className="text-xs text-accent mt-0.5">
                            Asignado a {asignadoA.nombreContacto || asignadoA.nombre}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        c.activo
                          ? 'bg-green-500/20 text-green-400 border-green-500/30'
                          : 'bg-muted/10 text-muted border-muted/20'
                      }`}>
                        {c.activo ? 'Activo' : 'Inactivo'}
                      </span>
                      <button
                        onClick={() => setEditCamion(c)}
                        className="text-xs text-muted hover:text-white border border-border hover:border-accent rounded-lg px-3 py-1.5 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => updateCamion(c.id, { activo: !c.activo })}
                        className="text-xs text-muted hover:text-white border border-border hover:border-accent rounded-lg px-3 py-1.5 transition-colors"
                      >
                        {c.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>

      {/* Modal agregar */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Agregar vehículo">
        <CamionForm
          onSave={async (data) => { await addCamion(data); setAddModal(false) }}
          onCancel={() => setAddModal(false)}
        />
      </Modal>

      {/* Modal editar */}
      {editCamion && (
        <Modal open onClose={() => setEditCamion(null)} title="Editar vehículo">
          <CamionForm
            initial={editCamion}
            onSave={async (data) => { await updateCamion(editCamion.id, data); setEditCamion(null) }}
            onCancel={() => setEditCamion(null)}
          />
        </Modal>
      )}
    </>
  )
}
