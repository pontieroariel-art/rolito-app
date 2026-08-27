import { useState, FormEvent, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import AuthLayout from '../../components/layout/AuthLayout'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { loginProduccion, logoutUser } from '../../services/authService'
import { marcarDispositivoProduccion } from '../../services/produccionAuthService'
import { PLANTAS, PlantaId } from '../../types'

interface Props { planta: PlantaId }

export default function LoginProduccion({ planta }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [legajo,  setLegajo]  = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  // El logout por planta incorrecta también dispara este efecto (user pasa a
  // null) — sin esta guarda, entraría de nuevo al `if (!user) return` sin
  // problema, pero se marca igual para que un usuario que YA estaba logueado
  // con la cuenta correcta al entrar a esta página no dispare el chequeo dos
  // veces innecesariamente.
  const rechazando = useRef(false)

  useEffect(() => {
    if (!user) return
    if (user.estado === 'inactivo') { setError('Tu cuenta está inactiva. Contactá al administrador.'); return }
    // Legajo válido pero de OTRA planta — no lo dejamos operar acá adentro:
    // un pallet cargado con esta cuenta se le atribuiría a su planta real
    // (la del legajo), no a la física donde está parado el dispositivo.
    if (user.planta && user.planta !== planta) {
      if (rechazando.current) return
      rechazando.current = true
      setError(`Ese legajo pertenece a ${PLANTAS[user.planta].label}, no a ${PLANTAS[planta].label}. Avisá al encargado.`)
      logoutUser().finally(() => { rechazando.current = false })
      return
    }
    // Solo marcar el dispositivo como tablet de planta para operarios reales.
    // Si un super_admin/cliente con sesión activa cae en esta URL, no tiene
    // `planta` y el chequeo de arriba no aplica — sin esta guarda, su
    // dispositivo quedaría atrapado en /produccion sin forma de salir por UI.
    if (user.rol !== 'produccion_hielo') return
    marcarDispositivoProduccion(planta)
    navigate('/produccion', { replace: true })
  }, [user, navigate, planta])

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
    <AuthLayout title={`Ingreso Producción — ${PLANTAS[planta].label}`} subtitle="Ingresá con tu número de legajo">
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
      </form>
    </AuthLayout>
  )
}
