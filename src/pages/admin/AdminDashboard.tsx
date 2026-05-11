import { useState, ChangeEvent, KeyboardEvent } from 'react'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useNotificationEmails } from '../../hooks/useNotificationEmails'
import { updateOrderStatus, assignDriver, updateOrderAddress } from '../../services/orderService'
import { notifyEnCamino } from '../../services/notificationService'
import { ALL_STATUSES, STATUS_FLOW, STATUS_LABELS } from '../../utils/constants'
import { formatShortDate, summarizeProducts, todayString } from '../../utils/helpers'
import { Order, OrderStatus } from '../../types'

type UseChoferesReturn = ReturnType<typeof useChoferes>

export default function AdminDashboard() {
  const { orders, loading } = useAllOrders()
  const choferes            = useChoferes()
  const notifEmails         = useNotificationEmails()
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState<OrderStatus | 'all'>('all')
  const [dateFilter, setDateFilter] = useState('')

  const today = todayString()
  const todayOrders = orders.filter(
    (o) => o.date?.toDate?.().toISOString().split('T')[0] === today,
  )

  const filtered = orders.filter((o) => {
    const matchStatus = filter === 'all' || o.status === filter
    const matchDate   = !dateFilter ||
      o.date?.toDate?.().toISOString().split('T')[0] === dateFilter
    const q = search.toLowerCase()
    const matchSearch = !q ||
      o.clientName?.toLowerCase().includes(q) ||
      o.clientAddress?.toLowerCase().includes(q) ||
      o.products?.some((p) => p.name.toLowerCase().includes(q))
    return matchStatus && matchDate && matchSearch
  })

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Panel Admin</h1>
            <p className="text-muted text-sm">Gestión de pedidos y logística</p>
          </div>
          <div className="flex gap-2">
            <TestNotifyButton />
            <NotificationEmailManager notifEmails={notifEmails} />
            <ChoferManager choferes={choferes} />
          </div>
        </div>

        <div>
          <p className="text-sm text-muted mb-3">
            Hoy — {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {ALL_STATUSES.map((s) => (
              <div key={s} className="bg-surface border border-border rounded-xl p-3 text-center">
                <p className="text-muted text-xs truncate">{STATUS_LABELS[s]}</p>
                <p className="text-2xl font-bold text-accent mt-1">
                  {todayOrders.filter((o) => o.status === s).length}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <input
              value={search}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, dirección o producto..."
              className="bg-surface border border-border rounded-lg px-3 py-2 text-white placeholder-muted text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="date"
              value={dateFilter}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDateFilter(e.target.value)}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {(search || dateFilter) && (
              <button
                onClick={() => { setSearch(''); setDateFilter('') }}
                className="text-sm text-muted hover:text-white px-3 py-2"
              >
                Limpiar ✕
              </button>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            {(['all', ...ALL_STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filter === s
                    ? 'bg-accent text-bg border-accent'
                    : 'border-border text-muted hover:border-accent hover:text-white'
                }`}
              >
                {s === 'all'
                  ? `Todos (${orders.length})`
                  : `${STATUS_LABELS[s]} (${orders.filter((o) => o.status === s).length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-8 text-center">
              <p className="text-muted text-sm">No hay pedidos con estos filtros</p>
            </div>
          ) : (
            filtered.map((o) => (
              <AdminOrderCard key={o.id} order={o} choferes={choferes.choferes} />
            ))
          )}
        </div>
      </main>
    </>
  )
}

function AdminOrderCard({ order, choferes }: { order: Order; choferes: string[] }) {
  const [statusLoading, setStatusLoading] = useState(false)
  const [editingAddress, setEditingAddress] = useState(false)
  const [newAddress, setNewAddress]         = useState(order.clientAddress)

  const getNextStatus = (): OrderStatus | null => {
    const idx = STATUS_FLOW.indexOf(order.status)
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null
  }

  const handleStatus = async (newStatus: string) => {
    setStatusLoading(true)
    await updateOrderStatus(order.id, newStatus)
    if (newStatus === 'en_camino' && order.clientEmail) {
      notifyEnCamino({
        email:    order.clientEmail,
        nombre:   (order.clientName || '').split(' ')[0] || 'Cliente',
        products: order.products,
      }).catch(console.error)
    }
    setStatusLoading(false)
  }

  const handleDriver = async (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value || null
    await assignDriver(order.id, val)
  }

  const handleSaveAddress = async () => {
    await updateOrderAddress(order.id, newAddress)
    setEditingAddress(false)
  }

  const next = getNextStatus()

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div>
          <p className="font-semibold">{order.clientName}</p>
          <p className="text-muted text-xs">{order.clientPhone || 'Sin teléfono'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge status={order.status} />
          <span className="text-xs text-muted">{formatShortDate(order.date)}</span>
        </div>
      </div>

      <div className="text-sm">
        {editingAddress ? (
          <div className="flex gap-2">
            <input
              value={newAddress}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewAddress(e.target.value)}
              className="bg-bg border border-border rounded px-2 py-1 text-white text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button onClick={handleSaveAddress} className="text-success text-xs hover:underline">Guardar</button>
            <button onClick={() => setEditingAddress(false)} className="text-muted text-xs hover:underline">Cancelar</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-muted text-xs">📍 {order.clientAddress}</p>
            <button
              onClick={() => setEditingAddress(true)}
              className="text-accent text-xs hover:underline"
            >
              Editar
            </button>
          </div>
        )}
      </div>

      <p className="text-sm text-white">{summarizeProducts(order.products)}</p>

      {order.notes && (
        <p className="text-xs text-muted italic">"{order.notes}"</p>
      )}

      <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-border">
        <select
          value={order.driverId ?? ''}
          onChange={handleDriver}
          className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-40"
        >
          <option value="">Sin chofer asignado</option>
          {choferes.map((email) => (
            <option key={email} value={email}>{email}</option>
          ))}
        </select>

        {next && (
          <Button
            onClick={() => handleStatus(next)}
            loading={statusLoading}
            className="text-xs py-1.5 px-3"
          >
            → {STATUS_LABELS[next]}
          </Button>
        )}

        {!['cancelado', 'entregado'].includes(order.status) && (
          <Button
            variant="danger"
            onClick={() => handleStatus('cancelado')}
            disabled={statusLoading}
            className="text-xs py-1.5 px-3"
          >
            Cancelar
          </Button>
        )}
      </div>
    </div>
  )
}

// ── TEST — botón temporal para debuggear las Netlify Functions ───────────────
// Eliminar este componente una vez confirmado que los emails llegan.
function TestNotifyButton() {
  const [status, setStatus] = useState<string | null>(null)
  const [busy,   setBusy]   = useState(false)

  const handleTest = async () => {
    setBusy(true)
    setStatus(null)
    const url  = '/.netlify/functions/notify-pedido-recibido'
    const body = {
      email:    'pontieroariel@gmail.com',
      nombre:   'Test Admin',
      products: [{ name: 'Hielo en cubos 5kg', quantity: 3 }],
      date:     new Date().toISOString().split('T')[0],
      notes:    'Email de prueba desde el panel admin',
    }
    console.log('[TEST] POST', url, body)
    try {
      const res  = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      const msg  = `${res.status} ${res.ok ? 'OK' : 'ERROR'} — ${JSON.stringify(json)}`
      console.log('[TEST] Respuesta:', msg)
      setStatus(res.ok ? `✓ ${msg}` : `✗ ${msg}`)
    } catch (err) {
      const msg = String(err)
      console.error('[TEST] Fetch falló:', err)
      setStatus(`✗ Fetch falló: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        onClick={handleTest}
        loading={busy}
        className="text-xs border-yellow-500/50 text-yellow-400 hover:border-yellow-400"
      >
        Test email
      </Button>
      {status && (
        <span className={`text-xs max-w-xs text-right ${status.startsWith('✓') ? 'text-success' : 'text-red-400'}`}>
          {status}
        </span>
      )}
    </div>
  )
}

type UseNotificationEmailsReturn = ReturnType<typeof useNotificationEmails>

function NotificationEmailManager({ notifEmails }: { notifEmails: UseNotificationEmailsReturn }) {
  const { emails, addEmail, removeEmail } = notifEmails
  const [open,  setOpen]  = useState(false)
  const [email, setEmail] = useState('')

  const handleAdd = async () => {
    if (!email.trim()) return
    await addEmail(email)
    setEmail('')
  }

  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)} className="text-sm">
        Notificaciones ({emails.length}) ▾
      </Button>

      {open && (
        <div className="absolute right-0 top-10 bg-surface border border-border rounded-xl p-4 z-50 w-80 shadow-2xl">
          <h3 className="font-semibold mb-1 text-sm">Emails de notificación</h3>
          <p className="text-muted text-xs mb-3">
            Reciben un email cuando llega un pedido nuevo.
          </p>

          {emails.length === 0 ? (
            <p className="text-muted text-xs mb-3">Sin emails configurados</p>
          ) : (
            <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
              {emails.map((e) => (
                <div key={e} className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-sm text-muted truncate flex-1">{e}</span>
                  <button
                    onClick={() => removeEmail(e)}
                    className="text-red-400 text-xs hover:underline ml-2 shrink-0"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleAdd() }}
              placeholder="admin@empresa.com"
              className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white flex-1 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button onClick={handleAdd} className="text-xs py-1.5 px-3">
              + Agregar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChoferManager({ choferes }: { choferes: UseChoferesReturn }) {
  const { choferes: list, addNewChofer, removeChofer } = choferes
  const [open,  setOpen]  = useState(false)
  const [email, setEmail] = useState('')

  const handleAdd = async () => {
    if (!email.trim()) return
    await addNewChofer(email)
    setEmail('')
  }

  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)} className="text-sm">
        Choferes ({list.length}) ▾
      </Button>

      {open && (
        <div className="absolute right-0 top-10 bg-surface border border-border rounded-xl p-4 z-50 w-80 shadow-2xl">
          <h3 className="font-semibold mb-3 text-sm">Gestionar choferes</h3>

          {list.length === 0 ? (
            <p className="text-muted text-xs mb-3">No hay choferes configurados</p>
          ) : (
            <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
              {list.map((e) => (
                <div key={e} className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-sm text-muted truncate flex-1">{e}</span>
                  <button
                    onClick={() => removeChofer(e)}
                    className="text-red-400 text-xs hover:underline ml-2 shrink-0"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleAdd() }}
              placeholder="email@chofer.com"
              className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white flex-1 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button onClick={handleAdd} className="text-xs py-1.5 px-3">
              + Agregar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
