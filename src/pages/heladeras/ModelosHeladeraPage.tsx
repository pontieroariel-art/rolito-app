import { useState, ChangeEvent } from 'react'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import { useModelosHeladera } from '../../hooks/useModelosHeladera'
import { crearModeloHeladera, actualizarModeloHeladera } from '../../services/modelosHeladeraService'
import { ModeloHeladera } from '../../types'

// ── Formulario de modelo ────────────────────────────────────────────────────

type ModeloFormData = {
  nombre:          string
  ancho:           number
  alto:            number
  profundo:        number
  capacidadBolsas: number
  fotoUrl:         string
  prefijoCodigo:   string
}

function ModeloForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<ModeloHeladera>
  onSave:   (data: ModeloFormData) => Promise<void>
  onCancel: () => void
}) {
  const [nombre,   setNombre]   = useState(initial?.nombre ?? '')
  const [ancho,    setAncho]    = useState(initial?.medidas?.ancho?.toString() ?? '')
  const [alto,     setAlto]     = useState(initial?.medidas?.alto?.toString() ?? '')
  const [profundo, setProfundo] = useState(initial?.medidas?.profundo?.toString() ?? '')
  const [bolsas,   setBolsas]   = useState(initial?.capacidadBolsas?.toString() ?? '')
  const [fotoUrl,  setFotoUrl]  = useState(initial?.fotoUrl ?? '')
  const [prefijoCodigo, setPrefijoCodigo] = useState(initial?.prefijoCodigo ?? '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const handleSubmit = async () => {
    if (!nombre.trim()) { setError('El nombre del modelo es obligatorio'); return }
    setSaving(true)
    setError('')
    try {
      await onSave({
        nombre:          nombre.trim(),
        ancho:           Number(ancho) || 0,
        alto:            Number(alto) || 0,
        profundo:        Number(profundo) || 0,
        capacidadBolsas: Number(bolsas) || 0,
        fotoUrl:         fotoUrl.trim(),
        prefijoCodigo:   prefijoCodigo.trim().toUpperCase(),
      })
    } catch {
      setError('No se pudo guardar. Revisá tu conexión y reintentá.')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Nombre del modelo *</label>
        <input
          value={nombre}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNombre(e.target.value)}
          placeholder="Slim 300"
          className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Ancho (cm)</label>
          <input
            type="number" min={0} value={ancho}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAncho(e.target.value)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Alto (cm)</label>
          <input
            type="number" min={0} value={alto}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAlto(e.target.value)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Profundo (cm)</label>
          <input
            type="number" min={0} value={profundo}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setProfundo(e.target.value)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Capacidad (bolsas de hielo)</label>
        <input
          type="number" min={0} value={bolsas}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBolsas(e.target.value)}
          className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Foto ilustrativa (URL)</label>
        <input
          value={fotoUrl}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFotoUrl(e.target.value)}
          placeholder="https://..."
          className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Prefijo de código (opcional)</label>
        <input
          value={prefijoCodigo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPrefijoCodigo(e.target.value)}
          placeholder="SL300"
          className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p className="text-xs text-gray-400 mt-1">
          Base del código automático para heladeras de fabricación de este modelo (ej. {prefijoCodigo.trim() || 'SL300'}-0001). Si lo dejás vacío, se arma solo a partir del nombre.
        </p>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onCancel} className="flex-1 text-sm">Cancelar</Button>
        <Button onClick={handleSubmit} loading={saving} className="flex-1 text-sm">Guardar</Button>
      </div>
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function ModelosHeladeraPage() {
  const { modelos, loading } = useModelosHeladera()
  const [addModal,    setAddModal]    = useState(false)
  const [editModelo,  setEditModelo]  = useState<ModeloHeladera | null>(null)
  const [togglingId,  setTogglingId]  = useState<string | null>(null)
  const [toggleError, setToggleError] = useState('')

  const handleToggle = async (m: ModeloHeladera) => {
    setTogglingId(m.id)
    setToggleError('')
    try {
      await actualizarModeloHeladera(m.id, { activo: !m.activo })
    } catch {
      setToggleError('No se pudo actualizar. Revisá tu conexión y reintentá.')
    } finally {
      setTogglingId(null)
    }
  }

  if (loading) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">

        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Modelos de heladera</h1>
            <p className="text-gray-500 text-sm">Ficha técnica: medidas, capacidad y foto</p>
          </div>
          <Button onClick={() => setAddModal(true)} className="text-sm">+ Agregar</Button>
        </div>

        {toggleError && <p className="text-red-500 text-xs">{toggleError}</p>}

        {modelos.length === 0 ? (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
            <p className="text-4xl mb-3">🧊</p>
            <p className="text-gray-500 text-sm">Todavía no cargaste ningún modelo</p>
            <p className="text-gray-400 text-xs mt-1">Usá el botón "Agregar" para empezar</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {modelos.map((m) => (
              <div
                key={m.id}
                className={`bg-white border rounded-xl p-4 flex flex-col gap-2 ${
                  m.activo ? 'border-[#D3D1C7]' : 'border-[#D3D1C7]/40 opacity-60'
                }`}
              >
                {m.fotoUrl && (
                  <img src={m.fotoUrl} alt={m.nombre} className="w-full h-32 object-cover rounded-lg border border-[#D3D1C7]" />
                )}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-sm text-gray-900">{m.nombre}</p>
                    <p className="text-gray-500 text-xs">
                      {m.medidas.ancho}×{m.medidas.alto}×{m.medidas.profundo} cm · {m.capacidadBolsas} bolsas
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full border font-medium shrink-0 ${
                    m.activo
                      ? 'bg-green-100 text-green-700 border-green-200'
                      : 'bg-gray-100 text-gray-500 border-gray-200'
                  }`}>
                    {m.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    onClick={() => setEditModelo(m)}
                    className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-4 py-2 transition-colors min-h-[36px]"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleToggle(m)}
                    disabled={togglingId === m.id}
                    className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-4 py-2 transition-colors min-h-[36px] disabled:opacity-40"
                  >
                    {togglingId === m.id ? 'Guardando…' : m.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Modal open={addModal} onClose={() => setAddModal(false)} title="Agregar modelo">
        <ModeloForm
          onSave={async (data) => {
            await crearModeloHeladera({
              nombre: data.nombre,
              medidas: { ancho: data.ancho, alto: data.alto, profundo: data.profundo },
              capacidadBolsas: data.capacidadBolsas,
              ...(data.fotoUrl ? { fotoUrl: data.fotoUrl } : {}),
              ...(data.prefijoCodigo ? { prefijoCodigo: data.prefijoCodigo } : {}),
            })
            setAddModal(false)
          }}
          onCancel={() => setAddModal(false)}
        />
      </Modal>

      {editModelo && (
        <Modal open onClose={() => setEditModelo(null)} title="Editar modelo">
          <ModeloForm
            initial={editModelo}
            onSave={async (data) => {
              await actualizarModeloHeladera(editModelo.id, {
                nombre: data.nombre,
                medidas: { ancho: data.ancho, alto: data.alto, profundo: data.profundo },
                capacidadBolsas: data.capacidadBolsas,
                fotoUrl: data.fotoUrl,
                prefijoCodigo: data.prefijoCodigo,
              })
              setEditModelo(null)
            }}
            onCancel={() => setEditModelo(null)}
          />
        </Modal>
      )}
    </div>
  )
}
