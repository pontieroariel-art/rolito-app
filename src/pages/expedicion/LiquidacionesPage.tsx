import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileText, Printer } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { subscribeRemitosCargaDelDia } from '../../services/remitoCargaService'
import { subscribeVentasChoferEnRango } from '../../services/ventaCamionService'
import { subscribeCambiosChoferEnRango } from '../../services/cambioCamionService'
import { subscribeDescargasChoferEnRango } from '../../services/descargaCamionService'
import { subscribeCobranzasChoferEnRango } from '../../services/cobranzaService'
import { useChoferes } from '../../hooks/useChoferes'
import { cerrarLiquidacion, subscribeLiquidacion } from '../../services/liquidacionService'
import { calcularLiquidacion } from '../../utils/liquidacion'
import { generateLiquidacion } from '../../utils/pdf'
import { todayString } from '../../utils/helpers'
import {
  CambioCamion, Cobranza, DescargaCamion, Liquidacion, PLANTAS, RemitoCarga, VentaCamion,
} from '../../types'

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

// Liquidación del repartidor (pantalla de caja) — espejo digital de la hoja
// "Liquidación de repartidores" del sistema viejo. Todo se calcula EN VIVO
// desde las fuentes del día (remitos, ventas, cambios, descargas); el doc
// inmutable se crea recién al cerrar. Ver src/utils/liquidacion.ts.
export default function LiquidacionesPage() {
  const { user } = useAuth()
  const plantaId = user?.planta ?? 'torcuato'
  const hoy      = todayString()

  const { choferes: todosLosChoferes } = useChoferes()
  const [remitosPlanta, setRemitosPlanta] = useState<RemitoCarga[]>([])
  const [choferId, setChoferId] = useState('')
  const [ventas,    setVentas]    = useState<VentaCamion[]>([])
  const [cambios,   setCambios]   = useState<CambioCamion[]>([])
  const [descargas, setDescargas] = useState<DescargaCamion[]>([])
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  const [cerrada,   setCerrada]   = useState<Liquidacion | null>(null)
  const [efectivoRecibido, setEfectivoRecibido] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')

  useEffect(() => subscribeRemitosCargaDelDia(plantaId, new Date(), setRemitosPlanta), [plantaId])

  // Primero los que salieron hoy con remito de esta planta; abajo el resto de
  // los choferes activos — un cobrador puede tener un día SOLO de cobranzas,
  // sin remito de carga, y también se liquida.
  const choferes = useMemo(() => {
    const m = new Map<string, string>()
    remitosPlanta.forEach((r) => m.set(r.choferId, r.choferNombre))
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre }))
  }, [remitosPlanta])
  const otrosChoferes = useMemo(
    () => todosLosChoferes
      .filter((c) => !choferes.some((x) => x.id === c.uid))
      .map((c) => ({ id: c.uid, nombre: c.nombre || c.nombreContacto || '' })),
    [todosLosChoferes, choferes],
  )

  const remitosChofer = remitosPlanta.filter((r) => r.choferId === choferId)
  const choferNombre  = choferes.find((c) => c.id === choferId)?.nombre
    ?? otrosChoferes.find((c) => c.id === choferId)?.nombre ?? ''

  useEffect(() => {
    if (!choferId) { setVentas([]); setCambios([]); setDescargas([]); setCobranzas([]); setCerrada(null); return }
    const desde = new Date(); desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
    const unsubs = [
      subscribeVentasChoferEnRango(choferId, desde, hasta, setVentas),
      subscribeCambiosChoferEnRango(choferId, desde, hasta, setCambios),
      subscribeDescargasChoferEnRango(choferId, desde, hasta, setDescargas),
      subscribeCobranzasChoferEnRango(choferId, desde, hasta, setCobranzas),
      subscribeLiquidacion(hoy, choferId, setCerrada),
    ]
    return () => unsubs.forEach((u) => u())
  }, [choferId, hoy])

  const calc = useMemo(
    () => calcularLiquidacion(remitosChofer, ventas, cambios, descargas, cobranzas),
    [remitosChofer, ventas, cambios, descargas, cobranzas],
  )

  const recibido = parseInt(efectivoRecibido.replace(/\D/g, ''), 10) || 0

  const imprimir = (liq: Liquidacion) =>
    generateLiquidacion(liq).catch((err) => console.error('[liquidacion] error al generar el PDF:', err))

  const cerrar = async () => {
    if (!user || !choferId) return
    setGuardando(true)
    setError('')
    try {
      const liq = await cerrarLiquidacion(
        { choferId, choferNombre, calculo: calc, efectivoRecibido: recibido },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setConfirmando(false)
      imprimir(liq)
    } catch (err) {
      console.error('[liquidacion] error al cerrar:', err)
      setError('No se pudo cerrar la liquidación. ¿Ya estaba cerrada? Revisá e intentá de nuevo.')
      setConfirmando(false)
    } finally {
      setGuardando(false)
    }
  }

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const dif = (n: number) => n === 0
    ? <span className="text-gray-500">0</span>
    : <span className="font-semibold text-red-600">{n > 0 ? `+${n}` : n}</span>

  return (
    <main className="max-w-4xl mx-auto p-4 space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Liquidación de repartidores</h1>
        <p className="text-gray-500 text-sm">{PLANTAS[plantaId].label} · {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      <div className="max-w-sm">
        <label className="text-xs text-gray-500 mb-1 block">Repartidor</label>
        <select value={choferId} onChange={(e) => setChoferId(e.target.value)} className={selectClass}>
          <option value="">Elegir repartidor…</option>
          {choferes.length > 0 && (
            <optgroup label="Con salida hoy">
              {choferes.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </optgroup>
          )}
          {otrosChoferes.length > 0 && (
            <optgroup label="Sin remito hoy (cobradores, etc.)">
              {otrosChoferes.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {choferId && cerrada && (
        <section className="bg-accent/5 border border-accent/30 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-accent" />
            <p className="font-semibold text-gray-900">Liquidación cerrada</p>
          </div>
          <p className="text-sm text-gray-600">
            Cerró {cerrada.cerradaPor.nombre} · Efectivo rendido {money(cerrada.efectivoRecibido)}
            {cerrada.diferenciaEfectivo !== 0 && (
              <span className="text-red-600 font-medium"> (diferencia {money(cerrada.diferenciaEfectivo)})</span>
            )}
          </p>
          <Button variant="outline" onClick={() => imprimir(cerrada)}>
            <Printer size={16} className="mr-1.5" /> Reimprimir liquidación
          </Button>
        </section>
      )}

      {choferId && !cerrada && (
        <>
          {/* ── Detalle por producto (espejo de la hoja vieja) ── */}
          <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 overflow-x-auto">
            <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <FileText size={18} className="text-accent" /> Detalle por producto
            </h2>
            {calc.productos.length === 0 ? (
              <p className="text-gray-400 text-sm">Sin movimientos todavía.</p>
            ) : (
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                    <th className="text-left py-2 pr-2 font-medium">Producto</th>
                    <th className="text-right py-2 px-2 font-medium">Carga</th>
                    <th className="text-right py-2 px-2 font-medium">Venta Cdo.</th>
                    <th className="text-right py-2 px-2 font-medium">Promoción</th>
                    <th className="text-right py-2 px-2 font-medium">Cambios</th>
                    <th className="text-right py-2 px-2 font-medium">Dev. teórica</th>
                    <th className="text-right py-2 px-2 font-medium">Descarga</th>
                    <th className="text-right py-2 pl-2 font-medium">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.productos.map((p) => (
                    <tr key={p.productoId} className="border-b border-gray-100 last:border-0">
                      <td className="py-1.5 pr-2 text-gray-800">{p.nombre}</td>
                      <td className="py-1.5 px-2 text-right">{p.carga}</td>
                      <td className="py-1.5 px-2 text-right">{p.ventaContado}</td>
                      <td className="py-1.5 px-2 text-right">{p.ventaPromo}</td>
                      <td className="py-1.5 px-2 text-right">{p.cambios}</td>
                      <td className="py-1.5 px-2 text-right text-gray-500">{p.devolucionTeorica}</td>
                      <td className="py-1.5 px-2 text-right">{p.descarga}</td>
                      <td className="py-1.5 pl-2 text-right">{dif(p.diferencia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {descargas.length === 0 && calc.productos.length > 0 && (
              <p className="text-xs text-amber-600 mt-2">Muelle todavía no registró la descarga — las diferencias van a quedar contra 0.</p>
            )}
          </section>

          {/* ── Envases y cambios ── */}
          <div className="grid sm:grid-cols-2 gap-4">
            <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4">
              <h2 className="font-semibold text-gray-800 mb-2">Envases (pallets)</h2>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-600">Salieron</span><span className="font-medium">{calc.pallets.salidos}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Volvieron completos</span><span className="font-medium">{calc.pallets.completos}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Volvieron parciales</span><span className="font-medium">{calc.pallets.parciales}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Volvieron vacíos</span><span className="font-medium">{calc.pallets.vacios}</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                  <span className="text-gray-600">Diferencia</span>{dif(calc.pallets.diferencia)}
                </div>
              </div>
            </section>
            <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4">
              <h2 className="font-semibold text-gray-800 mb-2">Cambios (bolsas rotas)</h2>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-600">Registrados por el chofer</span><span className="font-medium">{calc.cambios.registrados}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Rotas recibidas en muelle</span><span className="font-medium">{calc.cambios.rotasRecibidas}</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                  <span className="text-gray-600">Diferencia</span>{dif(calc.cambios.rotasRecibidas - calc.cambios.registrados)}
                </div>
              </div>
            </section>
          </div>

          {/* ── Plata ── */}
          <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-3">
            <h2 className="font-semibold text-gray-800">Importes y rendición</h2>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-600">Contado efectivo</span><span className="font-medium">{money(calc.importes.contadoEfectivo)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Contado transferencia</span><span className="font-medium">{money(calc.importes.contadoTransferencia)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Cuenta corriente</span><span className="font-medium">{money(calc.importes.cuentaCorriente)}</span></div>
              <div className="flex justify-between border-t border-gray-100 pt-1 mt-1"><span className="text-gray-700 font-medium">Total vendido</span><span className="font-semibold">{money(calc.importes.total)}</span></div>
              {calc.cobranzasCalle && calc.cobranzasCalle.cantidad > 0 && (
                <>
                  <div className="flex justify-between pt-1"><span className="text-gray-600">Cobranzas en efectivo ({calc.cobranzasCalle.cantidad})</span><span className="font-medium">{money(calc.cobranzasCalle.efectivo)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Cobranzas por transferencia</span><span className="font-medium">{money(calc.cobranzasCalle.transferencia)}</span></div>
                  <div className="flex justify-between border-t border-gray-100 pt-1 mt-1"><span className="text-gray-700 font-medium">Total cobrado</span><span className="font-semibold">{money(calc.cobranzasCalle.total)}</span></div>
                </>
              )}
            </div>
            <div className="grid sm:grid-cols-3 gap-3 items-end">
              <div>
                <p className="text-xs text-gray-500">Efectivo a rendir</p>
                <p className="text-lg font-bold text-gray-900">{money(calc.efectivoARendir)}</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Efectivo recibido</label>
                <input
                  value={efectivoRecibido}
                  onChange={(e) => setEfectivoRecibido(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  placeholder="0"
                  className={selectClass}
                />
              </div>
              <div>
                <p className="text-xs text-gray-500">Diferencia</p>
                <p className={`text-lg font-bold ${recibido - calc.efectivoARendir === 0 ? 'text-gray-900' : 'text-red-600'}`}>
                  {money(recibido - calc.efectivoARendir)}
                </p>
              </div>
            </div>
          </section>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <p className="text-red-500 text-sm">{error}</p>
            </div>
          )}

          <Button
            onClick={() => setConfirmando(true)}
            disabled={calc.productos.length === 0 && cobranzas.length === 0}
            className="w-full sm:w-auto"
          >
            Cerrar liquidación e imprimir
          </Button>

          {confirmando && (
            <Modal open onClose={() => setConfirmando(false)} title={`Cerrar liquidación — ${choferNombre}`}>
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  Se cierra la liquidación de hoy de <span className="font-semibold">{choferNombre}</span> con
                  efectivo recibido <span className="font-semibold">{money(recibido)}</span>
                  {recibido - calc.efectivoARendir !== 0 && (
                    <span className="text-red-600"> (diferencia {money(recibido - calc.efectivoARendir)})</span>
                  )}.
                </p>
                {descargas.length === 0 && (
                  <p className="text-xs text-amber-600">Ojo: muelle no registró descarga — todas las devoluciones quedan como diferencia.</p>
                )}
                <p className="text-xs text-gray-500">El cierre es definitivo: queda el snapshot del día y no se puede modificar.</p>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
                  <Button onClick={cerrar} loading={guardando} className="flex-1">Cerrar e imprimir</Button>
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
    </main>
  )
}
