import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, HandCoins } from 'lucide-react'
import ChoferHeader from '../../components/chofer/ChoferHeader'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ClienteCombobox, { toComboItems } from '../../components/ui/ClienteCombobox'
import { useAuth } from '../../context/AuthContext'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { useFechaDelDia } from '../../hooks/useDiaActual'
import { crearCobranzaCalle, subscribeCobranzasChoferEnRango } from '../../services/cobranzaService'
import { Cobranza } from '../../types'

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

const FORMAS: { id: Cobranza['formaPago']; label: string }[] = [
  { id: 'contado_efectivo',      label: 'Efectivo' },
  { id: 'contado_transferencia', label: 'Transferencia' },
]

// Cobranza en la calle: el chofer/cobrador cobra una deuda de cta. cte. de un
// cliente. Misma colección que el mostrador (origen 'cobrador') — entra a la
// liquidación del día y el efectivo se rinde junto con el de las ventas.
// Offline-first: registra sin señal y sincroniza al reconectar.
export default function CobranzaCalle() {
  const { user } = useAuth()
  const { clientes, loading: loadingClientes } = useClientesActivos()
  const fecha = useFechaDelDia()

  const [clienteId,  setClienteId]  = useState('')
  const [importe,    setImporte]    = useState('')
  const [formaPago,  setFormaPago]  = useState<Cobranza['formaPago'] | null>(null)
  const [referencia, setReferencia] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [exito, setExito] = useState<{ cliente: string; monto: number } | null>(null)
  const [error, setError] = useState('')
  const [cobranzasHoy, setCobranzasHoy] = useState<Cobranza[]>([])

  useEffect(() => {
    if (!user) return
    const desde = new Date(fecha); desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
    return subscribeCobranzasChoferEnRango(user.uid, desde, hasta, setCobranzasHoy)
  }, [user, fecha])

  const cliente = useMemo(() => clientes.find((c) => c.uid === clienteId), [clientes, clienteId])
  const monto   = parseInt(importe.replace(/\D/g, ''), 10) || 0
  const totalHoy = cobranzasHoy.reduce((s, c) => s + c.importe, 0)

  const abrirConfirmacion = () => {
    setError('')
    if (!cliente)   { setError('Elegí el cliente que paga.'); return }
    if (monto <= 0) { setError('Poné el importe cobrado.'); return }
    if (!formaPago) { setError('Elegí la forma de pago.'); return }
    setConfirmando(true)
  }

  const confirmar = () => {
    if (!user || !cliente || !formaPago) return
    try {
      crearCobranzaCalle(
        {
          clienteId:     cliente.uid,
          clienteNombre: cliente.razonSocial || cliente.nombre,
          importe:       monto,
          formaPago,
          referencia,
        },
        { uid: user.uid, nombre: user.nombre },
      )
      setExito({ cliente: cliente.razonSocial || cliente.nombre, monto })
      setClienteId('')
      setImporte('')
      setFormaPago(null)
      setReferencia('')
      setConfirmando(false)
    } catch {
      setError('No se pudo registrar la cobranza. Intentá de nuevo.')
      setConfirmando(false)
    }
  }

  if (loadingClientes) return <LoadingSpinner fullScreen />

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const toggleClass = (activo: boolean) =>
    `flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
      activo ? 'bg-accent/10 border-accent text-accent' : 'bg-white border-[#D3D1C7] text-gray-600 hover:bg-gray-50'
    }`

  if (exito) {
    return (
      <div className="min-h-screen bg-[#F8F7F2]">
        <ChoferHeader title="Cobrar" back />
        <main className="max-w-md mx-auto p-4 pt-10 text-center space-y-4">
          <CheckCircle2 size={48} className="text-accent mx-auto" />
          <div>
            <p className="text-lg font-semibold text-gray-900">Cobranza registrada</p>
            <p className="text-sm text-gray-600 mt-1">{money(exito.monto)} — {exito.cliente}</p>
            <p className="text-xs text-gray-500 mt-2">Entra a tu liquidación del día: el efectivo se rinde en caja al volver.</p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => setExito(null)} className="w-full">Registrar otra cobranza</Button>
            <Link to="/chofer" className="text-sm text-gray-500 hover:text-accent">Volver al inicio</Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8F7F2]">
      <ChoferHeader title="Cobrar" back />
      <main className="max-w-md mx-auto p-4 space-y-4 pb-10">
        <div className="flex items-center gap-2 text-gray-700">
          <HandCoins size={18} className="text-accent" />
          <p className="text-sm">Cobranza de cuenta corriente en la calle.</p>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Cliente</label>
          <ClienteCombobox items={toComboItems(clientes)} value={clienteId} onChange={setClienteId} placeholder="Buscar cliente…" />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Importe</label>
          <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" className={selectClass} />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Forma de pago</label>
          <div className="flex gap-2">
            {FORMAS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFormaPago(f.id)} className={toggleClass(formaPago === f.id)}>{f.label}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Factura / referencia (opcional)</label>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej. FC A-0001-00001234" className={selectClass} />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        <Button onClick={abrirConfirmacion} className="w-full">Registrar cobranza</Button>

        {cobranzasHoy.length > 0 && (
          <section className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Cobrado hoy</h2>
              <p className="text-sm font-semibold text-gray-900">{money(totalHoy)}</p>
            </div>
            <div className="space-y-2">
              {cobranzasHoy.map((c) => (
                <div key={c.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-medium text-gray-900 truncate">{c.clienteNombre}</p>
                    <p className="text-sm font-semibold text-gray-900 shrink-0">{money(c.importe)}</p>
                  </div>
                  <p className="text-xs text-gray-500">
                    {FORMAS.find((f) => f.id === c.formaPago)?.label}{c.referencia ? ` · ${c.referencia}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {confirmando && cliente && formaPago && (
          <Modal open onClose={() => setConfirmando(false)} title="Confirmar cobranza">
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                Cobrás <span className="font-semibold">{money(monto)}</span> en {FORMAS.find((f) => f.id === formaPago)?.label?.toLowerCase()} a{' '}
                <span className="font-semibold">{cliente.razonSocial || cliente.nombre}</span>
                {referencia.trim() ? <> por <span className="font-medium">{referencia.trim()}</span></> : null}.
              </p>
              <p className="text-xs text-gray-500">El registro es definitivo y entra a tu rendición del día.</p>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
                <Button onClick={confirmar} className="flex-1">Confirmar</Button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </div>
  )
}
