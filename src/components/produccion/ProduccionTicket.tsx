import { PalletProduccion } from '../../types'
import { PLANTA_INFO } from '../../utils/constants'
import { PRODUCTOS_HIELO } from '../../utils/produccionCatalogo'

// Ticket 100x150mm para Zebra — tamaño definido en index.css (@page
// produccion-ticket), acá solo se dibuja el contenido. Tamaño físico
// pendiente de calibrar contra el rollo real en planta (ver comentario en
// index.css). Reusa el patrón de ZebraLabel.tsx (heladeras): componente puro,
// QR/barcode ya generados por quien llama.
export default function ProduccionTicket({
  pallet, qrDataUrl, barcodeDataUrl,
}: {
  pallet: PalletProduccion
  qrDataUrl: string
  barcodeDataUrl: string
}) {
  const planta   = PLANTA_INFO[pallet.plantaId]
  const producto = PRODUCTOS_HIELO[pallet.productoId]
  const fecha    = pallet.fechaFabricacion.toDate()

  // Mismo criterio que la grilla de carga: la palabra distintiva en grande
  // (cuatro productos comparten "10KG" y en la cámara se identifica por
  // PICADO/ESCAMA/CEMENTERA), con el peso al lado cuando no es redundante.
  const tamanioLinea = producto.etiquetaGrilla === producto.tamanioTicket
    ? producto.tamanioTicket
    : `${producto.etiquetaGrilla} · ${producto.tamanioTicket}`

  return (
    <div className="produccion-ticket-page w-[100mm] h-[150mm] p-[4mm] flex flex-col items-center justify-between text-black bg-white box-border">
      <img src="/logo-rolito.png" alt="Rolito" className="h-[14mm] object-contain" />

      <p className="font-bold text-[7mm] leading-tight text-center">
        {tamanioLinea}
      </p>

      <div className="text-center text-[2.6mm] leading-snug">
        <p>HORA FAB.: {fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
        <p>FECHA FAB.: {fecha.toLocaleDateString('es-AR')}</p>
        <p className="font-semibold">{pallet.operador.nombre}</p>
      </div>

      <div className="text-center text-[2.4mm] leading-snug">
        <p className="font-bold">{planta.razonSocial}</p>
        <p>{planta.direccion}</p>
        <p>{planta.localidad}</p>
        <p>Tel.: {planta.telefono}</p>
      </div>

      <img src={qrDataUrl} alt="QR" className="w-[24mm] h-[24mm]" />
      <img src={barcodeDataUrl} alt="Código de barra" className="w-[80mm] h-[16mm] object-contain" />

      <p className="text-center text-[2.6mm] font-semibold">{pallet.codigo}</p>
      <p className="text-center text-[2.6mm] leading-snug">{producto.descripcionTicket}</p>
    </div>
  )
}
