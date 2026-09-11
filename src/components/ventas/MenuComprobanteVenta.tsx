import { FileText, RefreshCw, Share2 } from 'lucide-react'
import MenuCompartirPdf, { type DatosMail, type PdfGenerado } from '@/components/ui/MenuCompartirPdf'
import { describirComprobante, generarComprobanteVenta } from '@/utils/comprobanteDeVenta'
import type { CaiRemito } from '@/utils/comprobanteInterno'
import { getEmailClienteTango } from '@/services/tangoComprobantesService'
import { formatoARS } from '@/utils/money'
import type { VentaCamion } from '@/types'

// El comprobante de una venta del camión (factura ARCA, remito o factura X)
// con las tres salidas: WhatsApp, mail al cliente (mail de Tango, resuelto al
// elegir) y descarga (2026-09-10, pedido de un chofer: "la misma opción que
// los supervisores"). Lo usan Mis ventas del chofer y la liquidación.
export default function MenuComprobanteVenta({ venta, cai, compacto = false }: { venta: VentaCamion; cai: CaiRemito | null; compacto?: boolean }) {
  const d = describirComprobante(venta)
  const titulo = `${d.etiqueta}${d.numero ? ` ${d.numero}` : ''}`
  const fecha = venta.fecha.toDate().toLocaleDateString('es-AR')
  // El importe va solo en las facturas (ARCA o X): el remito es un documento
  // de entrega y su mail no lleva plata (pedido de Ariel, 2026-09-11).
  const esFactura = d.etiqueta.startsWith('Factura')
  const mail: DatosMail = {
    para: '',
    resolverPara: venta.clienteId ? () => getEmailClienteTango(venta.clienteId) : undefined,
    asunto: `${titulo} — ${venta.clienteNombre}`,
    mensaje: `Te enviamos adjunto el comprobante de la entrega del ${fecha}.`,
    comprobante: { tipo: d.etiqueta, numero: d.numero || venta.id },
    clienteUid: venta.clienteId || undefined,
    clienteNombre: venta.clienteNombre,
    presentacion: {
      titulo, emoji: d.etiqueta.startsWith('Factura') ? '🧾' : '🚚',
      filas: [
        { label: 'Fecha', value: fecha },
        ...(esFactura ? [{ label: 'Importe', value: formatoARS(venta.total) }] : []),
        ...(venta.items.length ? [{ label: 'Detalle', value: venta.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ').slice(0, 200) }] : []),
      ],
    },
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
