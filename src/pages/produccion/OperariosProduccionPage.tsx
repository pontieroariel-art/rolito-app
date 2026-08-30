import { useState, FormEvent, ChangeEvent } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useOperariosProduccion } from '../../hooks/useOperariosProduccion'
import { createOperarioProduccionUser, updateUserStatus } from '../../services/userService'
import { resetPinProduccion } from '../../services/produccionAuthService'
import { PLANTAS, PlantaId, UserProfile } from '../../types'

function CrearOperarioModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [nombre, setNombre] = useState('')
  const [legajo, setLegajo] = useState('')
  const [pin,    setPin]    = useState('')
  const [planta, setPlanta] = useState<PlantaId>('torcuato')
  const [puesto, setPuesto] = useState<'operario' | 'maquinista'>('operario')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!nombre.trim() || !legajo) {
      setError('Completá nombre y legajo')
      return
    }
    if (pin.length !== 4) {
      setError('Asignale un PIN de 4 dígitos')
      return
    }
    setSaving(true)
    try {
      await createOperarioProduccionUser({
        nombreContacto: nombre.trim(), legajo, pin, planta,
        ...(puesto === 'maquinista' ? { subrol: 'maquinista' as const } : {}),
      })
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el operario. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nuevo operario">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required placeholder="Nombre y apellido" />
        <Input
          label="Legajo" value={legajo}
          onChange={(e) => setLegajo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required inputMode="numeric" maxLength={6} placeholder="1234"
        />
        <Input
          label="PIN (4 dígitos)" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          required inputMode="numeric" maxLength={4} placeholder="••••"
        />
        <p className="text-xs text-gray-400 -mt-2">El operario ingresa a /produccion-{planta} con su legajo y este PIN. Anotá el PIN y comunicáselo; se puede cambiar después.</p>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Puesto</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'operario',   label: 'Operario',   desc: 'Carga pallets' },
              { id: 'maquinista', label: 'Maquinista', desc: 'Parte de máquinas' },
            ] as const).map((p) => (
              <button
                key={p.id} type="button" onClick={() => setPuesto(p.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  puesto === p.id ? 'border-accent bg-accent/10' : 'border-[#D3D1C7] bg-white'
                }`}
              >
                <p className={`text-sm font-semibold ${puesto === p.id ? 'text-accent' : 'text-gray-800'}`}>{p.label}</p>
                <p className="text-xs text-gray-400">{p.desc}</p>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Planta</label>
          <select
            value={planta}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setPlanta(e.target.value as PlantaId)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {Object.entries(PLANTAS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">El operario solo va a poder cargar pallets de esta planta.</p>
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" loading={saving} className="flex-1">Crear</Button>
        </div>
      </form>
    </Modal>
  )
}

function ResetPinModal({ operario, onClose }: { operario: UserProfile; onClose: () => void }) {
  const [resetting, setResetting] = useState(false)
  const [pin,       setPin]       = useState<string | null>(null)
  const [error,     setError]     = useState('')

  const handleReset = async () => {
    setResetting(true)
    setError('')
    try {
      setPin(await resetPinProduccion(operario.uid))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo resetear el PIN. Intentá de nuevo.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={pin ? 'PIN nuevo' : 'Resetear PIN'}>
      {pin ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Nuevo PIN de <span className="font-semibold text-gray-900">{operario.nombre}</span> (legajo {operario.legajo}):
          </p>
          <div className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-xl py-4 text-center">
            <span className="text-4xl font-bold tracking-[0.3em] text-accent tabular-nums">{pin}</span>
          </div>
          <p className="text-xs text-amber-600">
            ⚠ Comunicáselo ahora: no queda guardado en ningún lado consultable. Si se pierde, hay que resetearlo de nuevo. El PIN anterior ya no funciona.
          </p>
          <Button onClick={onClose} className="w-full">Listo</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Vas a generar un PIN nuevo para <span className="font-semibold text-gray-900">{operario.nombre}</span> (legajo {operario.legajo}).
            El PIN actual deja de funcionar al instante; el operario entra con el nuevo.
          </p>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="button" loading={resetting} onClick={handleReset} className="flex-1">Resetear PIN</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function OperariosProduccionPage() {
  const { operarios, loading, refetch } = useOperariosProduccion()
  const [crearModal,  setCrearModal]  = useState(false)
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null)

  if (loading) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Operarios de producción</h1>
            <p className="text-gray-500 text-sm">Personal de planta — login por legajo y PIN en /produccion-torcuato o /produccion-merlo</p>
          </div>
          <Button onClick={() => setCrearModal(true)} className="text-sm">+ Nuevo operario</Button>
        </div>

        {operarios.length === 0 ? (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
            <p className="text-gray-500 text-sm">Todavía no cargaste ningún operario</p>
            <p className="text-gray-400 text-xs mt-1">Usá el botón "Nuevo operario" para empezar</p>
          </div>
        ) : (
          <div className="space-y-2">
            {operarios.map((o) => (
              <div
                key={o.uid}
                className={`bg-white border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 ${
                  o.estado === 'activo' ? 'border-[#D3D1C7]' : 'border-[#D3D1C7]/40 opacity-60'
                }`}
              >
                <div>
                  <p className="font-bold text-sm text-gray-900">{o.nombre}</p>
                  <p className="text-gray-500 text-xs">
                    {o.subrol === 'maquinista' ? 'Maquinista' : 'Operario'} · Legajo {o.legajo}{o.planta ? ` · ${PLANTAS[o.planta].label}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-1 rounded-full border font-medium ${
                    o.estado === 'activo'
                      ? 'bg-green-100 text-green-700 border-green-200'
                      : 'bg-gray-100 text-gray-500 border-gray-200'
                  }`}>
                    {o.estado === 'activo' ? 'Activo' : 'Inactivo'}
                  </span>
                  <button
                    onClick={() => setResetTarget(o)}
                    className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-4 py-2 transition-colors min-h-[36px]"
                  >
                    Resetear PIN
                  </button>
                  <button
                    onClick={async () => {
                      await updateUserStatus(o.uid, o.estado === 'activo' ? 'inactivo' : 'activo')
                      refetch()
                    }}
                    className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-4 py-2 transition-colors min-h-[36px]"
                  >
                    {o.estado === 'activo' ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {crearModal && (
        <CrearOperarioModal onClose={() => setCrearModal(false)} onCreated={refetch} />
      )}

      {resetTarget && (
        <ResetPinModal operario={resetTarget} onClose={() => setResetTarget(null)} />
      )}
    </div>
  )
}
