import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ZebraLabel from '../../components/heladeras/ZebraLabel'
import { getHeladera } from '../../services/heladeraService'
import { generateQrDataUrl } from '../../utils/qr'
import { generateBarcodeDataUrl } from '../../utils/barcode'
import { Heladera } from '../../types'

// Página dedicada, sin Navbar: se abre en una pestaña nueva desde el detalle
// de la heladera solo para imprimir la etiqueta y se cierra (@page 100x100mm
// definido en index.css). Espera a tener el QR generado antes de imprimir —
// si dispara window.print() antes, la etiqueta sale sin el código.
export default function EtiquetaHeladeraPage() {
  const { heladeraId } = useParams<{ heladeraId: string }>()
  const [heladera, setHeladera] = useState<Heladera | null | undefined>(undefined)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [barcodeDataUrl, setBarcodeDataUrl] = useState('')

  useEffect(() => {
    if (!heladeraId) return
    getHeladera(heladeraId).then(async (h) => {
      setHeladera(h)
      if (h) {
        setQrDataUrl(await generateQrDataUrl(`${window.location.origin}/heladeras/ficha/${h.id}`))
        setBarcodeDataUrl(generateBarcodeDataUrl(h.numeroSerie))
      }
    })
  }, [heladeraId])

  useEffect(() => {
    if (heladera && qrDataUrl && barcodeDataUrl) {
      const id = setTimeout(() => window.print(), 300)
      return () => clearTimeout(id)
    }
  }, [heladera, qrDataUrl, barcodeDataUrl])

  if (heladera === undefined) return <LoadingSpinner fullScreen />
  if (heladera === null) return <p className="p-6 text-sm text-gray-500">No se encontró la heladera.</p>

  return <ZebraLabel heladera={heladera} qrDataUrl={qrDataUrl} barcodeDataUrl={barcodeDataUrl} />
}
