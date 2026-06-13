import { useState, useEffect, useRef, ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useDriverOrders } from '../../hooks/useOrders'
import { useAuth } from '../../context/AuthContext'
import { usePushNotification } from '../../hooks/usePushNotification'
import { savePushSubscription } from '../../services/userService'
import { createOrder } from '../../services/orderService'
import { markDelivered } from '../../services/orderService'
import { updateDriverLocation, deactivateDriverLocation } from '../../services/locationService'
import { subscribeMyDespacho } from '../../services/despachoService'
import { Despacho } from '../../types'
import { reauthenticateWithCredential, EmailAuthProvider, updatePassword } from 'firebase/auth'
import { auth } from '../../services/firebase'
import { padPin } from '../../services/choferAuthService'
import { updateVisitaPuntual } from '../../services/visitasService'
import { useProgramasVisita, useVisitasPuntuales, programasParaFecha, visitasParaFecha } from '../../hooks/useVisitas'
import { useCatalogo } from '../../hooks/useCatalogo'
import { summarizeProducts } from '../../utils/helpers'
import { generateHojaDeRuta } from '../../utils/pdf'
import { Order, ProgramaVisita, VisitaPuntual, OrderProduct } from '../../types'
import EntregaModal from '../../components/chofer/EntregaModal'

