// Las ventas que hizo el chofer, con la factura de cada una.
//
// Existe por un motivo concreto: hasta ahora la app emitía la factura
// electrónica y el chofer no tenía forma de dársela al cliente. Acá la ve y la
// manda por WhatsApp o mail desde el mismo teléfono, sin esperar al mail que
// Tango envía por su cuenta.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileText, Clock, AlertTriangle, Mail } from 'lucide-react'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { useAuth } from '@/context/AuthContext'
import { subscribeVentasRecientesChofer } from '@/services/ventaCamionService'
import { tipoComprobanteInterno, ETIQUETA_COMPROBANTE, type CaiRemito } from '@/utils/comprobanteInterno'
import { codigoComprobanteInterno } from '@/services/numeracionInternaService'
import { caiRemitoOficialCacheado, getCaiRemitoOficial } from '@/services/remitoOficialConfigService'
import MenuComprobanteVenta from '@/components/ventas/MenuComprobanteVenta'
import { VentaCamion } from '@/types'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { useEnvioAutomaticoVentas } from '@/hooks/useEnvioAutomaticoVentas'
import { estadoEnvioLocal, pendienteDeEnvio } from '@/services/envioAutomaticoVentasService'
import MenuCompartirPdf, { type PdfGenerado } from '@/components/ui/MenuCompartirPdf'
import { armarNotaCreditoDeVenta } from '@/utils/facturaDeVenta'
import { textoAnulacion } from '@/utils/anulacionVenta'

const money = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const nroFactura = (v: VentaCamion) =>
  v.factura
    ? `${String(v.factura.puntoVenta).padStart(5, '0')}-${String(v.factura.numero).padStart(8, '0')}`
    : ''

export default function VentasChofer({ volverA = '/chofer' }: { volverA?: string } = {}) {
  const { user, verComo } = useAuth()
  const [ventas, setVentas] = useState<VentaCamion[] | null>(null)
  const [fallo, setFallo] = useState(false)
  const [pendientes, setPendientes] = useState(0)
  // CAI del talonario de remitos oficiales (Redonhielo). Arranca con el último
  // cacheado para que sirva sin señal; se refresca al montar.
  const [caiRemito, setCaiRemito] = useState<CaiRemito | null>(() => caiRemitoOficialCacheado())
  useEffect(() => { getCaiRemitoOficial().then(setCaiRemito) }, [])

  useEffect(() => {
    if (!user) return
    setFallo(false)
    return subscribeVentasRecientesChofer(user.uid, setVentas, () => setFallo(true), setPendientes)
  }, [user])
  // Mail automático al cliente de cada venta que todavía no salió (también
  // corre desde el hub). En "Ver como" no se manda nada. Cada envío hecho
  // re-renderiza la lista, así los chips de estado se refrescan.
  useEnvioAutomaticoVentas(verComo ? null : ventas)

  if (!user || ventas === null) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <header className="flex items-center gap-3 bg-gradient-to-b from-[#1a6b52] to-[#1D9E75] px-4 py-4 pt-[calc(1rem+env(safe-area-inset-top))] text-white">
        <Link to={volverA} className="rounded-full bg-white/20 p-2" aria-label="Volver">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-lg font-bold leading-tight">Mis ventas</h1>
          <p className="text-xs text-white/80">Entregá el comprobante al cliente</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl p-4">

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
                  <span className="font-semibold text-gray-800">{nombreClienteVenta(v)}</span>
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
                        <MenuComprobanteVenta venta={v} cai={caiRemito} />
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
                        {ETIQUETA_COMPROBANTE[tipoComprobanteInterno(v)!]}{' '}
                        {v.comprobanteInterno ? codigoComprobanteInterno(v.comprobanteInterno) : 'sin número'}
                      </span>
                      <MenuComprobanteVenta venta={v} cai={caiRemito} />
                    </div>
                  </div>
                )}
                <EstadoAnulacion venta={v} />
                <EstadoMail venta={v} />
              </article>
            )
          })}
        </div>
      </main>
    </div>
  )
}

