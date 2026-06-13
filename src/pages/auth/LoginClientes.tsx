import { useState, FormEvent, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { Eye, EyeOff } from 'lucide-react'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { loginWithCuit } from '../../services/authService'
import { resetPasswordByCuit } from '../../services/authService'

export default function LoginClientes() {
  const navigate = useNavigate()
  const { user }  = useAuth()

  useEffect(() => {
    if (!user) return
    if (user.estado === 'pendiente') { navigate('/pendiente',  { replace: true }); return }
    if (user.estado === 'inactivo')  { navigate('/clientes',   { replace: true }); return }
    navigate('/dashboard', { replace: true })
  }, [user])

  const [cuit,     setCuit]     = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  // Recuperar contraseña
  const [showReset,   setShowReset]   = useState(false)
  const [resetCuit,   setResetCuit]   = useState('')
  const [resetSent,   setResetSent]   = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError,  setResetError]  = useState('')

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await loginWithCuit(cuit, password)
      // useEffect redirige cuando el perfil de Firestore cargue
    } catch (err) {
      if (err instanceof Error && err.message === 'cuit-not-found') {
        setError('No encontramos una cuenta con ese CUIT')
      } else if (err instanceof FirebaseError) {
        const wrongCreds = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found']
        if (wrongCreds.includes(err.code)) {
          setError('CUIT o contraseña incorrectos')
        } else if (err.code === 'auth/too-many-requests') {
          setError('Demasiados intentos. Esperá unos minutos o restablecé tu contraseña.')
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

  const handleReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setResetLoading(true)
    setResetError('')
    try {
      await resetPasswordByCuit(resetCuit)
      setResetSent(true)
    } catch (err) {
      if (err instanceof Error && err.message === 'cuit-not-found') {
        setResetError('No encontramos una cuenta con ese CUIT')
      } else {
        setResetError('Error al enviar el email. Intentá de nuevo.')
      }
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <AuthLayout title="Ingreso Clientes" subtitle="Ingresá con tu CUIT">

      {showReset ? (
        /* ── Recuperar contraseña ─────────────────────────── */
        resetSent ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-success/10 border border-success/30 rounded-full flex items-center justify-center mx-auto">
              <span className="text-3xl">✉️</span>
            </div>
            <p className="text-success font-medium">Email enviado</p>
            <p className="text-gray-500 text-sm">
              Revisá tu bandeja de entrada para restablecer tu contraseña.
            </p>
            <button
              onClick={() => { setShowReset(false); setResetSent(false); setResetCuit('') }}
              className="text-accent hover:underline text-sm"
            >
              ← Volver al ingreso
            </button>
          </div>
        ) : (
          <form onSubmit={handleReset} className="flex flex-col gap-4">
            <p className="text-gray-500 text-sm text-center">
              Ingresá tu CUIT y te enviamos el link al email registrado
            </p>
            <Input
              label="CUIT"
              value={resetCuit}
              onChange={(e) => setResetCuit(e.target.value)}
              required
              placeholder="20123456789"
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
              className="text-center text-sm text-gray-500 hover:text-accent transition-colors"
            >
              ← Volver al ingreso
            </button>
          </form>
        )
      ) : (
        /* ── Formulario de ingreso ────────────────────────── */
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <Input
            label="CUIT"
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            required
            placeholder="20123456789"
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

          <button
            type="button"
            onClick={() => setShowReset(true)}
            className="text-center text-sm text-gray-500 hover:text-accent transition-colors"
          >
            ¿Olvidaste tu contraseña?
          </button>

          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-gray-500">o</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <Link
            to="/register"
            className="block text-center text-sm border border-[#D3D1C7] hover:border-accent rounded-xl py-2.5 text-gray-500 hover:text-gray-700 transition-colors"
          >
            Crear cuenta nueva
          </Link>

          <p className="text-center text-xs text-gray-400 mt-1">
            ¿Sos del equipo Rolito?{' '}
            <Link to="/empresa" className="text-gray-500 hover:text-accent transition-colors">
              Ingresá acá
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
