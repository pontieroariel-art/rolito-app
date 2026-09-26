import { PalletProduccion } from '../../types'
import { armarEtiquetaPallet, ETIQUETA_PALLET, type Forma } from '../../utils/etiquetaPallet'

// Ticket de respaldo del pallet, cuando no hay Zebra conectada por Bluetooth
// y la impresión pasa por el diálogo de Android. Desde el 2026-09-25 dibuja
// en SVG el MISMO modelo que la etiqueta ZPL (utils/etiquetaPallet.ts: una
// banda por producto), así la de respaldo y la de la Zebra son iguales.
// Tamaño de página en index.css (@page produccion-ticket), igual al rollo.

/** Inter/Arial en negrita son más anchas que la fuente de la Zebra: una mayúscula ~0,72 del alto. */
const ANCHO_LETRA_NAVEGADOR = 0.72

function FormaSvg({ f, qrDataUrl, barcodeDataUrl }: { f: Forma; qrDataUrl: string; barcodeDataUrl: string }) {
  switch (f.t) {
    case 'rect':
      return f.borde
        ? <rect x={f.x + f.borde / 2} y={f.y + f.borde / 2} width={f.w - f.borde} height={f.h - f.borde} fill="none" stroke="black" strokeWidth={f.borde} />
        : <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="black" />
    case 'circulo':
      return <circle cx={f.x + f.d / 2} cy={f.y + f.d / 2} r={f.d / 2} fill="black" />
    case 'diagonal':
      return <polygon fill="black" points={`${f.x},${f.y + f.h} ${f.x + f.grosor},${f.y + f.h} ${f.x + f.w},${f.y} ${f.x + f.w - f.grosor},${f.y}`} />
    case 'texto': {
      // Si en la fuente del navegador no entra, se comprime al ancho de la caja.
      const estimado = f.texto.length * f.alto * ANCHO_LETRA_NAVEGADOR
      const comprimir = estimado > f.ancho
      return (
        <text
          x={f.x + f.ancho / 2} y={f.y + f.alto * 0.82}
          fontSize={f.alto} fontWeight={800} textAnchor="middle"
          fontFamily="Inter, Arial, sans-serif"
          fill={f.blanco ? 'white' : 'black'}
          {...(comprimir ? { textLength: f.ancho * 0.98, lengthAdjust: 'spacingAndGlyphs' as const } : {})}
        >
          {f.texto}
        </text>
      )
    }
    case 'qr':
      return qrDataUrl ? <image href={qrDataUrl} x={f.x} y={f.y} width={f.lado} height={f.lado} /> : null
    case 'barras':
      return barcodeDataUrl ? <image href={barcodeDataUrl} x={f.x} y={f.y} width={f.w} height={f.h} preserveAspectRatio="none" /> : null
  }
}

export default function ProduccionTicket({
  pallet, qrDataUrl, barcodeDataUrl,
}: {
  pallet: PalletProduccion
  qrDataUrl: string
  barcodeDataUrl: string
}) {
  const { tamanio, formas } = armarEtiquetaPallet(pallet, ETIQUETA_PALLET)
  const { anchoMm: W, altoMm: H } = tamanio
  return (
    <div className="produccion-ticket-page bg-white" style={{ width: `${W}mm`, height: `${H}mm` }}>
      <svg
        width={`${W}mm`} height={`${H}mm`} viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact', display: 'block' }}
      >
        {formas.map((f, i) => <FormaSvg key={i} f={f} qrDataUrl={qrDataUrl} barcodeDataUrl={barcodeDataUrl} />)}
      </svg>
    </div>
  )
}
