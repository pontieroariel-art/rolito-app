import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import Modal from '../ui/Modal'

// Escanea UN código y cierra — para agregar artículos de a uno a una lista
// (entrega/recepción del pañol). Usa la cámara trasera del celular por
// defecto (facingMode: environment, sin pedir deviceId).
export default function BarcodeScanner({ onDetected, onClose }: { onDetected: (codigo: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    const reader = new BrowserMultiFormatReader()

    const detener = () => {
      const video = videoRef.current
      const stream = video?.srcObject as MediaStream | null
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
    }

    reader.decodeOnceFromVideoDevice(undefined, videoRef.current ?? undefined)
      .then((result) => {
        if (cancelado) return
        onDetected(result.getText())
        detener()
      })
      .catch(() => {
        if (!cancelado) setError('No se pudo acceder a la cámara. Revisá los permisos.')
      })

    return () => { cancelado = true; detener() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal open onClose={onClose} title="Escanear código de barra">
      <div className="space-y-3">
        <div className="rounded-lg overflow-hidden bg-black aspect-square">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        </div>
        {error ? (
          <p className="text-red-500 text-xs">{error}</p>
        ) : (
          <p className="text-xs text-gray-500">Apuntá la cámara al código de barra del artículo.</p>
        )}
        <button
          onClick={onClose}
          className="w-full text-sm py-2 rounded-lg border border-[#D3D1C7] text-gray-600 hover:border-accent transition-colors"
        >
          Cancelar
        </button>
      </div>
    </Modal>
  )
}
