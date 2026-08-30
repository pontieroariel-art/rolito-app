import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus, Printer, Truck } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useFlota } from '../../hooks/useFlota'
import { useChoferes } from '../../hooks/useChoferes'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useFechaDelDia } from '../../hooks/useDiaActual'
import { crearRemitoCarga, palletsInfo, subscribeRemitosCargaDelDia } from '../../services/remitoCargaService'
import { generateRemitoCarga } from '../../utils/pdf'
import { PLANTAS, RemitoCarga, RemitoCargaEstado, RemitoCargaItem } from '../../types'

const ESTADO_LABELS: Record<RemitoCargaEstado, string> = {
  emitido:   'Emitido',
  entregado: 'Entregado',
  salido:    'Salió',
  liquidado: 'Liquidado',
}
const ESTADO_COLORS: Record<RemitoCargaEstado, string> = {
  emitido:   'bg-amber-100 text-amber-700 border-amber-200',
  entregado: 'bg-blue-100 text-blue-700 border-blue-200',
  salido:    'bg-green-100 text-green-700 border-green-200',
  liquidado: 'bg-gray-100 text-gray-600 border-gray-200',
}

// Pantalla principal del rol caja (Fase 1 del módulo expedición): armar el
// remito de carga del camión, imprimirlo para muelle y ver los del día.
export default function RemitosCargaPage() {
  const { user } = useAuth()
  const { camiones } = useFlota()
  const { choferes } = useChoferes()
  const { catalogo } = useCatalogo()

  const plantaId = user?.planta ?? 'torcuato'
  const fecha = useFechaDelDia()

  const [camionId,   setCamionId]   = useState('')
  const [choferId,   setChoferId]   = useState('')
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  // Cuando la cantidad no cierra en pallets justos, caja decide si el resto
  // viaja en un pallet propio (true) o suelto arriba del camión (default).
  const [restoEnPallet, setRestoEnPallet] = useState<Record<string, boolean>>({})
  const [confirmando, setConfirmando] = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')
  const [remitos,     setRemitos]     = useState<RemitoCarga[]>([])

  useEffect(
    () => subscribeRemitosCargaDelDia(plantaId, fecha, setRemitos),
    [plantaId, fecha],
  )

  const camionesActivos = useMemo(() => camiones.filter((c) => c.activo), [camiones])
  const camion = camionesActivos.find((c) => c.id === camionId)
  const chofer = choferes.find((c) => c.uid === choferId)

  // Los pallets NO se cargan a mano: los pallets justos se derivan de las
  // bolsas (floor por producto, con las unidades por pallet del catálogo) y el
  // excedente suma un pallet más solo si caja tilda "va en pallet propio".
  // Cada pallet = 1 base de metal + 4 puntales — en la descarga las bases
  // vuelven completas, parciales o vacías.
  const items: RemitoCargaItem[] = useMemo(
    () => catalogo
      .filter((p) => (cantidades[p.id] ?? 0) > 0)
      .map((p) => {
        const cantidad = cantidades[p.id]
        const info     = palletsInfo(p, cantidad)
        const pallets  = info
          ? info.completos + (info.resto > 0 && restoEnPallet[p.id] ? 1 : 0)
          : 0
        return { productoId: p.id, nombre: p.nombre, cantidad, ...(pallets > 0 ? { pallets } : {}) }
      }),
    [catalogo, cantidades, restoEnPallet],
  )

  const palletsCarga = items.reduce((s, i) => s + (i.pallets ?? 0), 0)

  const setCantidad = (productoId: string, delta: number) =>
    setCantidades((prev) => {
      const next = Math.max(0, Math.min(99999, (prev[productoId] ?? 0) + delta))
      return { ...prev, [productoId]: next }
    })

  const setCantidadInput = (productoId: string, value: string) => {
    const n = Math.max(0, Math.min(99999, parseInt(value.replace(/\D/g, ''), 10) || 0))
    setCantidades((prev) => ({ ...prev, [productoId]: n }))
  }

  const puedeConfirmar = !!camion && !!chofer && items.length > 0

  const imprimir = (r: RemitoCarga) =>
    generateRemitoCarga({
      codigo:       r.codigo,
      plantaId:     r.plantaId,
      camionLabel:  r.camionLabel,
      choferNombre: r.choferNombre,
      items:        r.items,
      palletsCarga: r.palletsCarga,
      creadoPor:    r.creadoPor,
      fecha:        r.fecha.toDate(),
    }).catch((err) => console.error('[remitoCarga] error al generar el PDF:', err))

  const confirmar = async () => {
    if (!user || !camion || !chofer) return
    setGuardando(true)
    setError('')
    try {
      const remito = await crearRemitoCarga(
        {
          camionId:     camion.id,
          camionLabel:  `${camion.patente} · ${camion.modelo}`,
          choferId:     chofer.uid,
          choferNombre: chofer.nombre || chofer.nombreContacto || '',
          items,
          palletsCarga,
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setConfirmando(false)
      setCamionId('')
      setChoferId('')
      setCantidades({})
      setRestoEnPallet({})
      imprimir(remito)
    } catch (err) {
      console.error('[remitoCarga] error al crear:', err)
      setError('No se pudo crear el remito. Revisá la conexión e intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Remitos de carga</h1>
        <p className="text-gray-500 text-sm">{PLANTAS[plantaId].label}</p>
      </div>

      {/* ── Nuevo remito ── */}
      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2"><Truck size={18} className="text-accent" /> Nueva carga</h2>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Camión</label>
            <select value={camionId} onChange={(e) => setCamionId(e.target.value)} className={selectClass}>
              <option value="">Elegir camión…</option>
              {camionesActivos.map((c) => (
                <option key={c.id} value={c.id}>{c.patente} · {c.modelo}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Chofer</label>
            <select value={choferId} onChange={(e) => setChoferId(e.target.value)} className={selectClass}>
              <option value="">Elegir chofer…</option>
              {choferes.map((c) => (
                <option key={c.uid} value={c.uid}>{c.nombre || c.nombreContacto}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-500 mb-2">Mercadería</p>
          <div className="space-y-2">
            {catalogo.map((p) => {
              const info = palletsInfo(p, cantidades[p.id] ?? 0)
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-gray-800">
                      {p.nombre}
                      {info && info.completos > 0 && (
                        <span className="ml-2 text-xs text-accent font-medium">
                          {info.completos + (info.resto > 0 && restoEnPallet[p.id] ? 1 : 0)} pallet{(info.completos + (info.resto > 0 && restoEnPallet[p.id] ? 1 : 0)) > 1 ? 's' : ''}
                        </span>
                      )}
                      {info && info.completos === 0 && info.resto > 0 && restoEnPallet[p.id] && (
                        <span className="ml-2 text-xs text-accent font-medium">1 pallet</span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setCantidad(p.id, -1)}
                        className="w-8 h-8 rounded-lg border border-[#D3D1C7] text-gray-600 flex items-center justify-center hover:bg-gray-50 active:scale-95"
                      ><Minus size={14} /></button>
                      <input
                        value={cantidades[p.id] ?? 0}
                        onChange={(e) => setCantidadInput(p.id, e.target.value)}
                        inputMode="numeric"
                        className="w-16 text-center bg-white border border-[#D3D1C7] rounded-lg py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setCantidad(p.id, +1)}
                        className="w-8 h-8 rounded-lg border border-[#D3D1C7] text-gray-600 flex items-center justify-center hover:bg-gray-50 active:scale-95"
                      ><Plus size={14} /></button>
                    </div>
                  </div>
                  {info && info.resto > 0 && (
                    <label className="flex items-center gap-2 mt-1 ml-3 text-xs text-gray-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={restoEnPallet[p.id] ?? false}
                        onChange={(e) => setRestoEnPallet((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                        className="accent-[#1D9E75]"
                      />
                      {info.resto} suelta{info.resto > 1 ? 's' : ''} — tildá si van en pallet propio
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {palletsCarga > 0 && (
          <div className="bg-accent/5 border border-accent/20 rounded-lg px-3 py-2 flex justify-between items-center">
            <span className="text-sm text-gray-700">Pallets de carga (automático)</span>
            <span className="text-sm font-semibold text-gray-900">
              {palletsCarga} <span className="text-xs text-gray-500 font-normal">({palletsCarga} base{palletsCarga > 1 ? 's' : ''} · {palletsCarga * 4} puntales)</span>
            </span>
          </div>
        )}

        <Button onClick={() => setConfirmando(true)} disabled={!puedeConfirmar} className="w-full">
          Revisar y emitir remito
        </Button>
      </section>

      {/* ── Remitos del día ── */}
      <section className="space-y-2">
        <h2 className="font-semibold text-gray-800">Remitos de hoy</h2>
        {remitos.length === 0 && (
          <p className="text-gray-400 text-sm">Todavía no se emitió ningún remito hoy.</p>
        )}
        {remitos.map((r) => (
          <div key={r.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{r.codigo}</p>
              <p className="text-xs text-gray-500 truncate">
                {r.camionLabel} · {r.choferNombre} · {r.items.reduce((s, i) => s + i.cantidad, 0)} bolsas
              </p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${ESTADO_COLORS[r.estado]}`}>
              {ESTADO_LABELS[r.estado]}
            </span>
            <button
              onClick={() => imprimir(r)}
              title="Reimprimir remito"
              className="text-gray-400 hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10"
            >
              <Printer size={16} />
            </button>
          </div>
        ))}
      </section>

      {/* ── Confirmación ── */}
      {confirmando && (
        <Modal open onClose={() => setConfirmando(false)} title="Confirmar remito de carga">
          <div className="space-y-3">
            <div className="text-sm text-gray-700 space-y-1">
              <p><span className="text-gray-500">Camión:</span> {camion?.patente} · {camion?.modelo}</p>
              <p><span className="text-gray-500">Chofer:</span> {chofer?.nombre || chofer?.nombreContacto}</p>
            </div>
            <div className="border border-[#D3D1C7] rounded-lg divide-y divide-gray-100">
              {items.map((i) => (
                <div key={i.productoId} className="flex justify-between px-3 py-1.5 text-sm">
                  <span className="text-gray-700">
                    {i.nombre}
                    {i.pallets ? <span className="ml-2 text-xs text-gray-400">{i.pallets} pallet{i.pallets > 1 ? 's' : ''}</span> : null}
                  </span>
                  <span className="font-medium text-gray-900">{i.cantidad}</span>
                </div>
              ))}
              {palletsCarga > 0 && (
                <div className="flex justify-between px-3 py-1.5 text-sm bg-gray-50">
                  <span className="text-gray-700">Pallets de carga</span>
                  <span className="font-medium text-gray-900">{palletsCarga}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Al confirmar se asigna el número correlativo y se imprime el remito para muelle.
            </p>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <p className="text-red-500 text-sm">{error}</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmar} loading={guardando} className="flex-1">Emitir e imprimir</Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}
