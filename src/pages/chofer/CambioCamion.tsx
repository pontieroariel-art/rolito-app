import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Repeat } from 'lucide-react'
import ChoferHeader from '../../components/chofer/ChoferHeader'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ClienteCombobox, { toComboItems } from '../../components/ui/ClienteCombobox'
import { useAuth } from '../../context/AuthContext'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useRemitosCargaChofer } from '../../hooks/useRemitosCargaChofer'
import { crearCambioCamion } from '../../services/cambioCamionService'

// Cambio de producto defectuoso: el cliente entrega una bolsa rota y el chofer
// se la cambia por una nueva — sin venta ni plata. La rota vuelve en el camión
// y muelle la cuenta en la descarga; la liquidación cruza ambas puntas.
export default function CambioCamion() {
  const { user } = useAuth()
  const { clientes, loading: loadingClientes } = useClientesActivos()
  const { catalogo } = useCatalogo()
  const { remitos: remitosCarga } = useRemitosCargaChofer()

  const camionIdHoy = remitosCarga[0]?.camionId ?? user?.camionId

  const [clienteId,  setClienteId]  = useState('')
  const [productoId, setProductoId] = useState('')
  const [cantidad,   setCantidad]   = useState(1)
  const [confirmando, setConfirmando] = useState(false)
  const [exito, setExito] = useState<{ cliente: string; detalle: string } | null>(null)
  const [error, setError] = useState('')

  const cliente  = useMemo(() => clientes.find((c) => c.uid === clienteId), [clientes, clienteId])
  const producto = catalogo.find((p) => p.id === productoId)

  const abrirConfirmacion = () => {
    setError('')
    if (!camionIdHoy)  { setError('No tenés un camión asignado. Avisá a logística.'); return }
    if (!cliente)      { setError('Elegí el cliente.'); return }
    if (!producto)     { setError('Elegí el producto que cambiás.'); return }
    if (cantidad < 1)  { setError('La cantidad tiene que ser al menos 1.'); return }
    setConfirmando(true)
  }

  const confirmar = () => {
    if (!user || !camionIdHoy || !cliente || !producto) return
    try {
      crearCambioCamion(
        {
          clienteId:     cliente.uid,
          clienteNombre: cliente.razonSocial || cliente.nombre,
          productoId:    producto.id,
          nombre:        producto.nombre,
          cantidad,
        },
        { uid: user.uid, nombre: user.nombre, camionId: camionIdHoy },
      )
      setExito({ cliente: cliente.razonSocial || cliente.nombre, detalle: `${cantidad} × ${producto.nombre}` })
      setClienteId('')
      setProductoId('')
      setCantidad(1)
      setConfirmando(false)
    } catch {
      setError('No se pudo registrar el cambio. Intentá de nuevo.')
      setConfirmando(false)
    }
  }

  if (loadingClientes) return <LoadingSpinner fullScreen />

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  if (exito) {
    return (
      <div className="min-h-screen bg-[#F8F7F2]">
        <ChoferHeader title="Cambio" back />
        <main className="max-w-md mx-auto p-4 pt-10 text-center space-y-4">
          <CheckCircle2 size={48} className="text-accent mx-auto" />
          <div>
            <p className="text-lg font-semibold text-gray-900">Cambio registrado</p>
            <p className="text-sm text-gray-600 mt-1">{exito.detalle} — {exito.cliente}</p>
            <p className="text-xs text-gray-500 mt-2">Acordate de guardar la bolsa rota: se entrega a muelle al volver.</p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => setExito(null)} className="w-full">Registrar otro cambio</Button>
            <Link to="/chofer" className="text-sm text-gray-500 hover:text-accent">Volver al inicio</Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8F7F2]">
      <ChoferHeader title="Cambio" back />
      <main className="max-w-md mx-auto p-4 space-y-4 pb-10">
        <div className="flex items-center gap-2 text-gray-700">
          <Repeat size={18} className="text-accent" />
          <p className="text-sm">Bolsa defectuosa del cliente por una nueva — sin cargo.</p>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Cliente</label>
          <ClienteCombobox
            items={toComboItems(clientes)}
            value={clienteId}
            onChange={setClienteId}
            placeholder="Buscar cliente…"
          />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Producto</label>
          <select value={productoId} onChange={(e) => setProductoId(e.target.value)} className={selectClass}>
            <option value="">Elegir producto…</option>
            {catalogo.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
          <input
            value={cantidad}
            onChange={(e) => setCantidad(Math.max(0, Math.min(999, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)))}
            inputMode="numeric"
            className={selectClass}
          />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        <Button onClick={abrirConfirmacion} className="w-full">Registrar cambio</Button>

        {confirmando && cliente && producto && (
          <Modal open onClose={() => setConfirmando(false)} title="Confirmar cambio">
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                Cambiás <span className="font-semibold">{cantidad} × {producto.nombre}</span> a{' '}
                <span className="font-semibold">{cliente.razonSocial || cliente.nombre}</span>, sin cargo.
              </p>
              <p className="text-xs text-gray-500">
                La bolsa rota viaja en el camión y se entrega a muelle — en la liquidación tiene que cuadrar con este registro.
              </p>
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
