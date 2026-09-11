import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, RefreshCw, Smartphone } from 'lucide-react'
import SolicitarAnulacionModal from '@/components/expedicion/SolicitarAnulacionModal'
import AnularRemitoModal from '@/components/ventas/AnularRemitoModal'
import { useAuth } from '@/context/AuthContext'
import { getVentasCliente } from '@/services/historialClienteService'
import { reportError } from '@/services/observability'
import type { VentaAnulable } from '@/services/anulacionService'
import { facturaAnulable, textoAnulacion } from '@/utils/anulacionVenta'
import { tipoComprobanteInterno } from '@/utils/comprobanteInterno'
import { codigoComprobanteInterno } from '@/utils/numeracionInterna'
import { formatoARS } from '@/utils/money'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import type { VentaCamion, VentaVentanilla } from '@/types'

// Ventas hechas con la app (camión y ventanilla) de un cliente, en Comprobantes
// de clientes (2026-09-11, decisión de Ariel): facturación anula desde acá las
// ventas de DÍAS YA CERRADOS. La factura (ARCA o X de promo) va con solicitud
// y autorización, igual que en ventanilla; el remito de cta. cte. se anula
// directo (la oficina lo anula en Tango). La liquidación del repartidor o la
// caja de ese día no se reabren: el server les anota la anulación.

type Fila =
  | { coleccion: 'ventasCamion'; venta: VentaCamion }
  | { coleccion: 'ventasVentanilla'; venta: VentaVentanilla }

const LETRA: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C' }
const nro = (pv: number, n: number) => `${String(pv).padStart(5, '0')}-${String(n).padStart(8, '0')}`

/** Qué papel salió por esa venta, para la lista. Pura. */
export function comprobanteDeVenta(v: VentaCamion | VentaVentanilla): string {
  const f = v.factura
  if (f?.estado === 'emitida' && f.cae) return `Factura ${LETRA[f.cbteTipo] ?? ''} ${nro(f.puntoVenta, f.numero)}`.replace(/\s+/g, ' ')
  if (f?.estado === 'rechazada') return 'Factura rechazada por ARCA'
  if (f && f.estado !== 'emitida') return 'Factura en proceso'
  const ci = v.comprobanteInterno
  const tipo = tipoComprobanteInterno(v)
  if (ci?.tipo) return `${ci.tipo === 'remito' ? 'Remito' : 'Factura X'} ${codigoComprobanteInterno(ci)}`
  if (tipo === 'remito') return 'Remito sin número'
  if (tipo === 'facturaX') return 'Factura X sin número'
  return 'Ticket'
}

// La solicitud del camión lleva planta por compatibilidad con las que pide
// caja; la oficina no tiene planta y el camión tampoco.
const objetivoDe = (f: Fila): VentaAnulable =>
  f.coleccion === 'ventasCamion'
    ? { coleccion: 'ventasCamion', venta: f.venta, plantaId: 'torcuato' }
    : { coleccion: 'ventasVentanilla', venta: f.venta }

const remitoAnulable = (f: Fila): f is { coleccion: 'ventasCamion'; venta: VentaCamion } =>
  f.coleccion === 'ventasCamion' && f.venta.canal === 'contado' && f.venta.formaPago === 'cuenta_corriente'
  && !f.venta.factura && tipoComprobanteInterno(f.venta) === 'remito' && !f.venta.anulacion

