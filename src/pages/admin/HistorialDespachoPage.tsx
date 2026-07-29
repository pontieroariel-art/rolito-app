import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Truck, ChevronDown, ChevronUp, Download } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { orderDateStr } from '../../hooks/useDespachoBoard'
import { subscribeDespachosByFecha, formatDespachoFecha } from '../../services/despachoService'
import { toDateStr, todayString, addDaysStr, tsToDate, initials, summarizeProducts } from '../../utils/helpers'
import { generateHistorialDespachoPdf, HistorialDespachoRow } from '../../utils/pdf'
import { Order, Despacho } from '../../types'

type Resultado = 'entregado' | 'reprogramado' | 'cancelado' | 'pendiente'

const RESULTADO_LABEL: Record<Resultado, string> = {
  entregado:    'Entregado',
  reprogramado: 'No entregado',
  cancelado:    'Cancelado',
  pendiente:    'Pendiente',
}

const RESULTADO_STYLE: Record<Resultado, string> = {
  entregado:    'text-accent border-accent/20 bg-accent/5',
  reprogramado: 'text-amber-600 border-amber-200 bg-amber-50',
  cancelado:    'text-red-600 border-red-200 bg-red-50',
  pendiente:    'text-gray-500 border-gray-200 bg-gray-50',
}

interface HistorialItem {
  order:     Order
  resultado: Resultado
}

interface ChoferGroup {
  key:      string   // driverId (email) o 'sin_asignar'
  nombre:   string
  camion:   string | null
  status:   Despacho['status'] | null   // null = nunca se confirmó despacho ese día
  horaSalida?: string
  items:    HistorialItem[]
}

// Un pedido "pertenece" al día `fecha` si su fecha de entrega vigente es esa
// (resultado según status actual), o si fue reprogramado FUERA de ese día
// (fechaOriginal === fecha → cuenta como "no entregado" para el chofer que
// lo tenía). `fechaOriginal` se sobreescribe en cada reprogramación, así que
// un pedido reprogramado más de una vez solo queda trazable en su último salto.
function buildRows(g: ChoferGroup): HistorialDespachoRow[] {
  return g.items.map(({ order, resultado }) => ({
    chofer:    g.nombre,
    camion:    g.camion,
    cliente:   order.clientName,
    direccion: order.clientAddress,
    resultado: RESULTADO_LABEL[resultado],
    motivo:    resultado === 'reprogramado' ? order.motivoReprogramacion
             : resultado === 'cancelado'    ? order.motivoCancelacion
             : undefined,
  }))
}

function groupStats(g: ChoferGroup) {
  return {
    total:        g.items.length,
    entregados:   g.items.filter((i) => i.resultado === 'entregado').length,
    noEntregados: g.items.filter((i) => i.resultado === 'reprogramado' || i.resultado === 'cancelado').length,
  }
}

function resultadoYChofer(o: Order, fecha: string): { resultado: Resultado; choferKey: string } | null {
  if (orderDateStr(o) === fecha) {
    const resultado: Resultado =
      o.status === 'entregado' ? 'entregado' :
      o.status === 'cancelado' ? 'cancelado' : 'pendiente'
    return { resultado, choferKey: o.driverId ?? 'sin_asignar' }
  }
  if (o.fechaOriginal && toDateStr(tsToDate(o.fechaOriginal)) === fecha) {
    return { resultado: 'reprogramado', choferKey: o.choferOriginal ?? 'sin_asignar' }
  }
  return null
}

