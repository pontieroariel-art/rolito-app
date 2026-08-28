import { Heladera } from '../../types'
import { ROLITO_INFO } from '../../utils/constants'

// Etiqueta 100x100mm para Zebra ZD421 (térmica, B&N). El tamaño de página real
// lo define EtiquetaHeladeraPage con @page — este componente solo dibuja el
// contenido. El logo va en su versión B&N (`/logo-rolito-bn.png`: negro con los
// blancos internos preservados) para que imprima nítido en la térmica en vez de
// salir gris. El QR (generado por quien llama) apunta a la ficha en vivo de la
// heladera, no a datos fijos: así, cuando la reasignen a otro cliente, escanear
// la misma etiqueta siempre muestra el estado actual en vez de quedar
// desactualizada. El código de barra codifica el N° de serie.
export default function ZebraLabel({
  heladera,
  qrDataUrl,
  barcodeDataUrl,
}: {
  heladera: Heladera
  qrDataUrl: string
  barcodeDataUrl: string
}) {
  return (
    <div className="w-[100mm] h-[100mm] flex flex-col text-black bg-white box-border overflow-hidden">
      {/* Logo protagonista — grande y a lo ancho para leerse de lejos */}
      <div className="text-center pt-[3mm] pb-[1.5mm] px-[4mm]">
        <img
          src="/logo-rolito-bn.png"
          alt="Rolito"
          className="w-[86mm] max-w-full h-auto object-contain mx-auto"
        />
      </div>

      {/* Banda NO REMOVER */}
      <div className="bg-black text-white text-center font-extrabold tracking-[1mm] text-[3mm] py-[1mm]">
        NO REMOVER
      </div>

      {/* Serie destacada */}
      <div className="flex items-baseline justify-between px-[4mm] pt-[2mm] pb-[0.5mm]">
        <span className="text-[2mm] font-extrabold tracking-widest uppercase">Serie N°</span>
        <span className="font-mono font-black text-[6.5mm] leading-none tracking-wide">
          {heladera.numeroSerie}
        </span>
      </div>

      {/* QR + datos */}
      <div className="flex items-center gap-[3mm] px-[4mm] py-[1mm] flex-1">
        <img src={qrDataUrl} alt="QR" className="w-[21mm] h-[21mm] border border-black shrink-0" />
        <div className="text-[2.2mm] leading-snug flex-1">
          <p>Modelo <b>{heladera.modelo}</b> · Input AC 240V 50-60Hz</p>
          <p>Hecho en Argentina</p>
          <p className="font-extrabold mt-[1mm]">{ROLITO_INFO.razonSocial}</p>
          <p>{ROLITO_INFO.direccion} · {ROLITO_INFO.localidad}</p>
          <p>(CP {ROLITO_INFO.cp}) Bs. As. · Tel. {ROLITO_INFO.telefono}</p>
        </div>
      </div>

      {/* Código de barra (N° de serie) */}
      <div className="px-[4mm] pb-[3mm]">
        <img src={barcodeDataUrl} alt="Código de barra" className="w-full h-[9mm] object-contain" />
      </div>
    </div>
  )
}