export default function VentasAppCliente({ clienteUid }: { clienteUid: string }) {
  const { user, verComo } = useAuth()
  const actor = useMemo(() => (user ? { uid: user.uid, nombre: user.nombre } : null), [user])
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState('')
  const [anulando, setAnulando] = useState<Fila | null>(null)

  const cargar = useCallback(async () => {
    setError('')
    try {
      const { ventasCamion, ventasVentanilla } = await getVentasCliente(clienteUid)
      const todas: Fila[] = [
        ...ventasCamion.map((venta): Fila => ({ coleccion: 'ventasCamion', venta })),
        ...ventasVentanilla.map((venta): Fila => ({ coleccion: 'ventasVentanilla', venta })),
      ]
      setFilas(todas.sort((a, b) => b.venta.fecha.toMillis() - a.venta.fecha.toMillis()))
    } catch (err) {
      reportError(err, { origen: 'VentasAppCliente', clienteUid })
      setError('No se pudieron cargar las ventas de la app.')
      setFilas([])
    }
  }, [clienteUid])
  useEffect(() => { cargar() }, [cargar])

  const cerrarModal = (hecho: boolean) => { setAnulando(null); if (hecho) cargar() }
  const puedeAnular = !!actor && !verComo

  return (
    <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-[#F8F7F2] border-b border-[#D3D1C7]">
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Smartphone size={15} className="text-accent" /> Ventas hechas con la app</p>
        <p className="text-xs text-gray-500">
          {filas === null ? 'Cargando…' : `${filas.length} ${filas.length === 1 ? 'venta' : 'ventas'} en el último año`}
          {' · '}desde acá se anulan las de días ya cerrados
        </p>
      </div>
      {error && <p className="text-xs text-red-700 px-4 py-2">{error}</p>}
      {filas !== null && filas.length === 0 && !error && (
        <p className="text-sm text-gray-500 px-4 py-4 text-center">Este cliente no tiene ventas hechas con la app en el último año.</p>
      )}
      {filas !== null && filas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-500">
              <tr className="border-b border-gray-100">
                <th className="text-left px-3 py-2 font-semibold">Fecha</th>
                <th className="text-left px-2 py-2 font-semibold">Quién vendió</th>
                <th className="text-left px-2 py-2 font-semibold">Comprobante</th>
                <th className="text-right px-2 py-2 font-semibold">Importe</th>
                <th className="text-left px-2 py-2 font-semibold">Estado</th>
                <th className="w-36" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map((f) => {
                const v = f.venta
                const estado = textoAnulacion(v.anulacion)
                const tono = estado?.tono === 'bad' ? 'text-red-700' : estado?.tono === 'warn' ? 'text-amber-700' : 'text-gray-500'
                const anulada = v.anulacion?.estado === 'anulada'
                return (
                  <tr key={`${f.coleccion}/${v.id}`} className="hover:bg-[#F8F7F2]">
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                      {v.fecha.toDate().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      <span className="block text-[11px] text-gray-400">{v.fecha.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {f.coleccion === 'ventasCamion' ? <>Camión · {f.venta.choferNombre}</> : <>Ventanilla · {f.venta.cajaNombre}</>}
                      {nombreClienteVenta(v) !== v.clienteNombre && <span className="block text-[11px] text-gray-400 truncate max-w-[12rem]">{nombreClienteVenta(v)}</span>}
                    </td>
                    <td className={`px-2 py-2 whitespace-nowrap ${anulada ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                      {comprobanteDeVenta(v)}
                      <span className="block text-[11px] text-gray-400 no-underline">{v.canal === 'promo' ? 'Promo' : 'Contado'} · {v.formaPago.replace(/_/g, ' ')}</span>
                    </td>
                    <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${anulada ? 'text-gray-400' : 'text-gray-900'}`}>{formatoARS(v.total)}</td>
                    <td className={`px-2 py-2 text-xs ${tono}`}>{estado?.texto ?? 'Vigente'}</td>
                    <td className="pr-3 py-2 text-right whitespace-nowrap">
                      {puedeAnular && facturaAnulable(v) && (
                        <button type="button" onClick={() => setAnulando(f)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:border-red-400">
                          <Ban size={13} /> Anular factura
                        </button>
                      )}
                      {puedeAnular && remitoAnulable(f) && (
                        <button type="button" onClick={() => setAnulando(f)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:border-red-400">
                          <Ban size={13} /> Anular remito
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {filas !== null && (
        <div className="px-4 py-2 border-t border-gray-100">
          <button type="button" onClick={cargar} className="text-xs text-accent font-medium inline-flex items-center gap-1 hover:underline"><RefreshCw size={12} /> Actualizar</button>
        </div>
      )}

      {anulando && actor && remitoAnulable(anulando) && (
        <AnularRemitoModal venta={anulando.venta} actor={actor} origen="facturacion" onCerrar={cerrarModal} />
      )}
      {anulando && actor && !remitoAnulable(anulando) && (
        <SolicitarAnulacionModal actor={actor} origen="facturacion" onCerrar={cerrarModal} objetivo={objetivoDe(anulando)} />
      )}
    </div>
  )
}
