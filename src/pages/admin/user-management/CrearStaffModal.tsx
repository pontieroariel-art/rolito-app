import { useState, ChangeEvent, FormEvent } from 'react'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Modal from '../../../components/ui/Modal'
import { createStaffUser, createChoferUser } from '../../../services/userService'
import { UserRole } from '../../../types'
import { ROLE_LABELS, STAFF_ROLES } from './shared'

export function CrearStaffModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [nombre,   setNombre]   = useState('')
  const [dni,      setDni]      = useState('')
  const [password, setPassword] = useState('')
  const [rol,      setRol]      = useState<UserRole>('comercial')
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const isChofer = rol === 'chofer'

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isChofer && !/^\d{4}$/.test(password)) { setError('El PIN debe ser exactamente 4 dígitos numéricos'); return }
    if (!isChofer && password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return }
    if (isChofer && !/^\d{11}$/.test(dni.replace(/\D/g, ''))) { setError('El CUIT debe tener 11 dígitos'); return }
    if (!isChofer && !/^\d{8}$/.test(dni.replace(/\D/g, ''))) { setError('El DNI debe tener 8 dígitos'); return }
    setLoading(true)
    setError('')
    try {
      if (isChofer) {
        await createChoferUser({ nombreContacto: nombre, cuit: dni.trim(), pin: password })
      } else {
        await createStaffUser({ dni: dni.trim(), password, nombreContacto: nombre, rol })
      }
      onCreated()
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setError('Ya existe una cuenta con ese DNI/CUIT')
      } else {
        setError('Error al crear el usuario. Intentá de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Crear usuario Rolito">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nombre completo"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          placeholder="Juan García"
        />
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Rol</label>
          <select
            value={rol}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setRol(e.target.value as UserRole)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>

        <Input
          label={isChofer ? 'CUIT' : 'DNI'}
          value={dni}
          onChange={(e) => setDni(e.target.value.replace(/\D/g, '').slice(0, isChofer ? 11 : 8))}
          required
          placeholder={isChofer ? '20360242871' : '36024287'}
          autoComplete="off"
          inputMode="numeric"
          maxLength={isChofer ? 11 : 8}
        />
        <p className="text-xs text-gray-500 -mt-2">
          {isChofer ? 'El chofer ingresa con su DNI (8 dígitos del medio del CUIT) y PIN.' : 'El usuario ingresa con su DNI y contraseña.'}
        </p>

        <Input
          label={isChofer ? 'PIN' : 'Contraseña temporal'}
          type={showPass ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder={isChofer ? '4 dígitos' : 'Mínimo 6 caracteres'}
          inputMode={isChofer ? 'numeric' : undefined}
          maxLength={isChofer ? 4 : undefined}
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
        <p className="text-xs text-gray-500 -mt-2">
          {isChofer
            ? 'PIN de 4 dígitos. El chofer ingresa desde "Ingreso Choferes" en la app.'
            : 'El usuario podrá cambiar su contraseña desde "¿Olvidaste tu contraseña?" en Ingreso Empresa.'}
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" loading={loading} className="flex-1">Crear cuenta</Button>
        </div>
      </form>
    </Modal>
  )
}
