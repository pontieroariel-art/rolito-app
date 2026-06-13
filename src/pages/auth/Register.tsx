import { useState, ChangeEvent, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { Eye, EyeOff } from 'lucide-react'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { registerUser } from '../../services/authService'

interface RegisterForm {
  razonSocial:    string
  nombreContacto: string
  cuit:           string
  email:          string
  phone:          string
  password:       string
  confirm:        string
}

// Algoritmo oficial de validación de CUIT/CUIL argentino
function validateCuit(digits: string): boolean {
  if (digits.length !== 11) return false
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const sum = multipliers.reduce((acc, m, i) => acc + m * parseInt(digits[i]), 0)
  const remainder = sum % 11
  const verifier  = remainder === 0 ? 0 : remainder === 1 ? -1 : 11 - remainder
  return verifier === parseInt(digits[10])
}

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState<RegisterForm>({
    razonSocial: '', nombreContacto: '', cuit: '', email: '', phone: '', password: '', confirm: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm,  setShowConfirm]  = useState(false)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (form.password !== form.confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (form.password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    const cuitDigits = form.cuit.replace(/\D/g, '')
    if (cuitDigits.length !== 11) {
      setError('El CUIT debe tener 11 dígitos')
      return
    }
    if (!validateCuit(cuitDigits)) {
      setError('El CUIT ingresado no es válido (verificá el dígito verificador)')
      return
    }
    setLoading(true)
    setError('')
    try {
      await registerUser({
        email:          form.email,
        password:       form.password,
        razonSocial:    form.razonSocial,
        nombreContacto: form.nombreContacto,
        cuit:           form.cuit,
        phone:          form.phone,
      })
      navigate('/')
    } catch (err) {
      if (err instanceof FirebaseError && err.code === 'auth/email-already-in-use') {
        setError('El email ya está registrado')
      } else {
        setError('Error al registrarse. Intentá de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Crear cuenta">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Razón social"
          name="razonSocial"
          value={form.razonSocial}
          onChange={handleChange}
          required
          placeholder="Mi Empresa S.A."
        />
        <Input
          label="Nombre de contacto"
          name="nombreContacto"
          value={form.nombreContacto}
          onChange={handleChange}
          required
          placeholder="Juan García"
        />
        <Input
          label="CUIT"
          name="cuit"
          value={form.cuit}
          onChange={handleChange}
          required
          placeholder="20123456789"
        />
        <Input
          label="Email (para notificaciones y recuperación de contraseña)"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          required
          placeholder="tu@email.com"
        />
        <Input
          label="Teléfono (opcional)"
          name="phone"
          type="tel"
          value={form.phone}
          onChange={handleChange}
          placeholder="+54 11 1234-5678"
        />
        <Input
          label="Contraseña"
          name="password"
          type={showPassword ? 'text' : 'password'}
          value={form.password}
          onChange={handleChange}
          required
          placeholder="Mínimo 6 caracteres"
          rightElement={
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          }
        />
        <Input
          label="Confirmar contraseña"
          name="confirm"
          type={showConfirm ? 'text' : 'password'}
          value={form.confirm}
          onChange={handleChange}
          required
          placeholder="Repetí la contraseña"
          rightElement={
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowConfirm((v) => !v)}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          }
        />

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full mt-2">
          Crear cuenta
        </Button>

        <p className="text-center text-sm text-gray-500 mt-2">
          ¿Ya tenés cuenta?{' '}
          <Link to="/clientes" className="text-accent hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
