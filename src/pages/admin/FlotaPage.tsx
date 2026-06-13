import { useState, useCallback, useMemo, ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Timestamp } from 'firebase/firestore'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import { useFlota } from '../../hooks/useFlota'
import { useChoferes } from '../../hooks/useChoferes'
import { useAllOrders } from '../../hooks/useOrders'
import { addCamion, updateCamion, asignarCamion } from '../../services/flotaService'
import { Camion, UserProfile, CANALES_CAMION, CanalCamion } from '../../types'

function isConfirmadoHoy(fechaAsignacion?: { toDate?: () => Date } | null): boolean {
  if (!fechaAsignacion?.toDate) return false
  const hoy = new Date().toLocaleDateString('es-AR')
  return fechaAsignacion.toDate().toLocaleDateString('es-AR') === hoy
}

// ── Formulario de camión ───────────────────────────────────────────────────────

type CamionFormData = {
  patente:          string
  modelo:           string
  marca:            string
  capacidadPallets: number | undefined
  canales:          CanalCamion[]
}

function CamionForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Camion>
  onSave:   (data: CamionFormData) => Promise<void>
  onCancel: () => void
}) {
  const [patente,  setPatente]  = useState(initial?.patente ?? '')
  const [modelo,   setModelo]   = useState(initial?.modelo  ?? '')
  const [marca,    setMarca]    = useState(initial?.marca   ?? '')
  const [pallets,  setPallets]  = useState<string>(initial?.capacidadPallets?.toString() ?? '')
  const [canales,  setCanales]  = useState<CanalCamion[]>(initial?.canales ?? [])
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const toggleCanal = (canal: CanalCamion) =>
    setCanales((prev) =>
      prev.includes(canal) ? prev.filter((c) => c !== canal) : [...prev, canal],
    )

  const handleSubmit = async () => {
    if (!patente.trim() || !modelo.trim()) { setError('Patente y modelo son obligatorios'); return }
    setSaving(true)
    await onSave({
      patente:          patente.trim().toUpperCase(),
      modelo:           modelo.trim(),
      marca:            marca.trim(),
      capacidadPallets: pallets ? parseInt(pallets) : undefined,
      canales,
    })
    setSaving(false)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Patente *</label>
          <input
            value={patente}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPatente(e.target.value)}
            placeholder="AB123CD"
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent uppercase"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Marca</label>
          <input
            value={marca}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setMarca(e.target.value)}
            placeholder="Iveco, Mercedes..."
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Modelo *</label>
          <input
            value={modelo}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setModelo(e.target.value)}
            placeholder="Daily 35S14, Sprinter 313..."
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Capacidad (pallets)</label>
          <input
            type="number"
            min={1}
            value={pallets}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPallets(e.target.value)}
            placeholder="Ej: 12"
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Canales */}
      <div>
        <label className="text-xs text-gray-500 mb-2 block">Canales de distribución</label>
        <div className="flex flex-wrap gap-2">
          {CANALES_CAMION.map((canal) => {
            const active = canales.includes(canal)
            return (
              <button
                key={canal}
                type="button"
                onClick={() => toggleCanal(canal)}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                  active
                    ? 'bg-accent/20 text-accent border-accent/50'
                    : 'bg-[#F8F7F2] text-gray-500 border-[#D3D1C7] hover:border-accent/50 hover:text-gray-700'
                }`}
              >
                {active ? '✓ ' : ''}{canal}
              </button>
            )
          })}
        </div>
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
  ocupados,
  tieneOrdenesHoy,
  onUpdate,
}: {
  chofer:          UserProfile
  camiones:        Camion[]
  ocupados:        Set<string>
  tieneOrdenesHoy: boolean
  onUpdate:        (uid: string, updates: Partial<UserProfile>) => void
}) {
  const confirmadoHoy = isConfirmadoHoy(chofer.camionFechaAsignacion)
  const sinCamion     = !chofer.camionId

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const camion = camiones.find((c) => c.id === e.target.value) ?? null
    onUpdate(chofer.uid, camion ? {
      camionId:              camion.id,
      camionPatente:         camion.patente,
      camionModelo:          camion.modelo,
      camionFechaAsignacion: Timestamp.fromDate(new Date()),
    } : {
      camionId:              null,
      camionPatente:         null,
      camionModelo:          null,
      camionFechaAsignacion: null,
    })
    asignarCamion(chofer.uid, camion).catch(console.error)
  }

  const handleConfirmar = () => {
    if (!chofer.camionId) return
    const camion = camiones.find((c) => c.id === chofer.camionId) ?? null
    onUpdate(chofer.uid, { camionFechaAsignacion: Timestamp.fromDate(new Date()) })
    asignarCamion(chofer.uid, camion).catch(console.error)
  }

  const needsAttention = tieneOrdenesHoy && (!confirmadoHoy || sinCamion)

  return (
    <div className={`bg-white border rounded-xl p-4 flex flex-wrap items-center gap-3 ${
      needsAttention ? 'border-amber-300' : 'border-[#D3D1C7]'
    }`}>
      {/* Indicador */}
      <div className="shrink-0">
        {needsAttention ? (
          <span className="text-amber-600 text-lg">⚠</span>
        ) : confirmadoHoy ? (
          <span className="text-success text-lg">✓</span>
        ) : (
          <span className="text-gray-400 text-lg">·</span>
        )}
      </div>

      {/* Nombre */}
      <div className="flex-1 min-w-32">
        <p className="font-semibold text-sm text-gray-900">{chofer.nombreContacto || chofer.nombre}</p>
        {confirmadoHoy && chofer.camionFechaAsignacion?.toDate && (
          <p className="text-xs text-gray-500 mt-0.5">
            Confirmado {chofer.camionFechaAsignacion.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {!confirmadoHoy && chofer.camionId && (
          <p className="text-xs text-amber-600 mt-0.5">Sin confirmar hoy</p>
        )}
        {sinCamion && (
          <p className="text-xs text-amber-600 mt-0.5">Sin camión asignado</p>
        )}
      </div>

      {/* Selector */}
      <select
        value={chofer.camionId ?? ''}
        onChange={handleChange}
        className="bg-white border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-44 max-w-xs"
      >
        <option value="">— Sin camión —</option>
        {camiones.filter((c) => c.activo && (!ocupados.has(c.id) || c.id === chofer.camionId)).map((c) => (
          <option key={c.id} value={c.id}>
            {c.patente} — {c.marca ? `${c.marca} ` : ''}{c.modelo}
          </option>
        ))}
      </select>

      {/* Confirmar (solo si ya tiene asignado y no confirmó hoy) */}
      {chofer.camionId && !confirmadoHoy && (
        <Button
          onClick={handleConfirmar}
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
  const queryClient                             = useQueryClient()
  const [addModal,   setAddModal]   = useState(false)
  const [editCamion, setEditCamion] = useState<Camion | null>(null)

  const ocupados = useMemo(
    () => new Set(choferes.filter((c) => c.camionId).map((c) => c.camionId!)),
    [choferes],
  )

  const handleChoferUpdate = useCallback((uid: string, updates: Partial<UserProfile>) => {
    queryClient.setQueryData<UserProfile[]>(['users', 'choferes'], (old) =>
      old?.map((u) => u.uid === uid ? { ...u, ...updates } : u) ?? []
    )
  }, [queryClient])

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
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-8 pb-10">

        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Flota de camiones</h1>
            <p className="text-gray-500 text-sm">{camiones.filter((c) => c.activo).length} vehículos activos</p>
          </div>
        </div>

        {/* Alerta del día */}
        {sinConfirmarHoy.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-amber-600 text-xl shrink-0">⚠</span>
            <div>
              <p className="text-amber-700 font-semibold text-sm">
                {sinConfirmarHoy.length} chofer{sinConfirmarHoy.length !== 1 ? 'es' : ''} sin camión confirmado para hoy
              </p>
              <p className="text-amber-600/70 text-xs mt-0.5">
                {sinConfirmarHoy.map((c) => c.nombreContacto || c.nombre).join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* ── Asignación del día ──────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Asignación del día</h2>
            <span className="text-xs text-gray-500">
              {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          </div>

          {choferes.length === 0 ? (
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-6 text-center">
              <p className="text-gray-500 text-sm">No hay choferes activos</p>
            </div>
          ) : (
            <div className="space-y-2">
              {choferes.map((chofer) => (
                <ChoferAsignacionRow
                  key={chofer.uid}
                  chofer={chofer}
                  camiones={camiones}
                  ocupados={ocupados}
                  tieneOrdenesHoy={chofereConOrdenesHoy.has(chofer.email)}
                  onUpdate={handleChoferUpdate}
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
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
              <p className="text-4xl mb-3">🚛</p>
              <p className="text-gray-500 text-sm">Todavía no cargaste ningún vehículo</p>
              <p className="text-gray-400 text-xs mt-1">Usá el botón "Agregar" para empezar</p>
            </div>
          ) : (
            <div className="space-y-2">
              {camiones.map((c) => {
                const asignadoA = choferes.find((ch) => ch.camionId === c.id)
                return (
                  <div
                    key={c.id}
                    className={`bg-white border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 ${
                      c.activo ? 'border-[#D3D1C7]' : 'border-[#D3D1C7]/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🚛</span>
                      <div>
                        <p className="font-bold text-sm tracking-wide text-gray-900">{c.patente}</p>
                        <p className="text-gray-500 text-xs">
                          {c.marca ? `${c.marca} · ` : ''}{c.modelo}
                        </p>
                        {asignadoA && (
                          <p className="text-xs text-accent mt-0.5">
                            Asignado a {asignadoA.nombreContacto || asignadoA.nombre}
                          </p>
                        )}
                        {c.capacidadPallets && (
                          <p className="text-xs text-gray-500 mt-0.5">{c.capacidadPallets} pallets cap.</p>
                        )}
                        {c.canales && c.canales.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {c.canales.map((canal) => (
                              <span
                                key={canal}
                                className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/25 font-medium"
                              >
                                {canal}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        c.activo
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : 'bg-gray-100 text-gray-500 border-gray-200'
                      }`}>
                        {c.activo ? 'Activo' : 'Inactivo'}
                      </span>
                      <button
                        onClick={() => setEditCamion(c)}
                        className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-3 py-1.5 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => updateCamion(c.id, { activo: !c.activo })}
                        className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-3 py-1.5 transition-colors"
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
            onSave={async (data) => {
              const payload: Parameters<typeof updateCamion>[1] = {
                patente: data.patente,
                modelo:  data.modelo,
                marca:   data.marca,
                canales: data.canales,
              }
              if (data.capacidadPallets !== undefined) payload.capacidadPallets = data.capacidadPallets
              await updateCamion(editCamion.id, payload)
              setEditCamion(null)
            }}
            onCancel={() => setEditCamion(null)}
          />
        </Modal>
      )}
    </div>
  )
}
