import { FileText, RefreshCw, Share2 } from 'lucide-react'
import MenuCompartirPdf, { type DatosMail, type PdfGenerado } from '@/components/ui/MenuCompartirPdf'
import { generarComprobanteVenta } from '@/utils/comprobanteDeVenta'
import type { CaiRemito } from '@/utils/comprobanteInterno'
import { getEmailClienteTango } from '@/services/tangoComprobantesService'
import { mailDeVenta } from '@/utils/mailDeVenta'
import type { VentaCamion } from '@/types'

// El comprobante de una venta del camión (factura ARCA, remito o factura X)
// con las tres salidas: WhatsApp, mail al cliente (mail de Tango, resuelto al
// elegir) y descarga (2026-09-10, pedido de un chofer: "la misma opción que
// los supervisores"). Lo usan Mis ventas del chofer y la liquidación.
export default function MenuComprobanteVenta({ venta, cai, compacto = false }: { venta: VentaCamion; cai: CaiRemito | null; compacto?: boolean }) {
  const m = mailDeVenta(venta)
  const titulo = m.presentacion.titulo
  // Mismo mail que el envío automático (utils/mailDeVenta.ts); acá el chofer
  // puede cambiar el destinatario. El server anota el envío en la venta.
  const mail: DatosMail = {
    para: '',
    resolverPara: venta.clienteId ? () => getEmailClienteTango(venta.clienteId) : undefined,
    asunto: m.asunto, mensaje: m.mensaje, comprobante: m.comprobante,
    clienteUid: m.clienteUid, clienteNombre: m.clienteNombre, presentacion: m.presentacion,
    venta: { coleccion: 'ventasCamion', id: venta.id },
  }
  return (
    <MenuCompartirPdf titulo={titulo} texto={`${titulo} — ${venta.clienteNombre}`} mail={mail}
      generar={(): Promise<PdfGenerado> => generarComprobanteVenta(venta, undefined, cai)}
      trigger={(abrir, ocupado) => compacto ? (
        <button type="button" onClick={abrir} disabled={ocupado} aria-label={`Enviar ${titulo}`}
          className="w-9 h-9 shrink-0 rounded-lg border border-[#D3D1C7] flex items-center justify-center text-accent active:scale-95 disabled:opacity-50">
          {ocupado ? <RefreshCw size={15} className="animate-spin" /> : <FileText size={15} />}
        </button>
      ) : (
        <button type="button" onClick={abrir} disabled={ocupado}
          className="flex items-center gap-1.5 rounded-lg bg-[#1D9E75] px-3 py-2 text-sm font-semibold text-white hover:bg-[#178760] disabled:opacity-50">
          {ocupado ? <RefreshCw size={15} className="animate-spin" /> : <Share2 size={15} />}
          {ocupado ? 'Generando…' : 'Enviar o descargar'}
        </button>
      )}
    />
  )
}
