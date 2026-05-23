import { useState, FormEvent, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { Eye, EyeOff } from 'lucide-react'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { loginUser, resetPassword } from '../../services/authService'

const ROLE_HOME: Record<string, string> = {
  super_admin: '/admin',
  logistica:   '/admin',
  comercial:   '/comercial',
  chofer:      '/chofer',
  cliente:     '/dashboard',
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

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  // Recuperar contraseña
  const [showReset,    setShowReset]    = useState(false)
  const [resetEmail,   setResetEmail]   = useState('')
  const [resetSent,    setResetSent]    = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError,   setResetError]   = useState('')

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await loginUser(email, password)
      // useEffect redirige cuando el perfil de Firestore cargue
    } catch (err) {
      if (err instanceof FirebaseError && err.code === 'auth/invalid-credential') {
        setError('Email o contraseña incorrectos')
      } else {
        setError('Error al ingresar. Verificá tus datos.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setResetLoading(true)
    setResetError('')
    try {
      await resetPassword(resetEmail)
      setResetSent(true)
    } catch {
      setResetError('No encontramos una cuenta con ese email')
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <AuthLayout title="Ingreso Empresa" subtitle="Acceso equipo Rolito">

      {showReset ? (
        resetSent ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-success/10 border border-success/30 rounded-full flex items-center justify-center mx-auto">
              <span className="text-3xl">✉️</span>
            </div>
            <p className="text-success font-medium">Email enviado</p>
            <p className="text-muted text-sm">
              Revisá tu bandeja de entrada para restablecer tu contraseña.
            </p>
            <button
              onClick={() => { setShowReset(false); setResetSent(false); setResetEmail('') }}
              className="text-accent hover:underline text-sm"
            >
              ← Volver al ingreso
            </button>
          </div>
        ) : (
          <form onSubmit={handleReset} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              required
              placeholder="tu@rolito.com"
            />
            {resetError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <p className="text-red-400 text-sm">{resetError}</p>
              </div>
            )}
            <Button type="submit" loading={resetLoading} className="w-full">
              Enviar instrucciones
            </Button>
            <button
              type="button"
              onClick={() => setShowReset(false)}
              className="text-center text-sm text-muted hover:text-accent transition-colors"
            >
              ← Volver al ingreso
            </button>
          </form>
        )
      ) : (
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="tu@rolito.com"
            autoComplete="username"
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
                className="text-muted hover:text-white transition-colors"
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

          <button
            type="button"
            onClick={() => setShowReset(true)}
            className="text-center text-sm text-muted hover:text-accent transition-colors"
          >
            ¿Olvidaste tu contraseña?
          </button>

          <p className="text-center text-xs text-muted/60 mt-2">
            <Link to="/" className="text-muted hover:text-accent transition-colors">
              ← Volver al inicio
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
