import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { registerUser } from '../../services/authService'

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', confirm: '',
  })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (form.password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    setLoading(true)
    setError('')
    try {
      await registerUser({
        email:    form.email,
        password: form.password,
        name:     form.name,
        phone:    form.phone,
      })
      navigate('/')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
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
          label="Nombre completo"
          name="name"
          value={form.name}
          onChange={handleChange}
          required
          placeholder="Juan García"
        />
        <Input
          label="Email"
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
          type="password"
          value={form.password}
          onChange={handleChange}
          required
          placeholder="Mínimo 6 caracteres"
        />
        <Input
          label="Confirmar contraseña"
          name="confirm"
          type="password"
          value={form.confirm}
          onChange={handleChange}
          required
          placeholder="Repetí la contraseña"
        />

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full mt-2">
          Crear cuenta
        </Button>

        <p className="text-center text-sm text-muted mt-2">
          ¿Ya tenés cuenta?{' '}
          <Link to="/login" className="text-accent hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
