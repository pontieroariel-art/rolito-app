import { useState, FormEvent } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import PageHeader from '@/components/common/PageHeader'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { useAuth } from '@/context/AuthContext'
import { updateUserDocument } from '@/services/userService'
import { logoutUser } from '@/services/authService'
import { auth } from '@/services/firebase'
import { ROLE_LABELS } from '@/utils/roles'
import { PLANTAS } from '@/types'

/**
 * MI PERFIL del personal (2026-09-20, pedido de Ariel al dar de alta el muelle).
 *
 * El staff no tenía dónde ver sus datos ni cómo cambiar su contraseña: el
 * cliente tiene `/perfil` y el chofer cambia su PIN desde su home, pero caja,
 * muelle, seguridad, tesorería y el resto no tenían nada.
 *
 * Importa más de lo que parece porque el mail del staff es INVENTADO
 * (`36809554@staff.rolito.internal`): el "olvidé mi contraseña" por mail no
 * existe ni va a existir. Por eso esta pantalla va de la mano del botón
 * "Restablecer contraseña" del super_admin en Usuarios: sin ese par, el primer
 * olvido se resuelve tocando producción a mano.
 *
 * Los datos son de SOLO LECTURA salvo el teléfono: rol, roles adicionales,
 * planta y estado son privilegio (las reglas no dejan que nadie se los cambie
 * sobre su propio documento, y está bien que así sea).
 *
 * Lleva Navbar propio, como `/muelle`: la usan tanto los roles con dominio
 * (caja, tesorería) como los de planta (muelle, seguridad), y esos últimos no
 * pasan por DominioLayout.
 */

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between items-start gap-3 py-2 border-b border-[#E7E5DC] last:border-0">
      <span className="text-xs text-secundario shrink-0">{etiqueta}</span>
      <span className="text-sm text-gray-900 text-right">{valor || '—'}</span>
    </div>
  )
}

