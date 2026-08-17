import { useMemo, useState, lazy, Suspense } from 'react'
import { Camera, Plus, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
// Lazy: trae @zxing/browser (cámara + decoder), el chunk más pesado de la
// app entera — solo hace falta si el usuario realmente toca "Escanear".
const BarcodeScanner = lazy(() => import('../../components/heladeras/BarcodeScanner'))
import KpiTile from '../../components/heladeras/KpiTile'
import { useAuth } from '../../context/AuthContext'
import { usePanolArticulos } from '../../hooks/usePanolArticulos'
import { usePanolMovimientos } from '../../hooks/usePanolMovimientos'
import { useTecnicos } from '../../hooks/useTecnicos'
import {
  crearArticulo, registrarEntrega, registrarRecepcion,
  Actor, StockInsuficienteError,
} from '../../services/panolService'
import { generateListadoPdf } from '../../utils/pdf'
import { PanolArticulo, PanolMovimientoArticulo } from '../../types'
import { tsToDate } from '../../utils/helpers'

// ── Alta de artículo ─────────────────────────────────────────────────────────

function NuevoArticuloModal({ onClose }: { onClose: () => void }) {
  const [nombre, setNombre] = useState('')
  const [codigoBarras, setCodigoBarras] = useState('')
  const [unidad, setUnidad] = useState('unidad')
  const [stockMinimo, setStockMinimo] = useState('0')
  const [stockMaximo, setStockMaximo] = useState('0')
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!nombre.trim() || !codigoBarras.trim()) { setError('Completá nombre y código de barra'); return }
    setSaving(true)
    setError('')
    try {
      await crearArticulo({
        nombre: nombre.trim(), codigoBarras: codigoBarras.trim(), unidad,
        stockMinimo: Number(stockMinimo) || 0, stockMaximo: Number(stockMaximo) || 0,
      })
      onClose()
    } catch {
      setError('No se pudo crear el artículo. Intentá de nuevo.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nuevo artículo">
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Nombre</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Código de barra</label>
          <div className="flex gap-2">
            <input value={codigoBarras} onChange={(e) => setCodigoBarras(e.target.value)} className="flex-1 bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent" />
            <button type="button" onClick={() => setScanning(true)} className="px-3 rounded-lg border border-[#D3D1C7] hover:border-accent transition-colors">
              <Camera size={16} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Unidad</label>
            <input value={unidad} onChange={(e) => setUnidad(e.target.value)} className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-2 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Mínimo</label>
            <input type="number" min={0} value={stockMinimo} onChange={(e) => setStockMinimo(e.target.value)} className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-2 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Máximo</label>
            <input type="number" min={0} value={stockMaximo} onChange={(e) => setStockMaximo(e.target.value)} className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-2 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} className="flex-1">Crear</Button>
        </div>
      </div>

      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner
            onDetected={(codigo) => { setCodigoBarras(codigo); setScanning(false) }}
            onClose={() => setScanning(false)}
          />
        </Suspense>
      )}
    </Modal>
  )
}

// ── Carrito de artículos (compartido entre entrega y recepción) ──────────────

