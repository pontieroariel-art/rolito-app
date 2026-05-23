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

  // Refs para evitar re-disparar el effect cuando cambia el nombre/teléfono
  const nombreRef   = useRef(user?.nombreContacto || user?.nombre || '')
  const telefonoRef = useRef(user?.telefono       || user?.phone  || '')
  useEffect(() => {
    nombreRef.current   = user?.nombreContacto || user?.nombre || ''
    telefonoRef.current = user?.telefono       || user?.phone  || ''
  })

  // Comparte ubicación GPS cada 10 s mientras haya pedidos pendientes.
  // Activa desde que el chofer tiene cualquier pedido asignado (no solo en_camino)
  // para que logística pueda ver su posición durante todo el reparto.
  // Al desmontar (logout) o cuando no quedan pendientes, marca activo: false.
  // Se pausa automáticamente cuando la pestaña queda en segundo plano.
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
    <>
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
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div>
            <h1 className="text-2xl font-bold">Mis entregas de hoy</h1>
            <p className="text-muted text-sm">
              {new Date().toLocaleDateString('es-AR', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {pending.length > 0 && (
              <Button
                variant="outline"
                loading={pdfLoading}
                disabled={pdfLoading}
                onClick={async () => {
                  setPdfLoading(true)
                  const name = user?.nombreContacto || user?.nombre || 'Chofer'
                  await generateHojaDeRuta(pending, name)
                  setPdfLoading(false)
                }}
                className="text-sm"
              >
                📄 Hoja de ruta
              </Button>
            )}
            {pending.length > 0 && (
              <Link to="/chofer/map">
                <Button className="text-sm">🗺 Ver ruta en mapa</Button>
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-muted text-sm">Pendientes</p>
            <p className="text-4xl font-bold text-accent mt-1">{pending.length}</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-muted text-sm">Entregados</p>
            <p className="text-4xl font-bold text-success mt-1">{delivered.length}</p>
          </div>
        </div>

        {pending.length > 0 && <CargaDelDia orders={pending} />}

        {orders.length === 0 && (
          <div className="bg-surface border border-border rounded-xl p-10 text-center">
            <p className="text-4xl mb-3">📦</p>
            <p className="text-muted">No tenés entregas asignadas para hoy</p>
          </div>
        )}

        {pending.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Por entregar</h2>
            <div className="space-y-3">
              {pending.map((o, i) => (
                <DeliveryCard key={o.id} order={o} index={i + 1} />
              ))}
            </div>
          </section>
        )}

        {/* Visitas sin pedido previo */}
        {(visitasHoy.length > 0 || puntualHoy.length > 0) && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Visitas de hoy</h2>
            {visitasHoy.map((p) => {
              const yaEntregado = entregadosHoyIds.has(p.clientId)
              return (
                <div key={p.id} className={`bg-surface border rounded-xl p-4 space-y-2 ${yaEntregado ? 'border-success/30 opacity-60' : 'border-accent/30'}`}>
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{p.clientName}</p>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20">recurrente</span>
                        {yaEntregado && <span className="text-xs text-success font-medium">✓ Entregado</span>}
                      </div>
                      <p className="text-muted text-xs mt-0.5">{p.clientAddress}</p>
                      {p.clientPhone && <a href={`tel:${p.clientPhone}`} className="text-accent text-xs hover:underline">{p.clientPhone}</a>}
                      {p.notas && <p className="text-xs text-muted/70 italic mt-1">"{p.notas}"</p>}
                    </div>
                    {!yaEntregado && (
                      <Button onClick={() => setRegistrando({ tipo: 'programa', data: p })} className="text-xs py-1.5 px-3 shrink-0">
                        Registrar entrega
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {puntualHoy.map((v) => (
              <div key={v.id} className={`bg-surface border rounded-xl p-4 space-y-2 ${v.status === 'visitado' ? 'border-success/30 opacity-60' : v.status === 'sin_contacto' ? 'border-orange-500/30 opacity-60' : 'border-border'}`}>
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{v.clientName}</p>
                      {v.status === 'visitado' && <span className="text-xs text-success font-medium">✓ Entregado</span>}
                      {v.status === 'sin_contacto' && <span className="text-xs text-orange-400 font-medium">Sin contacto</span>}
                    </div>
                    <p className="text-muted text-xs mt-0.5">{v.clientAddress}</p>
                    {v.clientPhone && <a href={`tel:${v.clientPhone}`} className="text-accent text-xs hover:underline">{v.clientPhone}</a>}
                    {v.notas && <p className="text-xs text-muted/70 italic mt-1">"{v.notas}"</p>}
                  </div>
                  {v.status === 'pendiente' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button onClick={() => setRegistrando({ tipo: 'visita', data: v })} className="text-xs py-1.5 px-3">
                        Registrar entrega
                      </Button>
                      <button
                        onClick={() => { setSinContactoMotivo(''); setSinContactoVisita(v) }}
                        className="text-xs text-muted hover:text-orange-400 text-center"
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

        {delivered.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3 text-success">✓ Entregados</h2>
            <div className="space-y-2">
              {delivered.map((o) => (
                <div
                  key={o.id}
                  className="bg-surface border border-success/20 rounded-xl p-3 opacity-60"
                >
                  <p className="font-medium text-sm">{o.clientName}</p>
                  <p className="text-muted text-xs">{o.clientAddress}</p>
                  <p className="text-xs text-muted mt-1">{summarizeProducts(o.products)}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Modal sin contacto */}
      {sinContactoVisita && (
        <Modal open onClose={() => setSinContactoVisita(null)} title="Sin contacto">
          <p className="text-sm text-muted mb-4">{sinContactoVisita.clientName}</p>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {MOTIVOS_SIN_CONTACTO.map((m) => (
                <button
                  key={m}
                  onClick={() => setSinContactoMotivo(m)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    sinContactoMotivo === m
                      ? 'bg-orange-500/20 border-orange-500/50 text-orange-400'
                      : 'border-border text-muted hover:border-orange-500/40 hover:text-orange-400'
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
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted resize-none focus:outline-none focus:ring-1 focus:ring-orange-500"
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

      {/* Modal registrar entrega de visita */}
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
    </>
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
    <Modal open onClose={onClose} title={`Registrar entrega — ${clientName}`}>
      <p className="text-xs text-muted mb-4 truncate">{clientAddress}</p>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {catalogo.map((p) => {
          const qty = quantities[p.id] ?? 0
          return (
            <div key={p.id} className="flex items-center justify-between gap-3 bg-bg border border-border rounded-xl px-3 py-2">
              <p className="text-sm flex-1">{p.nombre}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQuantities((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 0) - 1) }))}
                  disabled={qty === 0}
                  className="w-8 h-8 rounded-full border border-border text-lg hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center"
                >−</button>
                <span className="w-8 text-center font-bold text-sm">{qty || '0'}</span>
                <button
                  onClick={() => setQuantities((q) => ({ ...q, [p.id]: (q[p.id] ?? 0) + 1 }))}
                  className="w-8 h-8 rounded-full border border-border text-lg hover:border-accent transition-colors flex items-center justify-center"
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

function DeliveryCard({ order, index }: { order: Order; index: number }) {
  const [modal, setModal] = useState(false)

  const openInMaps = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.clientAddress)}`
    window.open(url, '_blank')
  }

  return (
    <>
      <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
        <div className="flex justify-between items-start gap-3">
          <div className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-accent/20 text-accent text-sm flex items-center justify-center font-bold shrink-0 mt-0.5">
              {index}
            </span>
            <div>
              <p className="font-semibold">{order.clientName}</p>
              <p className="text-muted text-sm">{order.clientAddress}</p>
              {order.clientPhone && (
                <a href={`tel:${order.clientPhone}`} className="text-accent text-sm hover:underline">
                  📞 {order.clientPhone}
                </a>
              )}
            </div>
          </div>
          <Badge status={order.status} />
        </div>

        <p className="text-sm text-white pl-10">{summarizeProducts(order.products)}</p>

        {order.notes && (
          <p className="text-xs text-muted italic pl-10">"{order.notes}"</p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={openInMaps} className="flex-1 text-sm py-2">
            📍 Abrir en Maps
          </Button>
          <Button onClick={() => setModal(true)} variant="success" className="flex-1 text-sm py-2">
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
    <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 space-y-3">
      <div className="flex justify-between items-center">
        <p className="font-semibold text-sm text-accent">Carga del día</p>
        <span className="text-xs text-muted">{totalUnidades} unidades · {orders.length} paradas</span>
      </div>
      <div className="space-y-2">
        {items.map(([nombre, qty]) => (
          <div key={nombre} className="flex items-center gap-3">
            <span className="text-sm text-white flex-1">{nombre}</span>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-border rounded-full overflow-hidden">
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