export default function PerfilStaffPage() {
  const { user, setUser } = useAuth()

  // ── Teléfono (lo único editable) ──────────────────────────────────────────
  const [telefono,    setTelefono]    = useState(user?.telefono ?? '')
  const [telGuardado, setTelGuardado] = useState(false)
  const [telError,    setTelError]    = useState('')
  const [telSaving,   setTelSaving]   = useState(false)

  // ── Cambio de contraseña ──────────────────────────────────────────────────
  const [actual,      setActual]      = useState('')
  const [nueva,       setNueva]       = useState('')
  const [repetida,    setRepetida]    = useState('')
  const [passSaving,  setPassSaving]  = useState(false)
  const [passError,   setPassError]   = useState('')
  const [passOk,      setPassOk]      = useState(false)

  if (!user) return <LoadingSpinner fullScreen />

  const guardarTelefono = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setTelError('')
    setTelGuardado(false)
    setTelSaving(true)
    try {
      await updateUserDocument(user.uid, { telefono })
      setUser({ ...user, telefono })
      setTelGuardado(true)
      setTimeout(() => setTelGuardado(false), 4000)
    } catch {
      setTelError('No se pudo guardar. Intentá de nuevo.')
    } finally {
      setTelSaving(false)
    }
  }

  const cambiarPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPassError('')
    setPassOk(false)
    if (nueva.length < 6)  { setPassError('La contraseña nueva tiene que tener al menos 6 caracteres'); return }
    if (nueva !== repetida) { setPassError('Las dos contraseñas nuevas no coinciden'); return }
    // Poner de contraseña el propio DNI es volver al punto de partida: el DNI
    // es también el usuario, así que quien lo sepa entra como esa persona.
    if (user.dni && nueva.replace(/\D/g, '') === user.dni.replace(/\D/g, '')) {
      setPassError('No uses tu DNI como contraseña: es lo mismo que tu usuario.')
      return
    }
    const cuenta = auth.currentUser
    if (!cuenta?.email) { setPassError('No pudimos verificar tu sesión. Volvé a entrar.'); return }
    setPassSaving(true)
    try {
      await reauthenticateWithCredential(cuenta, EmailAuthProvider.credential(cuenta.email, actual))
      await updatePassword(cuenta, nueva)
      setPassOk(true)
      setActual(''); setNueva(''); setRepetida('')
      setTimeout(() => setPassOk(false), 5000)
    } catch (err) {
      const code = (err as { code?: string })?.code ?? ''
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPassError('La contraseña actual no es esa.')
      } else if (code === 'auth/too-many-requests') {
        setPassError('Demasiados intentos. Esperá unos minutos.')
      } else if (code === 'auth/weak-password') {
        setPassError('Esa contraseña es muy débil. Probá con una más larga.')
      } else {
        setPassError('No se pudo cambiar la contraseña. Intentá de nuevo.')
      }
    } finally {
      setPassSaving(false)
    }
  }

  const extra = (user.rolesExtra ?? []).map((r) => ROLE_LABELS[r]).join(', ')
  const card  = 'bg-white border border-[#D3D1C7] rounded-xl p-4'

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <Navbar />
      <main className="max-w-xl mx-auto p-4 space-y-4 pb-24 md:pb-10">
        <PageHeader titulo="Mi perfil" contexto={ROLE_LABELS[user.rol]} />

        {/* ── Quién sos para el sistema ─────────────────────────────────── */}
        <section className={card}>
          <h2 className="text-xs uppercase text-secundario mb-2">Mis datos</h2>
          <Dato etiqueta="Nombre"    valor={user.nombre ?? ''} />
          <Dato etiqueta="DNI"       valor={user.dni ?? ''} />
          <Dato etiqueta="Puesto"    valor={ROLE_LABELS[user.rol]} />
          {extra && <Dato etiqueta="También hace" valor={extra} />}
          {user.planta && <Dato etiqueta="Planta" valor={PLANTAS[user.planta].label} />}
          <p className="text-xs text-secundario mt-3">
            Tu puesto y tu planta los cambia solo el administrador. Si algo de esto está mal, avisale.
          </p>
        </section>

        {/* ── Teléfono ──────────────────────────────────────────────────── */}
        <section className={card}>
          <h2 className="text-xs uppercase text-secundario mb-2">Mi teléfono</h2>
          <form onSubmit={guardarTelefono} className="space-y-3">
            <Input
              label="Celular"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              inputMode="tel"
              placeholder="1122334455"
            />
            {telError && <p className="text-sm text-red-600">{telError}</p>}
            {telGuardado && <p className="text-sm text-accent">Guardado.</p>}
            <Button type="submit" disabled={telSaving || telefono === (user.telefono ?? '')}>
              {telSaving ? 'Guardando…' : 'Guardar teléfono'}
            </Button>
          </form>
        </section>

        {/* ── Contraseña ────────────────────────────────────────────────── */}
        <section className={card}>
          <h2 className="text-xs uppercase text-secundario mb-2 flex items-center gap-1.5">
            <KeyRound size={14} /> Mi contraseña
          </h2>
          {/* El staff entra con el DNI como usuario: si la contraseña también
              es el DNI, cualquiera que lo sepa entra como esa persona. */}
          <p className="text-sm text-secundario mb-3">
            Entrás con tu DNI ({user.dni || '—'}) y esta contraseña. Elegí una que sepas solo vos.
          </p>
          <form onSubmit={cambiarPassword} className="space-y-3">
            <Input label="Contraseña actual"     type="password" value={actual}   onChange={(e) => setActual(e.target.value)}   required autoComplete="current-password" />
            <Input label="Contraseña nueva"      type="password" value={nueva}    onChange={(e) => setNueva(e.target.value)}    required autoComplete="new-password" placeholder="Mínimo 6 caracteres" />
            <Input label="Repetí la nueva"       type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} required autoComplete="new-password" />
            {passError && <p className="text-sm text-red-600">{passError}</p>}
            {passOk && (
              <p className="text-sm text-accent flex items-center gap-1.5">
                <ShieldCheck size={15} /> Listo, tu contraseña quedó cambiada.
              </p>
            )}
            <Button type="submit" disabled={passSaving}>
              {passSaving ? 'Cambiando…' : 'Cambiar contraseña'}
            </Button>
          </form>
          <p className="text-xs text-secundario mt-3">
            Si te la olvidás, el administrador te la vuelve a poner en tu DNI y la cambiás de nuevo acá.
          </p>
        </section>

        <button
          onClick={() => { void logoutUser() }}
          className="w-full min-h-11 flex items-center justify-center gap-2 text-sm font-medium text-secundario hover:text-red-600 transition-colors"
        >
          <LogOut size={16} /> Cerrar sesión
        </button>
      </main>
    </div>
  )
}
