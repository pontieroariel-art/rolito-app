import { useEffect, useMemo, useState } from 'react'
import { WifiOff, Package, Snowflake } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ProduccionTicket from '../../components/produccion/ProduccionTicket'
import { useAuth } from '../../context/AuthContext'
import { useOnline } from '../../hooks/useOnline'
import { useProduccionPallets } from '../../hooks/useProduccionPallets'
import { crearPallet } from '../../services/produccionService'
import { asegurarReserva, ReservaAgotadaError, SinNumerosDisponiblesOfflineError } from '../../services/produccionReservaService'
import { ProduccionCounterNoInicializadoError } from '../../services/produccionCounterService'
import { generateQrDataUrl } from '../../utils/qr'
import { generateBarcodeDataUrl } from '../../utils/barcode'
import { PRODUCTOS_HIELO, PRODUCTOS_HIELO_LIST, ProductoHieloDef } from '../../utils/produccionCatalogo'
import { PLANTAS, ProductoHieloId, PalletProduccion } from '../../types'

function esHoy(fecha: Date): boolean {
  const hoy = new Date()
  return fecha.toDateString() === hoy.toDateString()
}

interface TicketData { pallet: PalletProduccion; qrDataUrl: string; barcodeDataUrl: string }

function ConfirmarPalletModal({
  producto, onCancel, onConfirm, loading,
}: { producto: ProductoHieloDef; onCancel: () => void; onConfirm: () => void; loading: boolean }) {
  return (
    <Modal open onClose={onCancel} title="Confirmar pallet">
      <div className="space-y-4">
        <div
          className="flex flex-col items-center gap-1.5 rounded-2xl border-[3px] py-5"
          style={{ borderColor: producto.color, backgroundColor: `${producto.color}14` }}
        >
          <span className="text-4xl font-black leading-none" style={{ color: producto.color }}>{producto.tamanioTicket}</span>
          <span className="text-lg font-bold text-gray-900 text-center px-3">{producto.nombre}</span>
          <span className="text-sm text-gray-500 font-medium">{producto.unidadesPorPallet} {producto.unidadLabel}/pallet</span>
        </div>
        <p className="text-xs text-gray-400 text-center">Esta acción imprime el ticket y no se puede deshacer.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1" disabled={loading}>Cancelar</Button>
          <Button onClick={onConfirm} loading={loading} className="flex-1">Confirmar e imprimir</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function ProduccionDashboard() {
  const { user } = useAuth()
  const online = useOnline()
  const { pallets, loading } = useProduccionPallets(user?.planta)
  const [reservaLista, setReservaLista] = useState(false)
  const [error, setError] = useState('')
  const [productoSeleccionado, setProductoSeleccionado] = useState<ProductoHieloId | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [ticketData, setTicketData] = useState<TicketData | null>(null)

  const pallettsHoy = useMemo(
    () => pallets.filter((p) => esHoy(p.fechaFabricacion.toDate())).slice(0, 10),
    [pallets],
  )

  useEffect(() => {
    if (!user?.uid || !user.planta) return
    setError('')
    asegurarReserva(user.uid, user.planta, online)
      .then(() => setReservaLista(true))
      .catch((err) => {
        setReservaLista(false)
        if (err instanceof SinNumerosDisponiblesOfflineError) {
          setError('Sin conexión y sin números disponibles. Reconectate para seguir cargando.')
        } else if (err instanceof ProduccionCounterNoInicializadoError) {
          setError(err.message)
        } else {
          setError('No se pudo preparar la numeración. Reintentá en unos segundos.')
        }
      })
  }, [user?.uid, user?.planta, online])

  // Dispara la impresión apenas hay un ticket listo (QR/barcode ya generados)
  // — no navega a ningún lado, imprime la pestaña actual con el ticket
  // renderizado (oculto) y el resto de la página escondida vía CSS de
  // impresión (ver el wrapper "print:hidden" más abajo).
  useEffect(() => {
    if (!ticketData) return
    const id = setTimeout(() => window.print(), 300)
    return () => clearTimeout(id)
  }, [ticketData])

  // Limpia el ticket apenas se cierra el diálogo de impresión (se haya
  // impreso o cancelado) — deja la pantalla lista para el próximo pallet.
  useEffect(() => {
    const limpiar = () => setTicketData(null)
    window.addEventListener('afterprint', limpiar)
    return () => window.removeEventListener('afterprint', limpiar)
  }, [])

  if (!user) return <LoadingSpinner fullScreen />

  if (!user.planta) {
    return (
      <>
        <Navbar />
        <main className="max-w-lg mx-auto p-6">
          <p className="text-red-500 text-sm">Tu cuenta no tiene una planta asignada. Contactá al administrador.</p>
        </main>
      </>
    )
  }

  const handleConfirmar = async () => {
    if (!productoSeleccionado || !user.planta) return
    setConfirmando(true)
    try {
      const { pallet } = crearPallet({ plantaId: user.planta, productoId: productoSeleccionado }, { uid: user.uid, nombre: user.nombre }, online)
      const qrDataUrl = await generateQrDataUrl(pallet.codigo)
      const barcodeDataUrl = generateBarcodeDataUrl(pallet.codigo)
      setTicketData({ pallet, qrDataUrl, barcodeDataUrl })
      setProductoSeleccionado(null)
    } catch (err) {
      if (err instanceof ReservaAgotadaError) {
        setReservaLista(false)
        setError('Se agotaron los números reservados. Esperá a que vuelva la conexión.')
      } else {
        setError('No se pudo cargar el pallet. Intentá de nuevo.')
      }
    } finally {
      setConfirmando(false)
    }
  }

  return (
    <>
      <div className="min-h-screen bg-[#F8F7F2] text-gray-900 print:hidden">
        <Navbar />
        <main className="p-4 sm:p-6 space-y-6 pb-10">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Hola, {user.nombre?.split(' ')[0] ?? 'operario'}</h1>
              <p className="text-gray-500 text-base">{PLANTAS[user.planta].label}</p>
            </div>
            {!online && (
              <div className="flex items-center gap-1.5 text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
                <WifiOff size={16} /> Sin conexión
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
              <p className="text-red-500 text-base font-medium">{error}</p>
            </div>
          )}

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-3">Pallet completo — elegí el producto</h2>
            {/* Grilla grande, a pantalla completa: esto lo usan operarios con
                guantes/apuro embolsando hielo — cada tarjeta tiene que
                reconocerse de un vistazo (color + tamaño en grande), nunca
                solo por texto chico. El color nunca es el único identificador
                (siempre va con el nombre completo abajo). */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {PRODUCTOS_HIELO_LIST.map((p) => (
                <button
                  key={p.id}
                  disabled={!reservaLista}
                  onClick={() => setProductoSeleccionado(p.id)}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-[3px] p-4 aspect-square sm:aspect-[4/3] transition-transform active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none disabled:grayscale"
                  style={{ borderColor: p.color, backgroundColor: `${p.color}14` }}
                >
                  <Snowflake size={22} style={{ color: p.color }} />
                  <span className="text-4xl sm:text-5xl font-black leading-none" style={{ color: p.color }}>
                    {p.tamanioTicket}
                  </span>
                  <span className="text-lg sm:text-xl font-bold text-gray-900 text-center leading-tight">
                    {p.nombre}
                  </span>
                  <span className="text-sm sm:text-base text-gray-500 font-medium">
                    {p.unidadesPorPallet} {p.unidadLabel}/pallet
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">Cargados hoy</h2>
            {loading ? (
              <LoadingSpinner />
            ) : pallettsHoy.length === 0 ? (
              <div className="bg-white border border-[#D3D1C7] rounded-xl p-6 text-center">
                <Package className="mx-auto text-gray-300 mb-2" size={24} />
                <p className="text-gray-500 text-sm">Todavía no cargaste ningún pallet hoy.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {pallettsHoy.map((p) => (
                  <div key={p.id} className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
                    <p className="text-sm text-gray-700">{p.codigo} — {p.productoNombre}</p>
                    <span className="text-sm text-gray-400 shrink-0">
                      {p.fechaFabricacion.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {productoSeleccionado && (
        <ConfirmarPalletModal
          producto={PRODUCTOS_HIELO[productoSeleccionado]}
          onCancel={() => setProductoSeleccionado(null)}
          onConfirm={handleConfirmar}
          loading={confirmando}
        />
      )}

      {/* Oculto en pantalla, es lo único visible al imprimir (ver print:hidden arriba) */}
      {ticketData && (
        <div className="hidden print:block produccion-ticket-page">
          <ProduccionTicket pallet={ticketData.pallet} qrDataUrl={ticketData.qrDataUrl} barcodeDataUrl={ticketData.barcodeDataUrl} />
        </div>
      )}
    </>
  )
}
