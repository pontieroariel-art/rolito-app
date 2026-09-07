import { useState } from 'react'
import { FileDown, Share2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import { compartirArchivo, descargarArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { reportError } from '@/services/observability'

// Par "Enviar / Descargar" de un PDF, el mismo patrón que el recibo del
// supervisor: en el celular abre WhatsApp, mail, etc.; en una compu descarga.
export default function BotonesVerEnviar({ generar, nombreArchivo, titulo, texto, compacto = false, etiquetaEnviar = 'Enviar', etiquetaVer = 'Descargar' }: {
  generar:        () => Promise<Blob>
  nombreArchivo:  string
  titulo:         string
  texto?:         string
  compacto?:      boolean
  etiquetaEnviar?: string
  etiquetaVer?:    string
}) {
  const [ocupado, setOcupado] = useState<'ver' | 'enviar' | null>(null)
  const [aviso, setAviso] = useState('')

  const correr = async (modo: 'ver' | 'enviar') => {
    setOcupado(modo)
    setAviso('')
    try {
      const blob = await generar()
      if (modo === 'ver') { descargarArchivo(blob, nombreArchivo); return }
      const r = await compartirArchivo(blob, nombreArchivo, { titulo, texto })
      if (r === 'descargado') setAviso('Este dispositivo no puede compartir archivos: se descargó el PDF.')
    } catch (err) {
      reportError(err, { origen: 'BotonesVerEnviar', archivo: nombreArchivo })
      setAviso('No se pudo generar el PDF. Probá de nuevo.')
    } finally {
      setOcupado(null)
    }
  }

  const clase = compacto ? 'text-xs py-1.5 px-3' : 'flex-1'
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Button onClick={() => correr('enviar')} loading={ocupado === 'enviar'} disabled={ocupado !== null} className={clase}>
          <Share2 size={14} className="mr-1.5" /> {puedeCompartirArchivos() ? etiquetaEnviar : etiquetaVer}
        </Button>
        <Button variant="outline" onClick={() => correr('ver')} loading={ocupado === 'ver'} disabled={ocupado !== null} className={clase}>
          <FileDown size={14} className="mr-1.5" /> {etiquetaVer}
        </Button>
      </div>
      {aviso && <p className="text-xs text-gray-500">{aviso}</p>}
    </div>
  )
}