export default function ChoferDashboard() {
  const { orders, loading }   = useDriverOrders()
  const { user }              = useAuth()
  const { permission, request } = usePushNotification()
  const { programas }         = useProgramasVisita()
  const { visitas }           = useVisitasPuntuales()
  const { catalogo }          = useCatalogo()
  const [pdfLoading,  setPdfLoading]  = useState(false)
  const [registrando, setRegistrando] = useState<
    { tipo: 'programa'; data: ProgramaVisita } |
    { tipo: 'visita';   data: VisitaPuntual   } | null
  >(null)
  const [sinContactoVisita,  setSinContactoVisita]  = useState<VisitaPuntual | null>(null)
  const [sinContactoMotivo,  setSinContactoMotivo]  = useState('')
  const [sinContactoLoading, setSinContactoLoading] = useState(false)

  const MOTIVOS_SIN_CONTACTO = ['Nadie en el local', 'Local cerrado', 'No atendió el teléfono', 'Dirección incorrecta']

  const pending   = orders.filter((o) => o.status !== 'entregado')
  const delivered = orders.filter((o) => o.status === 'entregado')
  const hasPending = pending.length > 0

  const today           = new Date()
  const visitasHoy      = programasParaFecha(programas, today).filter((p) => !p.driverId || p.driverId === user?.email)
  const puntualHoy      = visitasParaFecha(visitas, today).filter((v) => !v.driverId || v.driverId === user?.email)
  const entregadosHoyIds = new Set(orders.filter((o) => o.status === 'entregado').map((o) => o.clientId))

  // Próximas visitas puntuales (días 1–6 desde hoy, asignadas a este chofer)
  const proximasVisitas = (() => {
    const days: { label: string; fecha: string; items: VisitaPuntual[] }[] = []
    for (let i = 1; i <= 6; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      const items = visitasParaFecha(visitas, d).filter((v) => !v.driverId || v.driverId === user?.email)
      if (items.length > 0) {
        days.push({
          label: i === 1 ? 'Mañana' : d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' }),
          fecha: d.toISOString().split('T')[0],
          items,
        })
      }
    }
    return days
  })()

  const [despachoHoy, setDespachoHoy] = useState<Despacho | null>(null)
  useEffect(() => {
    if (!user?.email) return
    const fecha = new Date().toISOString().split('T')[0]
    return subscribeMyDespacho(fecha, user.email, setDespachoHoy)
  }, [user?.email])

  // ── Cambiar PIN ──────────────────────────────────────────────────────────
  const [pinModal,     setPinModal]     = useState(false)
  const [pinActual,    setPinActual]    = useState('')
  const [pinNuevo,     setPinNuevo]     = useState('')
  const [pinConfirm,   setPinConfirm]   = useState('')
  const [pinLoading,   setPinLoading]   = useState(false)
  const [pinError,     setPinError]     = useState('')
  const [pinOk,        setPinOk]        = useState(false)

  const handleCambiarPin = async () => {
    if (pinNuevo.length !== 4) { setPinError('El PIN debe tener 4 dígitos'); return }
    if (pinNuevo !== pinConfirm) { setPinError('Los PINs no coinciden'); return }
    setPinLoading(true)
    setPinError('')
    try {
      const firebaseUser = auth.currentUser
      if (!firebaseUser?.email) throw new Error('Sin sesión')
      const credential = EmailAuthProvider.credential(firebaseUser.email, padPin(pinActual))
      await reauthenticateWithCredential(firebaseUser, credential)
      await updatePassword(firebaseUser, padPin(pinNuevo))
      setPinOk(true)
      setPinActual(''); setPinNuevo(''); setPinConfirm('')
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setPinError('PIN actual incorrecto')
      } else {
        setPinError('Error al cambiar el PIN. Intentá de nuevo.')
      }
    } finally {
      setPinLoading(false)
    }
  }

  const nombreRef   = useRef(user?.nombreContacto || user?.nombre || '')
  const telefonoRef = useRef(user?.telefono       || user?.phone  || '')
  useEffect(() => {
    nombreRef.current   = user?.nombreContacto || user?.nombre || ''
    telefonoRef.current = user?.telefono       || user?.phone  || ''
  })

  useEffect(() => {
    if (!hasPending || !user?.email || !navigator.geolocation) return

    const email = user.email
    const send  = () => {
      if (document.visibilityState === 'hidden') return
      navigator.geolocation.getCurrentPosition(
        (pos) => updateDriverLocation(
          email,
          pos.coords.latitude,
          pos.coords.longitude,
          nombreRef.current,
          telefonoRef.current,
        ),
        () => {},
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      )
    }

    send()
    const id = setInterval(send, 10_000)

    return () => {
      clearInterval(id)
      deactivateDriverLocation(email).catch(console.error)
    }
  }, [hasPending, user?.email])

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <Navbar />
      {permission === 'default' && (
        <div className="max-w-2xl mx-auto px-4 pt-3">
          <button
            onClick={() => request((sub) => { if (user?.uid) savePushSubscription(user.uid, sub) })}
            className="w-full bg-accent/10 border border-accent/30 text-accent text-sm rounded-xl px-4 py-3 text-left hover:bg-accent/20 transition-colors"
          >
            Activar notificaciones para recibir alertas de nuevos pedidos
          </button>
        </div>
      )}
      <main className="max-w-2xl mx-auto p-4 space-y-5 pb-28">

        {/* Header */}
        <div className="flex flex-wrap justify-between items-start gap-3 pt-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Mis entregas de hoy</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {new Date().toLocaleDateString('es-AR', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </p>
          </div>
          <button
            onClick={() => { setPinModal(true); setPinOk(false); setPinError('') }}
            className="text-xs text-gray-400 hover:text-accent transition-colors border border-[#D3D1C7] rounded-lg px-3 py-1.5"
          >
            Cambiar PIN
          </button>
        </div>

        {/* Turno del día — camión y ayudante */}
        {despachoHoy && (despachoHoy.camionLabel || despachoHoy.ayudanteName) && (
          <div className="bg-accent/5 border border-accent/20 rounded-2xl px-4 py-3 flex flex-wrap gap-4 text-sm">
            {despachoHoy.camionLabel && (
              <span className="flex items-center gap-1.5 text-gray-700">
                🚛 <span className="font-semibold text-gray-900">{despachoHoy.camionLabel}</span>
              </span>
            )}
            {despachoHoy.ayudanteName && (
              <span className="flex items-center gap-1.5 text-gray-700">
                👤 <span className="font-semibold text-gray-900">{despachoHoy.ayudanteName}</span>
              </span>
            )}
          </div>
        )}

        {/* Contadores */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-[#D3D1C7] rounded-2xl p-5 text-center shadow-sm">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Por entregar</p>
            <p className="text-5xl font-bold text-gray-900 mt-2 leading-none">{pending.length}</p>
          </div>
          <div className="bg-white border border-[#D3D1C7] rounded-2xl p-5 text-center shadow-sm">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Entregados</p>
            <p className="text-5xl font-bold text-accent mt-2 leading-none">{delivered.length}</p>
          </div>
        </div>

        {pending.length > 0 && <CargaDelDia orders={pending} />}

        {orders.length === 0 && (
          <div className="bg-white border border-[#D3D1C7] rounded-2xl p-10 text-center shadow-sm">
            <p className="text-4xl mb-3">📦</p>
            <p className="text-gray-500">No tenés entregas asignadas para hoy</p>
          </div>
        )}

        {pending.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Por entregar</h2>
            <div className="space-y-3">
              {pending.map((o, i) => (
                <DeliveryCard key={o.id} order={o} index={i + 1} isFirst={i === 0} />
              ))}
            </div>
          </section>
        )}

        {(visitasHoy.length > 0 || puntualHoy.length > 0) && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Visitas de hoy</h2>
            {visitasHoy.map((p) => {
              const yaEntregado = entregadosHoyIds.has(p.clientId)
              return (
                <div key={p.id} className={`bg-white border rounded-2xl p-4 space-y-2 shadow-sm ${yaEntregado ? 'border-accent/30 opacity-60' : 'border-accent/30'}`}>
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm text-gray-900">{p.clientName}</p>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">recurrente</span>
                        {yaEntregado && <span className="text-xs text-accent font-medium">✓ Entregado</span>}
                      </div>
                      <p className="text-gray-500 text-xs mt-0.5">{p.clientAddress}</p>
                      {p.clientPhone && <a href={`tel:${p.clientPhone}`} className="text-accent text-xs hover:underline">{p.clientPhone}</a>}
                      {p.notas && <p className="text-xs text-gray-400 italic mt-1">"{p.notas}"</p>}
                    </div>
                    {!yaEntregado && (
                      <Button onClick={() => setRegistrando({ tipo: 'programa', data: p })} className="text-xs py-2 px-4 shrink-0">
                        Registrar
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {puntualHoy.map((v) => (
              <div key={v.id} className={`bg-white border rounded-2xl p-4 space-y-2 shadow-sm ${v.status === 'visitado' ? 'border-accent/30 opacity-60' : v.status === 'sin_contacto' ? 'border-orange-300 opacity-60' : 'border-[#D3D1C7]'}`}>
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-gray-900">{v.clientName}</p>
                      {v.status === 'visitado' && <span className="text-xs text-accent font-medium">✓ Entregado</span>}
                      {v.status === 'sin_contacto' && <span className="text-xs text-orange-500 font-medium">Sin contacto</span>}
                    </div>
                    <p className="text-gray-500 text-xs mt-0.5">{v.clientAddress}</p>
                    {v.clientPhone && <a href={`tel:${v.clientPhone}`} className="text-accent text-xs hover:underline">{v.clientPhone}</a>}
                    {v.notas && <p className="text-xs text-gray-400 italic mt-1">"{v.notas}"</p>}
                  </div>
                  {v.status === 'pendiente' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button onClick={() => setRegistrando({ tipo: 'visita', data: v })} className="text-xs py-2 px-4">
                        Registrar
                      </Button>
                      <button
                        onClick={() => { setSinContactoMotivo(''); setSinContactoVisita(v) }}
                        className="text-xs text-gray-400 hover:text-orange-500 text-center transition-colors"
                      >
                        Sin contacto
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        {proximasVisitas.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Próximas visitas</h2>
            {proximasVisitas.map(({ label, fecha, items }) => (
              <div key={fecha}>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2 capitalize">{label}</p>
                <div className="space-y-2">
                  {items.map((v) => (
                    <div key={v.id} className="bg-white border border-[#D3D1C7] rounded-2xl p-4 shadow-sm">
                      <p className="font-semibold text-sm text-gray-900">{v.clientName}</p>
                      <p className="text-gray-500 text-xs mt-0.5">{v.clientAddress}</p>
                      {v.clientPhone && <a href={`tel:${v.clientPhone}`} className="text-accent text-xs hover:underline">{v.clientPhone}</a>}
                      {v.notas && <p className="text-xs text-gray-400 italic mt-1">"{v.notas}"</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {delivered.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Entregados hoy</h2>
            <div className="space-y-2">
              {delivered.map((o) => (
                <div
                  key={o.id}
                  className="bg-white border border-accent/30 rounded-2xl p-3 opacity-70 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-accent font-bold text-xs">✓</span>
                    <p className="font-medium text-sm text-gray-900">{o.clientName}</p>
                  </div>
                  <p className="text-gray-500 text-xs mt-0.5 pl-4">{o.clientAddress}</p>
                  <p className="text-xs text-gray-400 mt-0.5 pl-4">{summarizeProducts(o.products)}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <ChoferBottomNav
        activePage="entregas"
        hasPending={pending.length > 0}
        pdfLoading={pdfLoading}
        onPdf={async () => {
          setPdfLoading(true)
          const name = user?.nombreContacto || user?.nombre || 'Chofer'
          await generateHojaDeRuta(pending, name)
          setPdfLoading(false)
        }}
      />

      {sinContactoVisita && (
        <Modal open onClose={() => setSinContactoVisita(null)} title="Sin contacto" variant="light">
          <p className="text-sm text-gray-500 mb-4">{sinContactoVisita.clientName}</p>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {MOTIVOS_SIN_CONTACTO.map((m) => (
                <button
                  key={m}
                  onClick={() => setSinContactoMotivo(m)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    sinContactoMotivo === m
                      ? 'bg-orange-500/10 border-orange-400 text-orange-600'
                      : 'border-[#D3D1C7] text-gray-500 hover:border-orange-400 hover:text-orange-600'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <textarea
              value={sinContactoMotivo}
              onChange={(e) => setSinContactoMotivo(e.target.value)}
              rows={2}
              placeholder="O escribí el motivo..."
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-orange-400/30"
            />
          </div>
          <div className="flex gap-3 mt-5">
            <Button variant="outline" onClick={() => setSinContactoVisita(null)} className="flex-1">
              Volver
            </Button>
            <Button
              loading={sinContactoLoading}
              disabled={!sinContactoMotivo.trim()}
              className="flex-1 bg-orange-500 hover:bg-orange-400 text-white"
              onClick={async () => {
                setSinContactoLoading(true)
                await updateVisitaPuntual(sinContactoVisita.id, {
                  status: 'sin_contacto',
                  notas:  sinContactoMotivo.trim(),
                })
                setSinContactoLoading(false)
                setSinContactoVisita(null)
              }}
            >
              Confirmar
            </Button>
          </div>
        </Modal>
      )}

      {/* Modal cambiar PIN */}
      <Modal open={pinModal} onClose={() => setPinModal(false)} title="Cambiar PIN" variant="light">
        {pinOk ? (
          <div className="text-center py-4 space-y-3">
            <p className="text-4xl">✅</p>
            <p className="font-semibold text-gray-900">PIN actualizado correctamente</p>
            <Button onClick={() => setPinModal(false)} className="w-full">Cerrar</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">PIN actual</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={pinActual} onChange={(e) => setPinActual(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">PIN nuevo</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={pinNuevo} onChange={(e) => setPinNuevo(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Confirmar PIN nuevo</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            {pinError && <p className="text-sm text-red-500">{pinError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPinModal(false)} className="flex-1" disabled={pinLoading}>Cancelar</Button>
              <Button onClick={handleCambiarPin} loading={pinLoading} disabled={!pinActual || !pinNuevo || !pinConfirm} className="flex-1">Guardar</Button>
            </div>
          </div>
        )}
      </Modal>

      {registrando && (
        <RegistrarEntregaModal
          clientName={registrando.data.clientName}
          clientAddress={registrando.data.clientAddress}
          clientPhone={registrando.data.clientPhone}
          catalogo={catalogo}
          user={user}
          onConfirm={async (products) => {
            if (!user) return
            await createOrder({
              user: {
                ...user,
                razonSocial:    registrando.data.clientName,
                address:        registrando.data.clientAddress,
                telefono:       registrando.data.clientPhone,
                uid:            registrando.tipo === 'visita' ? registrando.data.clientId : user.uid,
              },
              products,
              date: new Date().toISOString().split('T')[0],
              notes: registrando.tipo === 'visita' ? (registrando.data.notas ?? '') : (registrando.data.notas ?? ''),
            })
            if (registrando.tipo === 'visita') {
              await updateVisitaPuntual(registrando.data.id, { status: 'visitado' })
            }
            setRegistrando(null)
          }}
          onClose={() => setRegistrando(null)}
        />
      )}
    </div>
  )
}

function RegistrarEntregaModal({
  clientName, clientAddress, catalogo, user, onConfirm, onClose,
}: {
  clientName:    string
  clientAddress: string
  clientPhone:   string
  catalogo:      { id: string; nombre: string; unidad: string }[]
  user:          import('../../types').UserProfile | null
  onConfirm:     (products: OrderProduct[]) => Promise<void>
  onClose:       () => void
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [saving,     setSaving]     = useState(false)

  const selected: OrderProduct[] = catalogo
    .filter((p) => (quantities[p.id] ?? 0) > 0)
    .map((p) => ({ name: p.nombre, quantity: quantities[p.id], productoId: p.id }))

  const handleConfirm = async () => {
    if (selected.length === 0) return
    setSaving(true)
    await onConfirm(selected)
    setSaving(false)
  }

  return (
    <Modal open onClose={onClose} title={`Registrar entrega — ${clientName}`} variant="light">
      <p className="text-xs text-gray-500 mb-4 truncate">{clientAddress}</p>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {catalogo.map((p) => {
          const qty = quantities[p.id] ?? 0
          return (
            <div key={p.id} className="flex items-center justify-between gap-3 bg-[#F8F7F2] border border-[#D3D1C7] rounded-xl px-3 py-2">
              <p className="text-sm text-gray-800 flex-1">{p.nombre}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQuantities((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 0) - 1) }))}
                  disabled={qty === 0}
                  className="w-9 h-9 rounded-full border border-[#D3D1C7] text-lg text-gray-600 hover:border-accent hover:text-accent transition-colors disabled:opacity-30 flex items-center justify-center"
                >−</button>
                <span className="w-8 text-center font-bold text-sm text-gray-900">{qty || '0'}</span>
                <button
                  onClick={() => setQuantities((q) => ({ ...q, [p.id]: (q[p.id] ?? 0) + 1 }))}
                  className="w-9 h-9 rounded-full border border-[#D3D1C7] text-lg text-gray-600 hover:border-accent hover:text-accent transition-colors flex items-center justify-center"
                >+</button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={handleConfirm} loading={saving} disabled={selected.length === 0} className="flex-1">
          Confirmar ({selected.length} productos)
        </Button>
      </div>
    </Modal>
  )
}

function DeliveryCard({ order, index, isFirst }: { order: Order; index: number; isFirst?: boolean }) {
  const [modal, setModal] = useState(false)

  const openInMaps = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.clientAddress)}`
    window.open(url, '_blank')
  }

  return (
    <>
      <div className={`bg-white rounded-2xl p-4 space-y-3 shadow-sm border border-[#D3D1C7] ${isFirst ? 'border-l-4 border-l-accent' : ''}`}>
        <div className="flex justify-between items-start gap-3">
          <div className="flex items-start gap-3">
            <span className={`w-7 h-7 rounded-full text-sm flex items-center justify-center font-bold shrink-0 mt-0.5 ${isFirst ? 'bg-accent text-white' : 'bg-accent/10 text-accent'}`}>
              {index}
            </span>
            <div>
              <p className="font-semibold text-gray-900">{order.clientName}</p>
              <p className="text-gray-500 text-sm">{order.clientAddress}</p>
              {order.clientPhone && (
                <a href={`tel:${order.clientPhone}`} className="text-accent text-sm hover:underline">
                  📞 {order.clientPhone}
                </a>
              )}
            </div>
          </div>
          <Badge status={order.status} variant="dark" />
        </div>

        <p className="text-sm text-gray-700 pl-10">{summarizeProducts(order.products)}</p>

        {order.notes && (
          <p className="text-xs text-gray-400 italic pl-10">"{order.notes}"</p>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={openInMaps} className="flex-1 text-sm py-3">
            📍 Abrir en Maps
          </Button>
          <Button onClick={() => setModal(true)} className="flex-1 text-sm py-3">
            ✓ Entregado
          </Button>
        </div>
      </div>

      {modal && (
        <EntregaModal
          order={order}
          onConfirm={async (entregados, parcial, nota) => {
            await markDelivered(order.id, entregados, parcial, nota)
            setModal(false)
          }}
          onClose={() => setModal(false)}
        />
      )}
    </>
  )
}

function CargaDelDia({ orders }: { orders: Order[] }) {
  const totals: Record<string, number> = {}
  orders.forEach((o) =>
    o.products.forEach((p) => {
      totals[p.name] = (totals[p.name] ?? 0) + p.quantity
    }),
  )
  const items = Object.entries(totals).sort((a, b) => b[1] - a[1])
  const totalUnidades = items.reduce((acc, [, q]) => acc + q, 0)

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-2xl p-4 space-y-3 shadow-sm">
      <div className="flex justify-between items-center">
        <p className="font-semibold text-sm text-accent">Carga del día</p>
        <span className="text-xs text-gray-400">{totalUnidades} unidades · {orders.length} paradas</span>
      </div>
      <div className="space-y-2">
        {items.map(([nombre, qty]) => (
          <div key={nombre} className="flex items-center gap-3">
            <span className="text-sm text-gray-700 flex-1">{nombre}</span>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-[#E8E6DF] rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full"
                  style={{ width: `${Math.round((qty / totalUnidades) * 100)}%` }}
                />
              </div>
              <span className="text-accent font-bold text-sm w-8 text-right">{qty}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChoferBottomNav({
  activePage,
  onPdf,
  pdfLoading,
  hasPending,
}: {
  activePage: 'entregas' | 'ruta'
  onPdf?: () => void
  pdfLoading?: boolean
  hasPending?: boolean
}) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#D3D1C7] flex z-30 shadow-[0_-1px_8px_rgba(0,0,0,0.06)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <Link
        to="/chofer"
        className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium transition-colors ${
          activePage === 'entregas' ? 'text-accent' : 'text-gray-400 hover:text-gray-700'
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
        </svg>
        <span>Entregas</span>
      </Link>

      <Link
        to="/chofer/map"
        className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium transition-colors ${
          activePage === 'ruta' ? 'text-accent' : 'text-gray-400 hover:text-gray-700'
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <span>Ruta</span>
      </Link>

      <button
        onClick={onPdf}
        disabled={!hasPending || pdfLoading}
        className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium text-gray-400 hover:text-gray-700 disabled:opacity-40 transition-colors"
      >
        {pdfLoading ? (
          <span className="w-5 h-5 border-2 border-muted border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        )}
        <span>PDF</span>
      </button>
    </nav>
  )
}
