import { PalletProduccion } from '../../types'
import { PLANTA_INFO } from '../../utils/constants'
import { PRODUCTOS_HIELO } from '../../utils/produccionCatalogo'
import { bandaDeProducto } from '../../utils/zplPallet'

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

  // Banda negra con la palabra del producto en blanco, lo más grande que
  // entre (2026-09-25): en la cámara de frío el pallet se reconoce de lejos.
  // Misma cuenta que la etiqueta ZPL de la Zebra (zplPallet.bandaDeProducto).
  const banda = bandaDeProducto(pallet.productoId, 92)
  // Inter en negrita es más ancha que la fuente de la Zebra: una mayúscula
  // ocupa ~0,72 del tamaño de fuente. Tope de 26 mm para que la banda de 40 respire.
  const tamanioFuenteMm = Math.min(26, 88 / (banda.palabra.length * 0.72))

  return (
    <div className="produccion-ticket-page w-[100mm] h-[150mm] pb-[4mm] flex flex-col items-center justify-between text-black bg-white box-border">
      <div
        className="w-full h-[40mm] bg-black text-white flex flex-col items-center justify-center"
        style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
      >
        <p className="font-black leading-none text-center whitespace-nowrap" style={{ fontSize: `${tamanioFuenteMm}mm` }}>
          {banda.palabra}
        </p>
        {banda.subtitulo && <p className="font-bold text-[8mm] leading-none mt-[2mm]">{banda.subtitulo}</p>}
      </div>

      <img src="/logo-rolito.png" alt="Rolito" className="h-[9mm] object-contain" />

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
