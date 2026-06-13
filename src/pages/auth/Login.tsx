import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { loginUser } from '../../services/authService'

export default function Login() {
  const navigate     = useNavigate()
  const { user }     = useAuth()

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)

  // Navega cuando AuthContext confirma que el usuario está cargado.
  // Esto evita que navigate('/') se llame antes de que Firestore resuelva
  // el perfil, lo que causaba el remontado del formulario con campos vacíos.
  useEffect(() => {
    if (user) navigate('/')
  }, [user, navigate])

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    try {
      await loginUser(email, password)
      // No llamar navigate aquí — el useEffect de arriba lo hace
      // cuando AuthContext setea el user. El spinner queda activo
      // mientras Firestore carga el perfil.
    } catch {
      setError('Email o contraseña incorrectos')
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Iniciar sesión" subtitle="Realiza tu Pedido">
      <div className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="tu@email.com"
        />
        <Input
          label="Contraseña"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
          rightElement={
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="text-lg leading-none text-gray-500 hover:text-gray-700 transition-colors"
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          }
        />

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <Button
          type="button"
          onClick={handleLogin}
          loading={loading}
          className="w-full mt-2"
        >
          Entrar
        </Button>

        <div className="text-center text-sm text-gray-500 space-y-2 mt-2">
          <Link to="/forgot-password" className="hover:text-accent block transition-colors">
            ¿Olvidaste tu contraseña?
          </Link>
          <p>
            ¿No tenés cuenta?{' '}
            <Link to="/register" className="text-success hover:underline">
              Registrarse
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  )
}
