// Las ventas que hizo el chofer, con la factura de cada una.
//
// Existe por un motivo concreto: hasta ahora la app emitía la factura
// electrónica y el chofer no tenía forma de dársela al cliente. Acá la ve y la
// manda por WhatsApp o mail desde el mismo teléfono, sin esperar al mail que
// Tango envía por su cuenta.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileText, Share2, Download, Clock, AlertTriangle } from 'lucide-react'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { useAuth } from '@/context/AuthContext'
import { useClientesActivos } from '@/hooks/useClientesActivos'
import { subscribeVentasRecientesChofer } from '@/services/ventaCamionService'
import { generateFacturaArcaPdf } from '@/utils/facturaArcaPdf'
import { armarFacturaDeVenta } from '@/utils/facturaDeVenta'
import { armarComprobanteInterno, tipoComprobanteInterno } from '@/utils/comprobanteInterno'
import { generateComprobanteInternoPdf } from '@/utils/comprobanteInternoPdf'
import { codigoComprobanteInterno } from '@/services/numeracionInternaService'
import { compartirArchivo, descargarArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { VentaCamion } from '@/types'

const money = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const nroFactura = (v: VentaCamion) =>
  v.factura
    ? `${String(v.factura.puntoVenta).padStart(5, '0')}-${String(v.factura.numero).padStart(8, '0')}`
    : ''

export default function VentasChofer() {
  const { user } = useAuth()
  const { clientes } = useClientesActivos()
  const [ventas, setVentas] = useState<VentaCamion[] | null>(null)
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const [fallo, setFallo] = useState(false)
  const [pendientes, setPendientes] = useState(0)

  const compartible = useMemo(() => puedeCompartirArchivos(), [])

  useEffect(() => {
    if (!user) return
    setFallo(false)
    return subscribeVentasRecientesChofer(user.uid, setVentas, () => setFallo(true), setPendientes)
  }, [user])

  const clientePorId = useMemo(
    () => new Map(clientes.map((c) => [c.uid, c])),
    [clientes],
  )

  // Genera el comprobante de la venta —la factura de ARCA, o el remito /
  // factura X interna cuando no factura ARCA— y lo comparte o descarga.
  const entregarComprobante = async (venta: VentaCamion, compartir: boolean) => {
    setAviso('')
    const cliente = clientePorId.get(venta.clienteId)
    const tipoInterno = tipoComprobanteInterno(venta)

    let blob: Blob
    let nombre: string
    let titulo: string
    setOcupada(venta.id)
    try {
      if (tipoInterno) {
        const armado = armarComprobanteInterno(venta, cliente)
        if (!armado.ok) { setAviso(armado.motivo); return }
        blob = (await generateComprobanteInternoPdf(armado.datos, { descargar: false })) as Blob
        nombre = armado.datos.archivo
        titulo = `${armado.datos.titulo === 'REMITO' ? 'Remito' : 'Factura X'} ${armado.datos.numero ?? 'sin número'}`
      } else {
        const armado = armarFacturaDeVenta(venta, cliente)
        if (!armado.ok) { setAviso(armado.motivo); return }
        blob = (await generateFacturaArcaPdf(armado.datos)) as Blob
        nombre = `factura-${nroFactura(venta)}.pdf`
        titulo = `Factura ${nroFactura(venta)}`
      }
      if (compartir) {
        const r = await compartirArchivo(blob, nombre, { titulo, texto: `${titulo} — ${venta.clienteNombre}` })
        if (r === 'descargado') setAviso('Este dispositivo no puede compartir archivos: se descargó.')
      } else {
        descargarArchivo(blob, nombre)
      }
    } catch {
      setAviso('No se pudo generar el comprobante. Probá de nuevo.')
    } finally {
      setOcupada(null)
    }
  }

  if (!user || ventas === null) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2]">
      <header className="flex items-center gap-3 bg-gradient-to-b from-[#1a6b52] to-[#1D9E75] px-4 py-4 text-white">
        <Link to="/chofer" className="rounded-full bg-white/20 p-2" aria-label="Volver">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-lg font-bold leading-tight">Mis ventas</h1>
          <p className="text-xs text-white/80">Entregá el comprobante al cliente</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl p-4">
        {aviso && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>
        )}

        {/* Ventas hechas sin señal que todavía no llegaron al servidor. Caja no
            las ve: si el chofer rinde antes de que suban, la liquidación sale
            sin ellas. Se suben solas al recuperar señal. */}
        {pendientes > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            <Clock size={16} className="mt-0.5 shrink-0" />
            <p className="text-sm">
              <span className="font-semibold">
                {pendientes === 1 ? '1 venta todavía no subió' : `${pendientes} ventas todavía no subieron`}
              </span>
              {' '}al servidor. Se suben solas cuando haya señal. No rindas en caja hasta que desaparezca este aviso.
            </p>
          </div>
        )}

        {ventas.length === 0 && (
          fallo ? (
            // Decir 'no hay ventas' cuando en realidad no se pudieron leer es
            // peor que no decir nada: el chofer se va sin entregar una factura
            // que sí existe.
            <div className="mt-10 rounded-lg border border-red-300 bg-red-50 p-3 text-center">
              <p className="text-sm font-semibold text-red-800">No se pudieron cargar tus ventas</p>
              <p className="mt-1 text-xs text-red-700">
                Puede ser la conexión. Probá de nuevo en un momento; si sigue igual, avisá a la oficina.
              </p>
            </div>
          ) : (
            <p className="mt-10 text-center text-sm text-gray-400">Todavía no cargaste ninguna venta.</p>
          )
        )}

        <div className="flex flex-col gap-2.5">
          {ventas.map((v) => {
            const f = v.factura
            const emitida = f?.estado === 'emitida' && !!f.cae

            return (
              <article key={v.id} className="rounded-xl border border-[#E4E2D9] bg-white p-4 shadow-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-gray-800">{v.clienteNombre}</span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-gray-900">
                    ${money(v.total)}
                  </span>
                </div>

                <p className="mt-0.5 text-xs text-gray-500">
                  {v.fecha.toDate().toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                  {' · '}
                  {v.canal === 'contado' ? 'Venta contado' : 'Promo'}
                  {v.items.length > 0 && ` · ${v.items.length} ${v.items.length === 1 ? 'producto' : 'productos'}`}
                </p>

                {/* Contado efectivo/transferencia: factura de ARCA. El resto
                    (cuenta corriente, promo, solo cambios): remito o factura X
                    interna, que sale en el momento. */}
                {tipoComprobanteInterno(v) === null ? (
                  <div className="mt-3 border-t border-[#F2F1EA] pt-3">
                    {emitida ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-auto font-mono text-xs text-gray-600">
                          Factura {nroFactura(v)}
                        </span>
                        <button
                          type="button"
                          disabled={ocupada === v.id}
                          onClick={() => entregarComprobante(v,true)}
                          className="flex items-center gap-1.5 rounded-lg bg-[#1D9E75] px-3 py-2 text-sm font-semibold text-white hover:bg-[#178760] disabled:opacity-50"
                        >
                          <Share2 size={15} />
                          {ocupada === v.id ? 'Generando…' : compartible ? 'Enviar' : 'Descargar'}
                        </button>
                        {compartible && (
                          <button
                            type="button"
                            disabled={ocupada === v.id}
                            onClick={() => entregarComprobante(v,false)}
                            className="flex items-center gap-1.5 rounded-lg border border-[#D3D1C7] px-3 py-2 text-sm text-gray-700 disabled:opacity-50"
                            aria-label="Descargar la factura"
                          >
                            <Download size={15} />
                          </button>
                        )}
                      </div>
                    ) : f?.estado === 'incierta' ? (
                      <p className="flex items-center gap-1.5 text-xs text-amber-700">
                        <Clock size={14} /> Factura en revisión — se resuelve sola dentro de la hora.
                      </p>
                    ) : f?.estado === 'rechazada' ? (
                      <p className="flex items-center gap-1.5 text-xs text-red-700">
                        <AlertTriangle size={14} /> ARCA rechazó la factura. Avisá a la oficina.
                      </p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs text-gray-400">
                        <FileText size={14} /> Facturando…
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 border-t border-[#F2F1EA] pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mr-auto font-mono text-xs text-gray-600">
                        {tipoComprobanteInterno(v) === 'remito' ? 'Remito' : 'Factura X'}{' '}
                        {v.comprobanteInterno ? codigoComprobanteInterno(v.comprobanteInterno) : 'sin número'}
                      </span>
                      <button
                        type="button"
                        disabled={ocupada === v.id}
                        onClick={() => entregarComprobante(v, true)}
                        className="flex items-center gap-1.5 rounded-lg bg-[#1D9E75] px-3 py-2 text-sm font-semibold text-white hover:bg-[#178760] disabled:opacity-50"
                      >
                        <Share2 size={15} />
                        {ocupada === v.id ? 'Generando…' : compartible ? 'Enviar' : 'Descargar'}
                      </button>
                      {compartible && (
                        <button
                          type="button"
                          disabled={ocupada === v.id}
                          onClick={() => entregarComprobante(v, false)}
                          className="flex items-center gap-1.5 rounded-lg border border-[#D3D1C7] px-3 py-2 text-sm text-gray-700 disabled:opacity-50"
                          aria-label="Descargar el comprobante"
                        >
                          <Download size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </main>
    </div>
  )
}
