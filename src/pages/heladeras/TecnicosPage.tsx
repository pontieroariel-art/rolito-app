import { useState, FormEvent, ChangeEvent } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useTecnicos } from '../../hooks/useTecnicos'
import { createTecnicoUser, updateUserStatus } from '../../services/userService'
import { AREA_HELADERA_LABELS, SECTORES_REPARACION } from '../../utils/heladeraLabels'
import { AreaHeladera } from '../../types'

function CrearTecnicoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [nombre,   setNombre]   = useState('')
  const [dni,      setDni]      = useState('')
  const [pin,      setPin]      = useState('')
  const [telefono, setTelefono] = useState('')
  const [area,     setArea]     = useState<AreaHeladera>(SECTORES_REPARACION[0])
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!nombre.trim() || dni.length !== 8 || pin.length !== 4) {
      setError('Completá nombre, DNI (8 dígitos) y PIN (4 dígitos)')
      return
    }
    setSaving(true)
    try {
      await createTecnicoUser({ nombreContacto: nombre.trim(), dni, pin, telefono: telefono.trim(), area })
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el técnico. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nuevo técnico">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required placeholder="Nombre y apellido" />
        <Input
          label="DNI" value={dni}
          onChange={(e) => setDni(e.target.value.replace(/\D/g, '').slice(0, 8))}
          required inputMode="numeric" maxLength={8} placeholder="36024287"
        />
        <Input
          label="PIN (4 dígitos)" type="password" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          required inputMode="numeric" maxLength={4} placeholder="••••"
        />
        <Input label="Teléfono (opcional)" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="11-xxxx-xxxx" />
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Sector</label>
          <select
            value={area}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setArea(e.target.value as AreaHeladera)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {SECTORES_REPARACION.map((a) => <option key={a} value={a}>{AREA_HELADERA_LABELS[a]}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">Define qué tipos de reparación va a poder elegir al registrar su trabajo.</p>
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

export default function TecnicosPage() {
  const { tecnicos, loading, refetch } = useTecnicos()
  const [crearModal, setCrearModal] = useState(false)

  if (loading) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Técnicos</h1>
            <p className="text-gray-500 text-sm">Personal de campo — login por DNI y PIN</p>
          </div>
          <Button onClick={() => setCrearModal(true)} className="text-sm">+ Nuevo técnico</Button>
        </div>

        {tecnicos.length === 0 ? (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
            <p className="text-4xl mb-3">🔧</p>
            <p className="text-gray-500 text-sm">Todavía no cargaste ningún técnico</p>
            <p className="text-gray-400 text-xs mt-1">Usá el botón "Nuevo técnico" para empezar</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tecnicos.map((t) => (
              <div
                key={t.uid}
                className={`bg-white border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 ${
                  t.estado === 'activo' ? 'border-[#D3D1C7]' : 'border-[#D3D1C7]/40 opacity-60'
                }`}
              >
                <div>
                  <p className="font-bold text-sm text-gray-900">{t.nombre}</p>
                  <p className="text-gray-500 text-xs">
                    DNI {t.dni}{t.telefono ? ` · ${t.telefono}` : ''}
                    {t.area ? ` · ${AREA_HELADERA_LABELS[t.area]}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-1 rounded-full border font-medium ${
                    t.estado === 'activo'
                      ? 'bg-green-100 text-green-700 border-green-200'
                      : 'bg-gray-100 text-gray-500 border-gray-200'
                  }`}>
                    {t.estado === 'activo' ? 'Activo' : 'Inactivo'}
                  </span>
                  <button
                    onClick={async () => {
                      await updateUserStatus(t.uid, t.estado === 'activo' ? 'inactivo' : 'activo')
                      refetch()
                    }}
                    className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-4 py-2 transition-colors min-h-[36px]"
                  >
                    {t.estado === 'activo' ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {crearModal && (
        <CrearTecnicoModal onClose={() => setCrearModal(false)} onCreated={refetch} />
      )}
    </div>
  )
}
