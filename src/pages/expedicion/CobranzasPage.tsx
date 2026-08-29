import { useEffect, useMemo, useState } from 'react'
import { HandCoins, Printer } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import ClienteCombobox, { toComboItems } from '../../components/ui/ClienteCombobox'
import { useAuth } from '../../context/AuthContext'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { crearCobranzaCaja, subscribeCobranzasCajaDelDia } from '../../services/cobranzaService'
import { generateReciboCobranza } from '../../utils/pdf'
import { Cobranza, PLANTAS } from '../../types'

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

const FORMAS: { id: Cobranza['formaPago']; label: string }[] = [
  { id: 'contado_efectivo',      label: 'Efectivo' },
  { id: 'contado_transferencia', label: 'Transferencia' },
]

// Cobranza al público (caja): clientes de cuenta corriente que vienen al
// mostrador a pagar deudas. Misma colección que usarán los cobradores de
// calle (Fase 5) — acá el origen es 'caja'.
export default function CobranzasPage() {
  const { user } = useAuth()
  const { clientes } = useClientesActivos()
  const plantaId = user?.planta ?? 'torcuato'

  const [clienteId,  setClienteId]  = useState('')
  const [importe,    setImporte]    = useState('')
  const [formaPago,  setFormaPago]  = useState<Cobranza['formaPago'] | null>(null)
  const [referencia, setReferencia] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')
  const [cobranzas,   setCobranzas]   = useState<Cobranza[]>([])

  useEffect(() => subscribeCobranzasCajaDelDia(plantaId, new Date(), setCobranzas), [plantaId])

  const cliente = useMemo(() => clientes.find((c) => c.uid === clienteId), [clientes, clienteId])
  const monto   = parseInt(importe.replace(/\D/g, ''), 10) || 0
  const totalDia = cobranzas.reduce((s, c) => s + c.importe, 0)

  const abrirConfirmacion = () => {
    setError('')
    if (!cliente)   { setError('Elegí el cliente que paga.'); return }
    if (monto <= 0) { setError('Poné el importe cobrado.'); return }
    if (!formaPago) { setError('Elegí la forma de pago.'); return }
    setConfirmando(true)
  }

  const imprimir = (c: Cobranza) =>
    generateReciboCobranza({
      id:            c.id,
      plantaId,
      clienteNombre: c.clienteNombre,
      importe:       c.importe,
      formaPago:     c.formaPago,
      referencia:    c.referencia,
      registradoPor: c.registradoPor.nombre,
      fecha:         c.fecha.toDate(),
    }).catch((err) => console.error('[cobranzas] error al generar el recibo:', err))

  const confirmar = async () => {
    if (!user || !cliente || !formaPago) return
    setGuardando(true)
    setError('')
    try {
      const cobranza = await crearCobranzaCaja(
        {
          clienteId:     cliente.uid,
          clienteNombre: cliente.razonSocial || cliente.nombre,
          importe:       monto,
          formaPago,
          referencia,
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setConfirmando(false)
      setClienteId('')
      setImporte('')
      setFormaPago(null)
      setReferencia('')
      imprimir(cobranza)
    } catch (err) {
      console.error('[cobranzas] error al registrar:', err)
      setError('No se pudo registrar la cobranza. Revisá la conexión e intentá de nuevo.')
      setConfirmando(false)
    } finally {
      setGuardando(false)
    }
  }

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const toggleClass = (activo: boolean) =>
    `flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
      activo ? 'bg-accent/10 border-accent text-accent' : 'bg-white border-[#D3D1C7] text-gray-600 hover:bg-gray-50'
    }`

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cobranzas</h1>
        <p className="text-gray-500 text-sm">{PLANTAS[plantaId].label} · pagos de cuenta corriente en mostrador</p>
      </div>

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <HandCoins size={18} className="text-accent" /> Nueva cobranza
        </h2>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Cliente</label>
          <ClienteCombobox items={toComboItems(clientes)} value={clienteId} onChange={setClienteId} placeholder="Buscar cliente…" />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Importe</label>
            <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" className={selectClass} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Factura / referencia (opcional)</label>
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej. FC A-0001-00001234" className={selectClass} />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Forma de pago</label>
          <div className="flex gap-2">
            {FORMAS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFormaPago(f.id)} className={toggleClass(formaPago === f.id)}>{f.label}</button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        <Button onClick={abrirConfirmacion} className="w-full">Registrar cobranza e imprimir recibo</Button>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Cobranzas de hoy</h2>
          {cobranzas.length > 0 && <p className="text-sm font-semibold text-gray-900">{money(totalDia)}</p>}
        </div>
        {cobranzas.length === 0 && <p className="text-gray-400 text-sm">Todavía no se registraron cobranzas hoy.</p>}
        {cobranzas.map((c) => (
          <div key={c.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{c.clienteNombre}</p>
              <p className="text-xs text-gray-500">
                {money(c.importe)} · {FORMAS.find((f) => f.id === c.formaPago)?.label}
                {c.referencia ? ` · ${c.referencia}` : ''}
              </p>
            </div>
            <button onClick={() => imprimir(c)} title="Reimprimir recibo" className="text-gray-400 hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10">
              <Printer size={16} />
            </button>
          </div>
        ))}
      </section>

      {confirmando && cliente && formaPago && (
        <Modal open onClose={() => setConfirmando(false)} title="Confirmar cobranza">
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Cobrás <span className="font-semibold">{money(monto)}</span> en {FORMAS.find((f) => f.id === formaPago)?.label?.toLowerCase()} a{' '}
              <span className="font-semibold">{cliente.razonSocial || cliente.nombre}</span>
              {referencia.trim() ? <> por <span className="font-medium">{referencia.trim()}</span></> : null}.
            </p>
            <p className="text-xs text-gray-500">Se imprime el recibo para el cliente. El registro es definitivo.</p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmar} loading={guardando} className="flex-1">Confirmar e imprimir</Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}
