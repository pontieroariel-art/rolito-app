import { useState, FormEvent } from 'react'
import { reauthenticateWithCredential, EmailAuthProvider, updatePassword } from 'firebase/auth'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { AddressMapMini } from '../../components/ui/AddressPickerField'
import { useProfile } from '../../hooks/useProfile'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { useListaPrecios } from '../../hooks/useListasPrecios'
import { auth } from '../../services/firebase'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-3 py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className="text-sm text-white text-right">{value || '—'}</span>
    </div>
  )
}

export default function ClientProfile() {
  const { user }    = useProfile()
  const { isLoaded } = useGoogleMapsLoader()
  const { lista, isLoading: loadingLista } = useListaPrecios(user?.listaPreciosId)

  // ── Cambio de contraseña ──────────────────────────────────────────────────
  const [currentPass, setCurrentPass] = useState('')
  const [newPass,     setNewPass]     = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [passLoading, setPassLoading] = useState(false)
  const [passError,   setPassError]   = useState('')
  const [passSaved,   setPassSaved]   = useState(false)

  const handlePasswordChange = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPassError('')
    setPassSaved(false)
    if (newPass.length < 6) { setPassError('La nueva contraseña debe tener al menos 6 caracteres'); return }
    if (newPass !== confirmPass) { setPassError('Las contraseñas no coinciden'); return }
    const firebaseUser = auth.currentUser
    if (!firebaseUser?.email) { setPassError('No se pudo verificar tu sesión. Volvé a iniciar sesión.'); return }
    setPassLoading(true)
    try {
      await reauthenticateWithCredential(
        firebaseUser,
        EmailAuthProvider.credential(firebaseUser.email, currentPass),
      )
      await updatePassword(firebaseUser, newPass)
      setPassSaved(true)
      setCurrentPass('')
      setNewPass('')
      setConfirmPass('')
      setTimeout(() => setPassSaved(false), 4000)
    } catch (err: any) {
      const code = err?.code ?? ''
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPassError('La contraseña actual es incorrecta.')
      } else if (code === 'auth/too-many-requests') {
        setPassError('Demasiados intentos fallidos. Esperá unos minutos.')
      } else {
        setPassError('No se pudo cambiar la contraseña. Intentá de nuevo.')
      }
    } finally {
      setPassLoading(false)
    }
  }

  if (!user) return <LoadingSpinner fullScreen />

  const formatCuit = (cuit: string) => {
    const d = cuit.replace(/\D/g, '')
    if (d.length === 11) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
    return cuit
  }

  return (
    <>
      <Navbar />
      <main className="max-w-xl mx-auto p-4 space-y-8 pb-10">

        <div>
          <h1 className="text-2xl font-bold">Mi perfil</h1>
          <p className="text-muted text-sm mt-1">{user.email}</p>
        </div>

        {/* ── Datos del cliente (solo lectura) ────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Datos del cliente</h2>
          <div className="bg-surface border border-border rounded-2xl p-5 space-y-0">
            <Row label="Razón social"      value={user.razonSocial || '—'} />
            <Row label="Nombre de contacto" value={user.nombreContacto || user.nombre || '—'} />
            <Row label="Teléfono"          value={user.telefono || user.phone || '—'} />
            <Row label="Email"             value={user.email} />
            {user.cuit && <Row label="CUIT" value={formatCuit(user.cuit)} />}
          </div>
          <p className="text-xs text-muted/60 px-1">
            Para actualizar tus datos, contactá con el equipo de Rolito.
          </p>
        </section>

        {/* ── Sucursales (solo lectura) ────────────────────────────────────── */}
        {(user.addresses?.length ?? 0) > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              Sucursales ({user.addresses!.length})
            </h2>
            <div className="space-y-3">
              {user.addresses!.map((addr) => (
                <div key={addr.id} className="bg-surface border border-border rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{addr.nombre}</p>
                    {addr.esPrincipal && (
                      <span className="text-xs bg-accent/10 text-accent border border-accent/20 rounded-full px-2 py-0.5">
                        Principal
                      </span>
                    )}
                  </div>
                  <p className="text-muted text-xs">{addr.address}</p>
                  {isLoaded && addr.lat && addr.lng && (
                    <AddressMapMini lat={addr.lat} lng={addr.lng} />
                  )}
                  {addr.horarioApertura && addr.horarioCierre && (
                    <p className="text-muted text-xs">
                      Horario: {addr.horarioApertura} – {addr.horarioCierre}
                    </p>
                  )}
                  {addr.contactoNombre && (
                    <p className="text-muted text-xs">
                      Contacto: {addr.contactoNombre}
                      {addr.contactoTelefono && ` · ${addr.contactoTelefono}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Cambiar contraseña ───────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Cambiar contraseña</h2>
          <form
            onSubmit={handlePasswordChange}
            className="bg-surface border border-border rounded-2xl p-5 space-y-4"
          >
            <Input
              label="Contraseña actual"
              type="password"
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              required
              placeholder="••••••••"
              autoComplete="current-password"
            />
            <Input
              label="Nueva contraseña"
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              required
              placeholder="Mínimo 6 caracteres"
              autoComplete="new-password"
            />
            <Input
              label="Confirmar nueva contraseña"
              type="password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              required
              placeholder="Repetí la nueva contraseña"
              autoComplete="new-password"
            />

            {passError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <p className="text-red-400 text-sm">{passError}</p>
              </div>
            )}
            {passSaved && (
              <div className="bg-success/10 border border-success/30 rounded-lg px-3 py-2">
                <p className="text-success text-sm">✓ Contraseña actualizada correctamente</p>
              </div>
            )}

            <Button type="submit" loading={passLoading} className="w-full">
              Cambiar contraseña
            </Button>
          </form>
        </section>

        {/* ── Info de cuenta ───────────────────────────────────────────────── */}
        <div className="bg-surface border border-border rounded-xl p-4 text-sm space-y-1.5">
          <Row label="Estado"         value={user.estado === 'activo' ? 'Activo' : user.estado} />
          {user.fechaCreacion && (
            <Row label="Cuenta creada" value={user.fechaCreacion.toDate().toLocaleDateString('es-AR')} />
          )}
          {user.fechaAprobacion && (
            <Row label="Aprobado"     value={user.fechaAprobacion.toDate().toLocaleDateString('es-AR')} />
          )}
        </div>

        {/* ── Lista de precios (solo lectura) ──────────────────────────────── */}
        {user.listaPreciosId && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Mi lista de precios</h2>
            {loadingLista ? (
              <LoadingSpinner />
            ) : lista ? (
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-medium">{lista.nombre}</p>
                  <p className="text-xs text-muted mt-0.5">Precios vigentes para tu cuenta</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="text-left text-xs text-muted font-medium px-4 py-2.5">Producto</th>
                      <th className="text-right text-xs text-muted font-medium px-4 py-2.5">Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.items.filter((i) => i.activo).map((item) => {
                      const custom = user.preciosCustom?.[item.productoId]
                      const precio = custom ?? item.precio
                      return (
                        <tr key={item.productoId} className="border-b border-border/30 last:border-0">
                          <td className="px-4 py-3">
                            <p className="font-medium">{item.nombre}</p>
                            {item.unidad && (
                              <p className="text-xs text-muted">por {item.unidad}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-bold text-accent">
                              ${precio.toLocaleString('es-AR')}
                            </span>
                            {custom !== undefined && (
                              <p className="text-xs text-yellow-400 mt-0.5">precio especial</p>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        )}

      </main>
    </>
  )
}