function useCarrito(articulos: PanolArticulo[]) {
  const [items, setItems] = useState<PanolMovimientoArticulo[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')

  const agregarPorCodigo = (codigo: string) => {
    const art = articulos.find((a) => a.codigoBarras === codigo)
    if (!art) { setError(`No se encontró ningún artículo con el código "${codigo}".`); return }
    setItems((prev) => {
      const ya = prev.find((i) => i.articuloId === art.id)
      if (ya) return prev.map((i) => (i.articuloId === art.id ? { ...i, cantidad: i.cantidad + 1 } : i))
      return [...prev, { articuloId: art.id, nombre: art.nombre, cantidad: 1 }]
    })
    setError('')
  }

  const setCantidad = (articuloId: string, cantidad: number) =>
    setItems((prev) => prev.map((i) => (i.articuloId === articuloId ? { ...i, cantidad: Math.max(1, cantidad) } : i)))

  const quitar = (articuloId: string) => setItems((prev) => prev.filter((i) => i.articuloId !== articuloId))

  return { items, setItems, scanning, setScanning, error, setError, agregarPorCodigo, setCantidad, quitar }
}

function CarritoUI({ carrito, articulos }: { carrito: ReturnType<typeof useCarrito>; articulos: PanolArticulo[] }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => carrito.setScanning(true)}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm py-2 rounded-lg border border-[#D3D1C7] hover:border-accent transition-colors"
        >
          <Camera size={14} /> Escanear artículo
        </button>
        <select
          onChange={(e) => { if (e.target.value) { carrito.agregarPorCodigo(articulos.find((a) => a.id === e.target.value)?.codigoBarras ?? ''); e.target.value = '' } }}
          className="flex-1 bg-white border border-[#D3D1C7] rounded-lg px-2 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">O elegí manualmente…</option>
          {articulos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </div>

      {carrito.error && <p className="text-red-500 text-xs">{carrito.error}</p>}

      {carrito.items.length > 0 && (
        <div className="border border-[#D3D1C7] rounded-lg divide-y divide-gray-100">
          {carrito.items.map((i) => (
            <div key={i.articuloId} className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1 text-sm text-gray-900">{i.nombre}</span>
              <input
                type="number" min={1} value={i.cantidad}
                onChange={(e) => carrito.setCantidad(i.articuloId, Number(e.target.value) || 1)}
                className="w-16 bg-[#F8F7F2] border border-[#D3D1C7] rounded px-2 py-1 text-sm text-right"
              />
              <button onClick={() => carrito.quitar(i.articuloId)} className="text-gray-400 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {carrito.scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner onDetected={(codigo) => { carrito.agregarPorCodigo(codigo); carrito.setScanning(false) }} onClose={() => carrito.setScanning(false)} />
        </Suspense>
      )}
    </div>
  )
}

// ── Entrega a técnico ─────────────────────────────────────────────────────────

function EntregaModal({ articulos, actor, onClose }: { articulos: PanolArticulo[]; actor: Actor; onClose: () => void }) {
  const { tecnicos } = useTecnicos()
  const carrito = useCarrito(articulos)
  const [tecnicoId, setTecnicoId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const activos = useMemo(() => tecnicos.filter((t) => t.estado === 'activo'), [tecnicos])

  const handleSubmit = async () => {
    const tecnico = activos.find((t) => t.uid === tecnicoId)
    if (!tecnico) { setError('Elegí a quién se le entrega'); return }
    if (carrito.items.length === 0) { setError('Agregá al menos un artículo'); return }
    setSaving(true)
    setError('')
    try {
      await registrarEntrega(carrito.items, { uid: tecnico.uid, nombre: tecnico.nombre, rol: 'tecnico' }, actor)
      await generateListadoPdf(
        'Entrega de pañol',
        ['Artículo', 'Cantidad'],
        carrito.items.map((i) => [i.nombre, i.cantidad]),
        `${tecnico.nombre} · ${new Date().toLocaleString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      )
      onClose()
    } catch (err) {
      setError(err instanceof StockInsuficienteError ? err.message : 'No se pudo registrar la entrega.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nueva entrega" wide>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Técnico</label>
          <select value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)} className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent">
            <option value="">Elegí un técnico…</option>
            {activos.map((t) => <option key={t.uid} value={t.uid}>{t.nombre}</option>)}
          </select>
        </div>
        <CarritoUI carrito={carrito} articulos={articulos} />
        <p className="text-xs text-gray-400">El técnico confirma la recepción con su firma desde su panel.</p>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} className="flex-1">Registrar entrega</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Recepción de mercadería ───────────────────────────────────────────────────

function RecepcionModal({ articulos, actor, onClose }: { articulos: PanolArticulo[]; actor: Actor; onClose: () => void }) {
  const carrito = useCarrito(articulos)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (carrito.items.length === 0) { setError('Agregá al menos un artículo'); return }
    setSaving(true)
    setError('')
    try {
      await registrarRecepcion(carrito.items, actor)
      onClose()
    } catch {
      setError('No se pudo registrar la recepción.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nueva recepción" wide>
      <div className="space-y-4">
        <CarritoUI carrito={carrito} articulos={articulos} />
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} className="flex-1">Registrar recepción</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function PanolPage() {
  const { user } = useAuth()
  const { articulos, loading: loadingArticulos } = usePanolArticulos()
  const { movimientos, loading: loadingMovimientos } = usePanolMovimientos()
  const [nuevoArticulo, setNuevoArticulo] = useState(false)
  const [entrega, setEntrega] = useState(false)
  const [recepcion, setRecepcion] = useState(false)

  const actor: Actor | null = user ? { uid: user.uid, nombre: user.nombre } : null

  // Bajo stock arriba de todo — no hay que escanear la tabla entera para
  // encontrar lo que hay que reponer.
  const articulosOrdenados = useMemo(
    () => [...articulos].sort((a, b) => Number(b.stockActual < b.stockMinimo) - Number(a.stockActual < a.stockMinimo)),
    [articulos],
  )
  const bajoStockCount = articulos.filter((a) => a.stockActual < a.stockMinimo).length

  if (loadingArticulos || loadingMovimientos) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pañol</h1>
            <p className="text-gray-500 text-sm">{articulos.length} artículos</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="text-sm" onClick={() => setRecepcion(true)}>Recepción</Button>
            <Button className="text-sm" onClick={() => setEntrega(true)}>Entrega</Button>
          </div>
        </div>

        {bajoStockCount > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <KpiTile value={bajoStockCount} label="Bajo stock mínimo" tone="warn" active={false} onClick={() => {}} />
          </div>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Artículos</h2>
          <button onClick={() => setNuevoArticulo(true)} className="flex items-center gap-1 text-xs text-accent hover:underline">
            <Plus size={13} /> Nuevo artículo
          </button>
        </div>

        {articulos.length === 0 ? (
          <p className="text-gray-400 text-sm">Todavía no cargaste ningún artículo.</p>
        ) : (
          <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-[#D3D1C7] bg-[#F8F7F2]">
                  <th className="text-left text-gray-500 text-xs py-2.5 px-4 font-medium">Artículo</th>
                  <th className="text-right text-gray-500 text-xs py-2.5 px-4 font-medium">Stock</th>
                  <th className="text-right text-gray-500 text-xs py-2.5 px-4 font-medium">Mín / Máx</th>
                </tr>
              </thead>
              <tbody>
                {articulosOrdenados.map((a) => {
                  const bajo = a.stockActual < a.stockMinimo
                  const sobre = a.stockMaximo > 0 && a.stockActual > a.stockMaximo
                  return (
                    <tr key={a.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="py-2 px-4 text-gray-900">{a.nombre}<span className="text-gray-400 text-xs ml-1">({a.unidad})</span></td>
                      <td className={`py-2 px-4 text-right font-medium ${bajo ? 'text-amber-600' : sobre ? 'text-blue-600' : 'text-gray-700'}`}>
                        {a.stockActual}{bajo && ' ⚠'}{sobre && ' ▲'}
                      </td>
                      <td className="py-2 px-4 text-right text-gray-400 text-xs">{a.stockMinimo} / {a.stockMaximo}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {movimientos.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-900">Movimientos recientes</h2>
            <div className="space-y-1.5">
              {movimientos.slice(0, 15).map((m) => (
                <div key={m.id} className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-gray-900">
                      {m.tipo === 'entrega' ? `Entrega a ${m.destinatario?.nombre ?? '—'}` : 'Recepción'}
                    </p>
                    <p className="text-xs text-gray-500">{m.articulos.map((a) => `${a.cantidad}x ${a.nombre}`).join(', ')}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">{tsToDate(m.fecha).toLocaleDateString('es-AR')}</p>
                    {m.tipo === 'entrega' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
                        m.confirmado ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'
                      }`}>
                        {m.confirmado ? 'Confirmada' : 'Sin confirmar'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {nuevoArticulo && <NuevoArticuloModal onClose={() => setNuevoArticulo(false)} />}
      {entrega && actor && <EntregaModal articulos={articulos} actor={actor} onClose={() => setEntrega(false)} />}
      {recepcion && actor && <RecepcionModal articulos={articulos} actor={actor} onClose={() => setRecepcion(false)} />}
    </div>
  )
}
