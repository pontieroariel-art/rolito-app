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
          <span className="text-4xl font-black leading-none" style={{ color: producto.color }}>{producto.etiquetaGrilla}</span>
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
      <div className="h-dvh flex flex-col overflow-hidden bg-[#F8F7F2] text-gray-900 print:hidden">
        <Navbar />
        {/* Todo lo de acá abajo tiene que entrar SIN scrollear en una tablet
            chica en vertical (Galaxy Tab A11 de 8,7", 1340x800 — encargado
            de embolsar hielo, no puede estar scrolleando para encontrar el
            producto). flex-1 min-h-0 + una grilla de filas 1fr es lo que
            garantiza esto sin depender de adivinar los px exactos del
            dispositivo. */}
        <main className="flex-1 min-h-0 flex flex-col p-2.5 gap-2 overflow-hidden">
          <div className="flex items-center justify-between shrink-0">
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">Hola, {user.nombre?.split(' ')[0] ?? 'operario'}</h1>
              <p className="text-gray-500 text-xs">{PLANTAS[user.planta].label}</p>
            </div>
            {/* Indicador de sin conexión — el flujo es offline-first (reserva de
                números offline), pero el operario tiene que saber de un vistazo
                que está desconectado; los pallets se siguen cargando contra la
                reserva hasta que se agota. */}
            {!online && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/40 px-2.5 py-1 text-amber-700 text-xs font-semibold">
                <WifiOff size={14} /> Sin conexión
              </span>
            )}
          </div>

          {error && (
            <div className="shrink-0 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-1.5">
              <p className="text-red-500 text-xs font-medium leading-snug">{error}</p>
            </div>
          )}

          {/* Grilla de productos — ocupa todo el espacio que sobra. Color
              categórico (paleta validada anti-daltonismo) + tamaño enorme
              para reconocer de un vistazo con guantes/apuro; el color nunca
              es el único identificador, siempre va con el nombre completo. */}
          <div
            className="flex-1 min-h-0 grid grid-cols-2 gap-2"
            style={{ gridTemplateRows: `repeat(${Math.ceil(PRODUCTOS_HIELO_LIST.length / 2)}, minmax(0, 1fr))` }}
          >
            {PRODUCTOS_HIELO_LIST.map((p, i) => (
              <button
                key={p.id}
                disabled={!reservaLista}
                onClick={() => setProductoSeleccionado(p.id)}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-xl border-[3px] transition-transform active:scale-[0.97] disabled:opacity-60 disabled:pointer-events-none ${
                  // El último ocupa las 2 columnas solo si la cuenta es impar
                  // (si no, quedaría una fila con un solo item descentrado).
                  i === PRODUCTOS_HIELO_LIST.length - 1 && PRODUCTOS_HIELO_LIST.length % 2 === 1 ? 'col-span-2' : ''
                }`}
                style={{ borderColor: p.color, backgroundColor: `${p.color}14` }}
              >
                <Snowflake size={16} style={{ color: p.color }} />
                <span className="text-[clamp(1.1rem,5.5vh,2.5rem)] font-black leading-none" style={{ color: p.color }}>
                  {p.etiquetaGrilla}
                </span>
                <span className="text-[clamp(0.7rem,2.1vh,1.05rem)] font-bold text-gray-900 text-center leading-tight px-1">
                  {p.nombre}
                </span>
                <span className="text-[clamp(0.55rem,1.5vh,0.8rem)] text-gray-500 font-medium">
                  {p.unidadesPorPallet} {p.unidadLabel}/pallet
                </span>
              </button>
            ))}
          </div>

          {/* Resumen compacto de una sola línea — a propósito NO es una
              lista (eso obligaría a scrollear si hay muchos pallets hoy). */}
          <div className="shrink-0 bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 flex items-center justify-between gap-2">
            {loading ? (
              <span className="text-xs text-gray-400">Cargando...</span>
            ) : pallettsHoy.length === 0 ? (
              <span className="text-xs text-gray-400 flex items-center gap-1.5"><Package size={14} className="text-gray-300" /> Todavía no cargaste ningún pallet hoy.</span>
            ) : (
              <>
                <span className="text-xs text-gray-600 font-medium">
                  Hoy: <span className="text-gray-900 font-bold">{pallettsHoy.length}</span> pallet{pallettsHoy.length !== 1 ? 's' : ''} cargado{pallettsHoy.length !== 1 ? 's' : ''}
                </span>
                <span className="text-xs text-gray-400 truncate">
                  último: {pallettsHoy[0].productoNombre} — {pallettsHoy[0].fechaFabricacion.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </>
            )}
          </div>
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
