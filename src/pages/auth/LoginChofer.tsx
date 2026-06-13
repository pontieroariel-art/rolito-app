import { useState, FormEvent, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { loginChofer } from '../../services/authService'

export default function LoginChofer() {
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return
    navigate('/chofer', { replace: true })
  }, [user])

  const [username, setUsername] = useState('')
  const [pin,      setPin]      = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await loginChofer(username.trim(), pin)
    } catch (err) {
      if (err instanceof Error && err.message === 'username-not-found') {
        setError('CUIT no encontrado')
      } else if (err instanceof FirebaseError) {
        const wrongCreds = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found']
        if (wrongCreds.includes(err.code)) {
          setError('CUIT o PIN incorrecto')
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
    <AuthLayout title="Ingreso Choferes" subtitle="Ingresá con tu CUIT y PIN">
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <Input
          label="CUIT"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          placeholder="20360242871"
          autoComplete="username"
          inputMode="numeric"
        />
        <Input
          label="PIN"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          required
          placeholder="••••"
          autoComplete="current-password"
          inputMode="numeric"
          maxLength={4}
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
          ¿Olvidaste tu PIN? Contactá al administrador.
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
