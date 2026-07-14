import { useState, FormEvent } from 'react'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Modal from '../../../components/ui/Modal'
import { createClientUser } from '../../../services/userService'
import { UserRole, UserStatus } from '../../../types'

export function CrearClienteModal({ onClose, onCreated, currentUserRol }: { onClose: () => void; onCreated: () => void; currentUserRol?: UserRole }) {
  const estadoInicial: UserStatus = ['super_admin', 'gerente_comercial'].includes(currentUserRol ?? '')
    ? 'activo'
    : 'pendiente'
  const [razonSocial,    setRazonSocial]    = useState('')
  const [nombreContacto, setNombreContacto] = useState('')
  const [cuit,           setCuit]           = useState('')
  const [email,          setEmail]          = useState('')
  const [telefono,       setTelefono]       = useState('')
  const [password,       setPassword]       = useState('')
  const [showPass,       setShowPass]       = useState(false)
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState('')

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const cuitDigits = cuit.replace(/\D/g, '')
    if (cuitDigits.length !== 11) { setError('El CUIT debe tener 11 dígitos'); return }
    if (password.length < 6)      { setError('La contraseña debe tener al menos 6 caracteres'); return }
    setLoading(true)
    setError('')
    const emailFinal = email.trim() || `${cuitDigits}@rolito.app`
    try {
      await createClientUser({ email: emailFinal, password, razonSocial, nombreContacto: nombreContacto || undefined, cuit, telefono, estadoInicial })
      onCreated()
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setError('Ya existe una cuenta con ese email')
      } else {
        setError(err?.message ?? 'Error al crear el cliente. Intentá de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Crear cliente">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Razón social"
          value={razonSocial}
          onChange={(e) => setRazonSocial(e.target.value)}
          required
          placeholder="Mi Empresa S.A."
        />
        <Input
          label="Nombre de contacto (opcional)"
          value={nombreContacto}
          onChange={(e) => setNombreContacto(e.target.value)}
          placeholder="Juan García"
        />
        <Input
          label="CUIT"
          value={cuit}
          onChange={(e) => setCuit(e.target.value)}
          required
          placeholder="20123456789"
        />
        <Input
          label="Email (opcional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="cliente@empresa.com"
        />
        <Input
          label="Teléfono (opcional)"
          type="tel"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="+54 11 1234-5678"
        />
        <Input
          label="Contraseña temporal"
          type={showPass ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="Mínimo 6 caracteres"
          rightElement={
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPass((v) => !v)}
              className="text-lg leading-none text-gray-500 hover:text-gray-700"
            >
              {showPass ? '🙈' : '👁️'}
            </button>
          }
        />
        {estadoInicial === 'pendiente' ? (
          <p className="text-xs text-yellow-400">
            La cuenta se creará como borrador. El gerente comercial deberá revisar las condiciones y activarla.
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            La cuenta quedará activa de inmediato. El cliente puede ingresar con su CUIT y contraseña.
          </p>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" loading={loading} className="flex-1">Crear cliente</Button>
        </div>
      </form>
    </Modal>
  )
}