// Estado del mail automático al cliente: lo que anotó el server en la venta
// (envioMail) o, mientras tanto, lo que sabe el teléfono (sin mail en Tango,
// mandando, error). Sin nada que decir, no muestra nada.
function EstadoMail({ venta }: { venta: VentaCamion }) {
  const e = venta.envioMail
  let texto = ''
  let tono = 'text-gray-500'
  if (e?.estado === 'enviado') { texto = `Mail enviado a ${e.para}`; tono = 'text-emerald-700' }
  else if (e?.estado === 'error') { texto = 'El mail no salió: mandalo desde "Enviar o descargar"'; tono = 'text-red-700' }
  else {
    const l = estadoEnvioLocal(venta.id)
    if (l?.estado === 'sin_mail') texto = 'Cliente sin mail en Tango: no se manda solo'
    else if (l?.estado === 'enviando') texto = 'Mandando el mail al cliente…'
    else if (l?.estado === 'error') { texto = 'No se pudo mandar el mail (se reintenta)'; tono = 'text-amber-700' }
    else if (pendienteDeEnvio(venta)) texto = 'Mail al cliente pendiente (sale con señal)'
  }
  if (!texto) return null
  return <p className={`mt-2 flex items-center gap-1.5 text-xs ${tono}`}><Mail size={13} className="shrink-0" /> {texto}</p>
}

// Anulación de la factura con nota de crédito (2026-09-11): caja la pide desde
// la liquidación; acá el chofer ve el estado y, cuando la NC salió, la entrega
// al cliente igual que la factura (WhatsApp, mail, descarga).
function EstadoAnulacion({ venta }: { venta: VentaCamion }) {
  const a = venta.anulacion
  const t = textoAnulacion(a)
  if (!a || !t) return null
  const nc = a.notaCredito
  const titulo = nc ? `Nota de crédito ${String(nc.puntoVenta).padStart(5, '0')}-${String(nc.numero).padStart(8, '0')}` : 'Nota de crédito'
  const generar = async (): Promise<PdfGenerado> => {
    const armado = armarNotaCreditoDeVenta(venta, undefined)
    if (!armado.ok) return { ok: false, motivo: armado.motivo }
    const { generateFacturaArcaPdf } = await import('@/utils/facturaArcaPdf')
    const blob = await generateFacturaArcaPdf(armado.datos)
    if (!(blob instanceof Blob)) return { ok: false, motivo: 'No se pudo generar la nota de crédito.' }
    return { ok: true, blob, nombre: `${titulo.replace(/\s+/g, '-').toLowerCase()}.pdf` }
  }
  const tono = t.tono === 'bad' ? 'text-red-700' : t.tono === 'warn' ? 'text-amber-700' : 'text-gray-600'
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <p className={`font-semibold ${tono}`}>{t.texto}</p>
      {a.estado === 'anulada' && nc && (
        <MenuCompartirPdf titulo={titulo} texto={`${titulo} — ${venta.clienteNombre}`} generar={generar}
          mail={{ para: '', asunto: `${titulo} — ${venta.clienteNombre}`, mensaje: 'Te enviamos adjunta la nota de crédito que anula la factura.', comprobante: { tipo: 'NC', numero: `${nc.puntoVenta}-${nc.numero}` }, clienteUid: venta.clienteId || undefined, clienteNombre: venta.clienteNombre, presentacion: { titulo, emoji: '📄', filas: [] }, venta: { coleccion: 'ventasCamion', id: venta.id } }}
          trigger={(abrir, ocupado) => (
            <button type="button" onClick={abrir} disabled={ocupado} className="rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1 font-semibold text-accent disabled:opacity-50">
              {ocupado ? 'Generando…' : 'Entregar la nota de crédito'}
            </button>
          )} />
      )}
    </div>
  )
}