export default function HistorialDespachoPage() {
  const { orders, loading } = useAllOrders()
  const { choferes }        = useChoferes()
  const [fecha, setFecha]   = useState(() => addDaysStr(todayString(), -1))
  const [despachos, setDespachos] = useState<Despacho[]>([])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfLoadingKey, setPdfLoadingKey] = useState<string | null>(null)

  useEffect(() => subscribeDespachosByFecha(fecha, setDespachos), [fecha])

  const grupos = useMemo(() => {
    const byChofer = new Map<string, HistorialItem[]>()
    for (const o of orders) {
      const r = resultadoYChofer(o, fecha)
      if (!r) continue
      if (!byChofer.has(r.choferKey)) byChofer.set(r.choferKey, [])
      byChofer.get(r.choferKey)!.push({ order: o, resultado: r.resultado })
    }

    const despachoByChofer = new Map(despachos.map((d) => [d.driverId, d]))
    const keys = new Set([...byChofer.keys(), ...despachos.map((d) => d.driverId)])
    keys.delete('sin_asignar')

    const result: ChoferGroup[] = [...keys].map((key) => {
      const desp   = despachoByChofer.get(key)
      const chofer = choferes.find((c) => c.email === key)
      return {
        key,
        nombre: desp?.driverName || chofer?.nombreContacto || chofer?.nombre || key,
        camion: desp?.camionLabel ?? null,
        status: desp?.status ?? null,
        horaSalida: desp?.horaSalida,
        items: (byChofer.get(key) ?? []).sort((a, b) => a.order.clientName.localeCompare(b.order.clientName)),
      }
    }).sort((a, b) => a.nombre.localeCompare(b.nombre))

    const sinAsignar = byChofer.get('sin_asignar') ?? []
    if (sinAsignar.length > 0) {
      result.push({
        key: 'sin_asignar', nombre: 'Sin asignar', camion: null, status: null,
        items: sinAsignar.sort((a, b) => a.order.clientName.localeCompare(b.order.clientName)),
      })
    }
    return result
  }, [orders, despachos, choferes, fecha])

  const stats = useMemo(() => {
    const all = grupos.flatMap((g) => g.items)
    return {
      total:        all.length,
      entregados:   all.filter((i) => i.resultado === 'entregado').length,
      noEntregados: all.filter((i) => i.resultado === 'reprogramado' || i.resultado === 'cancelado').length,
    }
  }, [grupos])
  const pctCumplimiento = stats.total > 0 ? Math.round((stats.entregados / stats.total) * 100) : 0

  const handlePdf = async () => {
    setPdfLoading(true)
    try {
      const rows = grupos.flatMap(buildRows)
      await generateHistorialDespachoPdf(rows, formatDespachoFecha(fecha), fecha, stats)
    } finally {
      setPdfLoading(false)
    }
  }

  const handleChoferPdf = async (g: ChoferGroup) => {
    setPdfLoadingKey(g.key)
    try {
      await generateHistorialDespachoPdf(
        buildRows(g), formatDespachoFecha(fecha), fecha, groupStats(g),
        { chofer: g.nombre, camion: g.camion },
      )
    } finally {
      setPdfLoadingKey(null)
    }
  }

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">

        <div className="flex flex-wrap justify-between items-end gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Historial de despacho</h1>
            <p className="text-gray-500 text-sm mt-1">Qué chofer salió cada día y qué terminó entregando</p>
          </div>
          <button
            onClick={handlePdf}
            disabled={pdfLoading || grupos.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D3D1C7] bg-white text-xs font-semibold text-gray-600 hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:hover:border-[#D3D1C7] disabled:hover:text-gray-600"
          >
            <Download size={14} />
            {pdfLoading ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>

        {/* Selector de día */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFecha((f) => addDaysStr(f, -1))}
            className="p-1.5 rounded-lg border border-[#D3D1C7] bg-white hover:border-accent text-gray-500 hover:text-accent transition-colors"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => setFecha(addDaysStr(todayString(), -1))}
            className="px-3 py-1.5 rounded-lg border border-[#D3D1C7] bg-white text-xs font-semibold text-gray-600 hover:border-accent hover:text-accent transition-colors"
          >
            Ayer
          </button>
          <div className="flex-1 flex items-center justify-center gap-2">
            <span className="text-sm font-medium text-gray-900 capitalize">{formatDespachoFecha(fecha)}</span>
            <input
              type="date"
              value={fecha}
              max={todayString()}
              onChange={(e) => setFecha(e.target.value)}
              className="bg-white border border-[#D3D1C7] rounded-lg px-2 py-1 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <button
            onClick={() => setFecha((f) => addDaysStr(f, 1))}
            disabled={fecha >= todayString()}
            className="p-1.5 rounded-lg border border-[#D3D1C7] bg-white hover:border-accent text-gray-500 hover:text-accent transition-colors disabled:opacity-30 disabled:hover:border-[#D3D1C7] disabled:hover:text-gray-500"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-500">Total pedidos</p>
            <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-500">Entregados</p>
            <p className="text-3xl font-bold text-accent">{stats.entregados}</p>
            <p className="text-xs text-gray-500">{pctCumplimiento}% cumplimiento</p>
          </div>
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-500">No entregados</p>
            <p className="text-3xl font-bold text-amber-600">{stats.noEntregados}</p>
          </div>
        </div>

        {/* Grupos por chofer */}
        {grupos.length === 0 ? (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-10 text-center">
            <Truck className="mx-auto mb-3 text-gray-300" size={32} />
            <p className="text-gray-500 text-sm">Sin despachos registrados este día</p>
          </div>
        ) : (
          <div className="space-y-3">
            {grupos.map((g) => (
              <ChoferCard
                key={g.key}
                grupo={g}
                open={openKey === g.key}
                onToggle={() => setOpenKey((k) => k === g.key ? null : g.key)}
                onDownloadPdf={() => handleChoferPdf(g)}
                pdfLoading={pdfLoadingKey === g.key}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function ChoferCard({ grupo, open, onToggle, onDownloadPdf, pdfLoading }: {
  grupo: ChoferGroup
  open: boolean
  onToggle: () => void
  onDownloadPdf: () => void
  pdfLoading: boolean
}) {
  const entregados = grupo.items.filter((i) => i.resultado === 'entregado').length
  const total = grupo.items.length
  const pct = total > 0 ? Math.round((entregados / total) * 100) : 0

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
      <div className="w-full flex items-center gap-3 p-4">
        <button onClick={onToggle} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          {grupo.key === 'sin_asignar' ? (
            <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center shrink-0 text-gray-500">
              <Truck size={16} />
            </div>
          ) : (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold"
              style={{ backgroundColor: '#1D9E75' }}
            >
              {initials(grupo.nombre)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm text-gray-900">{grupo.nombre}</p>
              {grupo.camion && <span className="text-xs text-gray-500">{grupo.camion}</span>}
              {grupo.status === 'confirmado' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full border text-accent border-accent/20 bg-accent/5 font-medium">Confirmado</span>
              )}
              {grupo.status === 'borrador' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full border text-gray-500 border-gray-200 bg-gray-50 font-medium">Borrador</span>
              )}
              {grupo.status === null && grupo.key !== 'sin_asignar' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full border text-red-600 border-red-200 bg-red-50 font-medium">Sin confirmar</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="h-1 w-24 bg-gray-200 rounded-full overflow-hidden shrink-0">
                <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-gray-500">{entregados}/{total} entregados{grupo.horaSalida ? ` · salió ${grupo.horaSalida}` : ''}</span>
            </div>
          </div>
        </button>

        <button
          onClick={onDownloadPdf}
          disabled={pdfLoading || total === 0}
          title="Descargar PDF de este despacho"
          className="p-1.5 rounded-lg border border-[#D3D1C7] bg-white hover:border-accent text-gray-400 hover:text-accent transition-colors disabled:opacity-30 disabled:hover:border-[#D3D1C7] disabled:hover:text-gray-400 shrink-0"
        >
          <Download size={14} />
        </button>

        <button onClick={onToggle} className="shrink-0 text-gray-400">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-[#D3D1C7] divide-y divide-[#EDEBE3]">
          {grupo.items.length === 0 ? (
            <p className="text-xs text-gray-400 p-4">Sin pedidos</p>
          ) : (
            grupo.items.map(({ order, resultado }) => (
              <div key={order.id} className="p-3 flex flex-wrap gap-2 justify-between items-start">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900">{order.clientName}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${RESULTADO_STYLE[resultado]}`}>
                      {RESULTADO_LABEL[resultado]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{order.clientAddress}</p>
                  {resultado === 'entregado' && order.productosEntregados ? (
                    <>
                      <p className="text-xs text-gray-500">
                        Descargado: <span className="text-gray-900">{summarizeProducts(order.productosEntregados)}</span>
                      </p>
                      {order.entregaParcial && (
                        <p className="text-xs text-amber-600">Pedido original: {summarizeProducts(order.products)}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-gray-500">{summarizeProducts(order.products)}</p>
                  )}
                  {resultado === 'reprogramado' && order.motivoReprogramacion && (
                    <p className="text-xs text-gray-500">Motivo: <span className="text-gray-900">{order.motivoReprogramacion}</span></p>
                  )}
                  {resultado === 'cancelado' && order.motivoCancelacion && (
                    <p className="text-xs text-gray-500">Motivo: <span className="text-gray-900">{order.motivoCancelacion}</span></p>
                  )}
                </div>
                {order.horaEntrega && resultado === 'entregado' && (
                  <span className="text-xs text-gray-500 shrink-0">{order.horaEntrega}</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
