import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ProduccionTicket from '../../components/produccion/ProduccionTicket'
import { getPalletProduccion } from '../../services/produccionService'
import { generateQrDataUrl } from '../../utils/qr'
import { generateBarcodeDataUrl } from '../../utils/barcode'
import { PalletProduccion } from '../../types'

// Página dedicada, sin Navbar, para REIMPRIMIR un pallet ya cargado (deep
// link, ej. desde la ficha en /produccion/ficha/:id). El flujo normal de
// carga (ProduccionDashboard.tsx) ya no pasa por acá — imprime en la propia
// pestaña sin navegar a ningún lado.
export default function ProduccionTicketPage() {
  const { palletId } = useParams<{ palletId: string }>()
  const [pallet, setPallet] = useState<PalletProduccion | null | undefined>(undefined)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [barcodeDataUrl, setBarcodeDataUrl] = useState('')

  useEffect(() => {
    if (!palletId) return
    getPalletProduccion(palletId).then(setPallet)
  }, [palletId])

  useEffect(() => {
    if (!pallet) return
    setQrDataUrl('')
    generateQrDataUrl(pallet.codigo).then(setQrDataUrl)
    setBarcodeDataUrl(generateBarcodeDataUrl(pallet.codigo))
  }, [pallet])

  useEffect(() => {
    if (pallet && qrDataUrl && barcodeDataUrl) {
      const id = setTimeout(() => window.print(), 300)
      return () => clearTimeout(id)
    }
  }, [pallet, qrDataUrl, barcodeDataUrl])

  if (pallet === undefined) return <LoadingSpinner fullScreen />
  if (pallet === null) return <p className="p-6 text-sm text-gray-500">No se encontró el pallet.</p>

  return <ProduccionTicket pallet={pallet} qrDataUrl={qrDataUrl} barcodeDataUrl={barcodeDataUrl} />
}
