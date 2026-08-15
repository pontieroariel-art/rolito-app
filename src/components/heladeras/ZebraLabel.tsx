import { Heladera } from '../../types'
import { ROLITO_INFO } from '../../utils/constants'

// Etiqueta 100x100mm para Zebra ZD421. El tamaño de página real lo define
// EtiquetaHeladeraPage con @page — este componente solo dibuja el contenido.
// El QR (generado por quien llama, ver EtiquetaHeladeraPage) apunta a la
// ficha en vivo de la heladera, no a datos fijos: así, cuando la reasignen
// a otro cliente, escanear la misma etiqueta siempre muestra el estado
// actual en vez de quedar desactualizada.
export default function ZebraLabel({ heladera, qrDataUrl }: { heladera: Heladera; qrDataUrl: string }) {
  return (
    <div className="w-[100mm] h-[100mm] p-[3mm] flex flex-col items-center justify-between text-black bg-white box-border">
      <img src="/logo-rolito.png" alt="Rolito" className="h-[13mm] object-contain" />

      <div className="text-center space-y-[1mm]">
        <p className="font-bold text-[3.2mm] leading-tight">{ROLITO_INFO.razonSocial}</p>
        <p className="text-[2.6mm] leading-tight">{heladera.modelo}</p>
      </div>

      <div className="text-center text-[2.2mm] leading-snug">
        <p>{ROLITO_INFO.direccion}</p>
        <p>{ROLITO_INFO.localidad} · CP {ROLITO_INFO.cp}</p>
        <p>Tel. {ROLITO_INFO.telefono}</p>
      </div>

      <div className="text-center text-[2.2mm] leading-snug">
        <p>INPUT AC 240V 50-60HZ</p>
        <p>HECHO EN ARGENTINA</p>
      </div>

      <div className="flex items-center gap-[3mm]">
        <img src={qrDataUrl} alt="QR" className="w-[20mm] h-[20mm]" />
        <div className="text-left text-[2.4mm] leading-snug">
          <p className="font-bold">N° SERIE</p>
          <p>{heladera.numeroSerie}</p>
          <p className="text-gray-500 mt-[1mm]">Escaneá para ver la ficha</p>
        </div>
      </div>
    </div>
  )
}
