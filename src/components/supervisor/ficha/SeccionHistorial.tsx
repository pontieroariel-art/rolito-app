import { useEffect, useMemo, useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { Plegable } from '@/components/ui/Plegable'
import { CobranzaSupervisorCard } from '@/components/supervisor/CobranzaSupervisorCard'
import { getHistorialCliente, type HistorialCliente } from '@/services/historialClienteService'
import { subscribeClientOrders } from '@/services/orderService'
import { caiRemitoOficialCacheado, getCaiRemitoOficial } from '@/services/remitoOficialConfigService'
import { reportError } from '@/services/observability'
import { describirComprobante, entregarComprobanteVenta } from '@/utils/comprobanteDeVenta'
import { puedeCompartirArchivos } from '@/utils/compartir'
import { formatoARS } from '@/utils/money'
import { STATUS_LABELS } from '@/utils/constants'
import type { CaiRemito } from '@/utils/comprobanteInterno'
import type { Cobranza, Order, UserProfile, VentaCamion, VentaVentanilla } from '@/types'

type Item =
  | { tipo: 'venta';     fecha: Date; venta: VentaCamion }
  | { tipo: 'mostrador'; fecha: Date; venta: VentaVentanilla }
  | { tipo: 'cobranza';  fecha: Date; cobranza: Cobranza }
  | { tipo: 'pedido';    fecha: Date; pedido: Order }

const fechaHora = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const resumenProductos = (p: Array<{ name: string; quantity: number }>) => p.map((x) => `${x.quantity} ${x.name}`).join(', ')

function VentaRow({ venta, cliente, caiRemito }: { venta: VentaCamion; cliente: UserProfile; caiRemito: CaiRemito | null }) {
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')
  const entregar = async () => {
    setOcupado(true)
    try { setAviso(await entregarComprobanteVenta(venta, cliente, caiRemito, puedeCompartirArchivos() ? 'enviar' : 'ver')) }
    finally { setOcupado(false) }
  }
  // Qué papel salió con esta venta: remito (cuenta corriente), factura X
  // (promo) o factura electrónica (contado), con su número — es lo que el
  // supervisor le muestra o le reenvía al cliente.
  const comp = describirComprobante(venta)
  const hayPapel = comp.estado === 'ok'
  return (
    <div className="flex items-start gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900">{venta.canal === 'contado' ? 'Venta contado' : 'Promo'} <span className="text-gray-500">· {fechaHora(venta.fecha.toDate())}</span></p>
        <p className="text-xs text-gray-500 truncate">{venta.items.map((i) => `${i.cantidad} ${i.nombre}`).join(', ')}{venta.choferNombre ? ` · ${venta.choferNombre}` : ''}</p>
        <p className={`text-xs ${hayPapel ? 'text-accent' : 'text-amber-700'}`}>
          {comp.etiqueta}{comp.numero ? ` ${comp.numero}` : ''}{comp.detalle && comp.detalle !== 'CAE ok' ? ` · ${comp.detalle}` : ''}
        </p>
        {aviso && <p className="text-[11px] text-amber-700">{aviso}</p>}
      </div>
      <p className="text-sm font-medium text-gray-900 tabular-nums shrink-0">{formatoARS(venta.total)}</p>
      <button type="button" onClick={entregar} disabled={ocupado} aria-label={`Enviar ${comp.etiqueta}`} title={`Enviar ${comp.etiqueta}`}
        className="w-9 h-9 rounded-lg border border-[#D3D1C7] flex items-center justify-center text-accent shrink-0 active:scale-95 disabled:opacity-50">
        {ocupado ? <RefreshCw size={15} className="animate-spin" /> : <FileText size={15} />}
      </button>
    </div>
  )
}

// Últimos movimientos del cliente: ventas del camión y de mostrador (con el
// comprobante para compartir), cobranzas (con el recibo) y pedidos.
export default function SeccionHistorial({ c }: { c: UserProfile }) {
  const [hist, setHist] = useState<HistorialCliente | null>(null)
  const [pedidos, setPedidos] = useState<Order[]>([])
  const [error, setError] = useState('')
  const [caiRemito, setCaiRemito] = useState<CaiRemito | null>(() => caiRemitoOficialCacheado())

  useEffect(() => { getCaiRemitoOficial().then(setCaiRemito).catch(() => {}) }, [])
  useEffect(() => {
    let vivo = true
    setHist(null)
    getHistorialCliente(c.uid)
      .then((h) => { if (vivo) setHist(h) })
      .catch((err) => { reportError(err, { origen: 'SeccionHistorial', uid: c.uid }); if (vivo) setError('No se pudo cargar el historial.') })
    return () => { vivo = false }
  }, [c.uid])
  useEffect(() => subscribeClientOrders(c.uid, setPedidos), [c.uid])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (const v of hist?.ventasCamion ?? []) out.push({ tipo: 'venta', fecha: v.fecha.toDate(), venta: v })
    for (const v of hist?.ventasVentanilla ?? []) out.push({ tipo: 'mostrador', fecha: v.fecha.toDate(), venta: v })
    for (const cb of hist?.cobranzas ?? []) out.push({ tipo: 'cobranza', fecha: cb.fecha.toDate(), cobranza: cb })
    for (const p of pedidos.slice(0, 20)) out.push({ tipo: 'pedido', fecha: p.createdAt?.toDate?.() ?? p.date.toDate(), pedido: p })
    return out.sort((a, b) => b.fecha.getTime() - a.fecha.getTime()).slice(0, 40)
  }, [hist, pedidos])

  const chip = hist ? <span className="text-xs text-gray-500">{items.length}</span> : null

  return (
    <Plegable titulo="Historial" extra={chip}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!hist && !error && <p className="text-sm text-gray-500">Cargando historial…</p>}
      {hist && items.length === 0 && <p className="text-sm text-gray-500">Sin movimientos registrados en la app.</p>}
      <div className="divide-y divide-gray-100">
        {items.map((it) => {
          if (it.tipo === 'venta') return <VentaRow key={`v-${it.venta.id}`} venta={it.venta} cliente={c} caiRemito={caiRemito} />
          if (it.tipo === 'mostrador') {
            const v = it.venta
            return (
              <div key={`m-${v.id}`} className="flex items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">Mostrador <span className="text-gray-500">· {fechaHora(it.fecha)}</span></p>
                  <p className="text-xs text-gray-500 truncate">{v.items.map((i) => `${i.cantidad} ${i.nombre}`).join(', ')}</p>
                </div>
                <p className="text-sm font-medium text-gray-900 tabular-nums shrink-0">{formatoARS(v.total)}</p>
              </div>
            )
          }
          if (it.tipo === 'cobranza') return <div key={`c-${it.cobranza.id}`} className="py-2"><CobranzaSupervisorCard c={it.cobranza} /></div>
          const p = it.pedido
          return (
            <div key={`p-${p.id}`} className="flex items-start gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">
                  Pedido <span className="text-gray-500">· {fechaHora(it.fecha)}</span>
                  {p.origenSupervisor && <span className="text-amber-700"> · a programar</span>}
                </p>
                <p className="text-xs text-gray-500 truncate">{resumenProductos(p.products)}</p>
              </div>
              <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 border shrink-0 ${p.status === 'entregado' ? 'text-accent border-accent/30 bg-accent/10' : p.status === 'cancelado' ? 'text-gray-500 border-[#D3D1C7]' : 'text-amber-700 border-amber-200 bg-amber-50'}`}>
                {STATUS_LABELS[p.status] ?? p.status}
              </span>
            </div>
          )
        })}
      </div>
    </Plegable>
  )
}
