import { useState, FormEvent, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { Eye, EyeOff } from 'lucide-react'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { loginWithStaffDni } from '../../services/authService'

const ROLE_HOME: Record<string, string> = {
  super_admin:       '/admin',
  gerente_comercial: '/usuarios',
  logistica:         '/logistica',
  comercial:         '/comercial',
  facturacion:       '/movimientos',
  chofer:            '/chofer',
  cliente:           '/dashboard',
}

export default function LoginEmpresa() {
  const navigate = useNavigate()
  const { user }  = useAuth()

  useEffect(() => {
    if (!user) return
    if (user.estado === 'pendiente') { navigate('/pendiente', { replace: true }); return }
    if (user.estado === 'inactivo')  { navigate('/',          { replace: true }); return }
    navigate(ROLE_HOME[user.rol] ?? '/', { replace: true })
  }, [user])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await loginWithStaffDni(username.trim(), password)
    } catch (err) {
      if (err instanceof Error && err.message === 'dni-not-found') {
        setError('DNI no encontrado')
      } else if (err instanceof FirebaseError) {
        const wrongCreds = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found']
        if (wrongCreds.includes(err.code)) {
          setError('Usuario o contraseña incorrectos')
        } else if (err.code === 'auth/too-many-requests') {
          setError('Demasiados intentos. Esperá unos minutos.')
        } else {
          setError(`Error al ingresar (${err.code})`)
        }
      } else {
        setError('Error al ingresar. Verificá tus datos.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Ingreso Empresa" subtitle="Acceso equipo Rolito">
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <Input
          label="DNI"
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/\D/g, '').slice(0, 8))}
          required
          placeholder="36024287"
          autoComplete="username"
          inputMode="numeric"
          maxLength={8}
        />
        <Input
          label="Contraseña"
          type={showPass ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="Tu contraseña"
          autoComplete="current-password"
          rightElement={
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPass((v) => !v)}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          }
        />

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full mt-1">
          Ingresar
        </Button>

        <p className="text-center text-xs text-gray-400">
          Si olvidaste tu contraseña, contactá al administrador del sistema.
        </p>

        <p className="text-center text-xs text-gray-400 mt-1">
          <Link to="/" className="text-gray-500 hover:text-accent transition-colors">
            ← Volver al inicio
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
