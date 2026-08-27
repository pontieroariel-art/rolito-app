import { useState, FormEvent, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { loginProduccion } from '../../services/authService'

export default function LoginProduccion() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [legajo,  setLegajo]  = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    if (user.estado === 'inactivo') { setError('Tu cuenta está inactiva. Contactá al administrador.'); return }
    navigate('/produccion', { replace: true })
  }, [user, navigate])

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await loginProduccion(legajo.trim())
    } catch (err) {
      if (err instanceof Error && err.message === 'legajo-not-found') {
        setError('Legajo no encontrado')
      } else if (err instanceof FirebaseError) {
        const wrongCreds = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found']
        if (wrongCreds.includes(err.code)) {
          setError('Legajo no encontrado')
        } else if (err.code === 'auth/too-many-requests') {
          setError('Demasiados intentos. Esperá unos minutos.')
        } else {
          setError(`Error al ingresar (${err.code})`)
        }
      } else {
        setError('Error al ingresar. Verificá el legajo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Ingreso Producción" subtitle="Ingresá con tu número de legajo">
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <Input
          label="Legajo"
          value={legajo}
          onChange={(e) => setLegajo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
          placeholder="1234"
          autoComplete="username"
          inputMode="numeric"
          maxLength={6}
        />

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full mt-1">
          Ingresar
        </Button>

        <p className="text-center text-xs text-gray-400 mt-1">
          ¿No tenés legajo cargado? Contactá al encargado de producción.
        </p>

        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-gray-500">o</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <p className="text-center text-xs text-gray-400">
          ¿Sos del equipo Rolito?{' '}
          <Link to="/empresa" className="text-gray-500 hover:text-accent transition-colors">
            Ingresá acá
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
