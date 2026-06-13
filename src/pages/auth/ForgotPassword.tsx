import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { resetPassword } from '../../services/authService'

export default function ForgotPassword() {
  const [email, setEmail]     = useState('')
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await resetPassword(email)
      setSent(true)
    } catch {
      setError('No encontramos una cuenta con ese email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Recuperar contraseña"
      subtitle="Te enviamos instrucciones por email"
    >
      {sent ? (
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-success/10 border border-success/30 rounded-full flex items-center justify-center mx-auto">
            <span className="text-3xl">✉️</span>
          </div>
          <p className="text-success font-medium">Email enviado correctamente</p>
          <p className="text-gray-500 text-sm">
            Revisá tu bandeja de entrada y seguí las instrucciones para restablecer tu contraseña.
          </p>
          <Link
            to="/login"
            className="block text-accent hover:underline text-sm mt-4"
          >
            Volver al inicio de sesión
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="tu@email.com"
          />

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <Button type="submit" loading={loading} className="w-full">
            Enviar instrucciones
          </Button>

          <Link
            to="/login"
            className="text-center text-sm text-gray-500 hover:text-accent transition-colors"
          >
            ← Volver al login
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}
