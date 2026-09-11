import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Mail, Minus, Plus, Tag, FileText, Clock } from 'lucide-react'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import SelectorSucursal from '@/components/ventas/SelectorSucursal'
import SignaturePad, { SignaturePadHandle } from '../../components/heladeras/SignaturePad'
import { useAuth } from '../../context/AuthContext'
import { useDriverOrders } from '../../hooks/useOrders'
import { useClienteSeleccionado } from '../../hooks/useClienteSeleccionado'
import { usePreciosTango } from '../../hooks/usePreciosTango'
import { useRemitosCargaChofer } from '../../hooks/useRemitosCargaChofer'
import { useDepositoDelUsuario } from '../../hooks/useDepositosReparto'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useOnline } from '../../hooks/useOnline'
import { crearVentaCamion } from '../../services/ventaCamionService'
import { markDelivered } from '../../services/orderService'
import { asegurarReserva, consumirNumero, precargarSiSeAcerca, codigoComprobanteInterno } from '../../services/numeracionInternaService'
import { getPreciosIncluyenIva } from '@/services/arcaConfigService'
import { reportError } from '@/services/observability'
import { clienteEnSucursal, necesitaSucursal, nombreSucursalVenta } from '@/utils/sucursalesTango'
import { empresaDeCanal, motivoSinPrecioTango, precioTangoDe } from '../../utils/precioTango'
import { esClienteFacturable } from '../../utils/facturable'
import { admiteCuentaCorriente } from '@/utils/condicionVenta'
import { documentoDeVenta } from '../../utils/circuitoDocumento'
import { tipoComprobanteInterno, ETIQUETA_COMPROBANTE } from '../../utils/comprobanteInterno'
import { inhabilitadoEnTango, motivoInhabilitado } from '@/utils/inhabilitadoTango'
import { desgloseFactura, percepcionVigenteDe } from '@/utils/totalFacturado'
import { normalizarOrdenCompra } from '@/utils/ordenCompraVenta'
import { esEntregaParcial, formaPagoInicial, renglonesDelPedido, sucursalDelPedido, type RenglonEntrega } from '@/utils/entregaPedido'
import type { CanalVenta, ComprobanteInternoVenta, FormaPago, TipoComprobanteInterno, VentaCamionItem } from '../../types'

// Entregar un pedido de logística en tres pasos (2026-09-11, diseño aprobado
// por Ariel): cantidades → canal y forma de pago → firma. La app arma la venta
// con lo que ya sabe del pedido (cliente, sucursal, productos, orden de compra)
// y al confirmar salen juntos el pedido entregado y la venta con su remito o
// factura, que va a Tango y al mail del cliente como cualquier venta.
// Pensado para la calle: botones grandes, una decisión por pantalla y nada
// que escribir salvo el nombre de quien firma.

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

const FORMAS: { id: FormaPago; label: string; ayuda: string }[] = [
  { id: 'contado_efectivo',      label: 'Efectivo',         ayuda: 'paga ahora' },
  { id: 'contado_transferencia', label: 'Transferencia',    ayuda: 'paga ahora' },
  { id: 'cuenta_corriente',      label: 'Cuenta corriente', ayuda: 'lo paga después' },
]

type Paso = 1 | 2 | 3

export default function EntregarPedidoPage() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orders, loading: cargandoPedidos } = useDriverOrders()
  const order = useMemo(() => orders.find((o) => o.id === orderId), [orders, orderId])
  const { catalogo } = useCatalogo()
  const { cliente, loading: cargandoCliente } = useClienteSeleccionado(order?.clientId && order.clientId !== 'externo' ? order.clientId : null)
  const { remitos: remitosCarga } = useRemitosCargaChofer()
  const { deposito: depositoUsuario } = useDepositoDelUsuario(user?.uid)
  const online = useOnline()
  const firmaRef = useRef<SignaturePadHandle>(null)

  const [paso, setPaso] = useState<Paso>(1)
  const [renglones, setRenglones] = useState<RenglonEntrega[] | null>(null)
  const [nota, setNota] = useState('')
  const [canal, setCanal] = useState<CanalVenta>('contado')
  const [formaPago, setFormaPago] = useState<FormaPago | null>(null)
  const [sucursal, setSucursal] = useState('')
  const [firmante, setFirmante] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState<{ documento: string | null; total: number; conIva: boolean; parcial: boolean; mail: string } | null>(null)
  const [preciosIncluyenIva, setPreciosIncluyenIva] = useState(false)
  useEffect(() => { getPreciosIncluyenIva().then(setPreciosIncluyenIva) }, [])

  // Renglones: se arman una vez que hay pedido y catálogo; después los edita el chofer.
  useEffect(() => {
    if (renglones || !order || !catalogo.length) return
    setRenglones(renglonesDelPedido(order.products, catalogo))
  }, [order, catalogo, renglones])

  // Forma de pago y sucursal iniciales, cuando llega la ficha del cliente.
  const empresa = empresaDeCanal(canal)
  useEffect(() => { if (cliente && formaPago === null) setFormaPago(formaPagoInicial(cliente)) }, [cliente, formaPago])
  useEffect(() => { setSucursal(sucursalDelPedido(cliente, empresa, order?.clientAddress)) }, [cliente, empresa, order?.clientAddress])
  const ctaCte = admiteCuentaCorriente(cliente)
  useEffect(() => { if (formaPago === 'cuenta_corriente' && cliente && !ctaCte.ok) setFormaPago('contado_efectivo') }, [formaPago, cliente, ctaCte.ok])

  // Numeración propia (remito / factura X) reservada al entrar, para numerar sin señal.
  const [numeracionActiva, setNumeracionActiva] = useState<Record<TipoComprobanteInterno, boolean>>({ remito: false, remitoPromo: false, facturaX: false })
  useEffect(() => {
    if (!user) return
    ;(['remito', 'remitoPromo', 'facturaX'] as const).forEach((tipo) => {
      asegurarReserva(tipo, user.uid, online).then((activa) => setNumeracionActiva((prev) => (prev[tipo] === activa ? prev : { ...prev, [tipo]: activa })))
    })
  }, [user, online])

  const depositoVenta = depositoUsuario
    ? { depositoTango: depositoUsuario.codigo, depositoTangoNombre: depositoUsuario.nombre }
    : remitosCarga[0]?.depositoTango
      ? { depositoTango: remitosCarga[0].depositoTango, depositoTangoNombre: remitosCarga[0].depositoTangoNombre ?? '' }
      : {}
  const camionIdHoy = remitosCarga[0]?.camionId ?? user?.camionId ?? ''

  // Precios de Tango en la empresa del canal.
  const { precios: preciosTango } = usePreciosTango(empresa)
  const sinPrecioMotivo = useMemo(() => (cliente ? motivoSinPrecioTango(preciosTango, cliente, empresa) : null), [preciosTango, cliente, empresa])
  const items: VentaCamionItem[] = (renglones ?? [])
    .filter((r) => r.productoId && r.cantidad > 0)
    .map((r) => ({ productoId: r.productoId, nombre: r.nombre, cantidad: r.cantidad, precioUnitario: cliente ? (precioTangoDe(preciosTango, cliente, empresa, r.productoId)?.precio ?? 0) : 0 }))
  const itemsSinPrecio = items.filter((i) => !cliente || precioTangoDe(preciosTango, cliente, empresa, i.productoId) === null)
  const sinCatalogo = (renglones ?? []).filter((r) => !r.productoId)
  const total = items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)
  const parcial = esEntregaParcial(renglones ?? [])
  const documento = documentoDeVenta(canal, formaPago ?? 'contado_efectivo', total)
  const conIva = documento === 'factura_arca' && items.length > 0
    ? desgloseFactura(items, { preciosIncluyenIva, percepcionAlicuota: percepcionVigenteDe(cliente) })
    : null
  const noFacturable = useMemo(() => {
    if (documento !== 'factura_arca' || !cliente) return null
    const r = esClienteFacturable(cliente)
    return r.facturable ? null : r.motivos
  }, [documento, cliente])
  const inhabilitado = !!cliente && inhabilitadoEnTango(cliente, empresa)
  const faltaSucursal = necesitaSucursal(cliente, empresa) && !sucursal

  const cambiar = (i: number, delta: number) =>
    setRenglones((prev) => prev && prev.map((r, k) => (k === i ? { ...r, cantidad: Math.max(0, r.cantidad + delta) } : r)))

  const seguirPaso1 = () => {
    setError('')
    if (!renglones || items.length === 0) { setError('No hay nada para entregar. Si no pudiste entregar, volvé y tocá "No entregado".'); return }
    if (parcial && !nota.trim()) { setError('Contá por qué entregaste menos de lo pedido.'); return }
    setPaso(2)
  }
  const seguirPaso2 = () => {
    setError('')
    if (inhabilitado) { setError(motivoInhabilitado(empresa)); return }
    if (!formaPago) { setError('Elegí cómo paga.'); return }
    if (faltaSucursal) { setError('Elegí a qué sucursal fue la entrega.'); return }
    if (sinPrecioMotivo || itemsSinPrecio.length) { setError('Hay productos sin precio en Tango para este cliente. Registrá la venta desde Vender o avisá a la oficina.'); return }
    if (noFacturable) { setError('A este cliente no se le puede facturar: elegí cuenta corriente o Promo, o avisá a la oficina.'); return }
    setPaso(3)
  }

  const confirmar = async () => {
    if (!user || !cliente || !order || !renglones || !formaPago) return
    setError('')
    if (!firmante.trim()) { setError('Poné el nombre de quien firma.'); return }
    const firma = firmaRef.current?.toDataURL()
    if (!firma) { setError('Falta la firma del cliente.'); return }
    setGuardando(true)
    try {
      const clienteVenta = clienteEnSucursal(cliente, empresa, sucursal)
      const tipoInterno = tipoComprobanteInterno({ canal, formaPago, total })
      let comprobanteInterno: ComprobanteInternoVenta | undefined
      if (tipoInterno && numeracionActiva[tipoInterno]) {
        try { comprobanteInterno = { tipo: tipoInterno, ...consumirNumero(tipoInterno, user.uid) } } catch { /* reserva agotada: sin número */ }
      }
      // La venta (remito / factura) y el pedido entregado salen juntos; las dos
      // escrituras se encolan sin señal y suben solas.
      crearVentaCamion(
        {
          canal, cliente: clienteVenta, items, formaPago, firmaCliente: firma, firmanteNombre: firmante, comprobanteInterno,
          pedidoId: order.id, ordenCompra: normalizarOrdenCompra(order.numeroOC),
          clienteSucursalNombre: nombreSucursalVenta(cliente, empresa, clienteVenta.codigoTango),
        },
        { uid: user.uid, nombre: user.nombre, camionId: camionIdHoy, ...depositoVenta },
      )
      if (tipoInterno) precargarSiSeAcerca(tipoInterno, user.uid, online)
      const entregados = renglones.map((r) => ({ name: r.nombre, quantity: r.cantidad, ...(r.productoId ? { productoId: r.productoId } : {}) }))
      markDelivered(order.id, entregados, parcial, nota.trim(), { uid: user.uid, nombre: user.nombre })
        .catch((err) => reportError(err, { origen: 'EntregarPedidoPage', accion: 'markDelivered', orderId: order.id }))
      setExito({
        documento: tipoInterno ? `${ETIQUETA_COMPROBANTE[tipoInterno]} ${comprobanteInterno ? codigoComprobanteInterno(comprobanteInterno) : 'sin número'}` : null,
        total: conIva?.total ?? total, conIva: conIva !== null, parcial, mail: cliente.email && !cliente.email.endsWith('@rolito.app') ? cliente.email : '',
      })
    } catch (err) {
      reportError(err, { origen: 'EntregarPedidoPage', accion: 'confirmar' })
      setError('No se pudo registrar la entrega. Intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  // ── Pantalla de éxito ──────────────────────────────────────────────────────
  if (exito && order) {
    return (
      <div className="min-h-dvh bg-[#F8F7F2] text-gray-900 flex flex-col">
        <main className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto w-full">
          <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center mb-4">
            <CheckCircle2 size={48} className="text-success" strokeWidth={2.2} />
          </div>
          <h2 className="text-2xl font-black">¡Entrega registrada!</h2>
          <p className="text-gray-500 mt-1">{order.clientName}</p>
          <p className="text-3xl font-black tabular-nums mt-3">{money(exito.total)}</p>
          {exito.conIva && <p className="text-xs text-gray-500 mt-0.5">IVA incluido, como sale en la factura</p>}
          <div className="mt-5 w-full rounded-2xl border border-[#D3D1C7] bg-white p-4 text-left text-sm space-y-2">
            <p className="flex gap-2"><span className="text-success font-bold">✓</span> Pedido entregado{exito.parcial ? ' (parcial)' : ''}</p>
            <p className="flex gap-2"><span className="text-success font-bold">✓</span> {exito.documento ? `${exito.documento}${order.numeroOC ? ` · OC ${order.numeroOC}` : ''}` : 'Factura en camino: la ves en Mis ventas'}</p>
            <p className="flex gap-2"><Mail size={16} className="text-success shrink-0 mt-0.5" /> {exito.mail ? `El comprobante se manda solo a ${exito.mail}` : 'El cliente no tiene mail en Tango: entregale el papel desde Mis ventas'}</p>
            <p className="flex gap-2"><Clock size={16} className="text-amber-600 shrink-0 mt-0.5" /> Tango: en camino</p>
          </div>
          <Button onClick={() => navigate('/chofer/ventas')} className="mt-6 w-full h-14 text-base">Ver el comprobante</Button>
          <Link to="/chofer" className="mt-3 text-sm text-gray-500 underline">Volver a mis entregas</Link>
        </main>
      </div>
    )
  }

  if (!user || cargandoPedidos) return <LoadingSpinner fullScreen />

  if (!order) {
    return (
      <Marco titulo="Entregar pedido">
        <p className="text-sm text-gray-600">Este pedido ya no está en tus entregas de hoy.</p>
        <Link to="/chofer" className="text-sm text-accent underline">Volver</Link>
      </Marco>
    )
  }
  if (!order.clientId || order.clientId === 'externo') {
    return (
      <Marco titulo={order.clientName}>
        <p className="text-sm text-gray-600">Este pedido no tiene un cliente registrado en la app, así que no se le puede hacer el remito desde acá. Marcalo entregado desde el home y registrá la venta desde Vender.</p>
        <Link to="/chofer" className="text-sm text-accent underline">Volver</Link>
      </Marco>
    )
  }
  if (cargandoCliente || !renglones) return <LoadingSpinner fullScreen />

  const subtitulo = ['Cantidades', 'Venta y pago', 'Firma'][paso - 1]

  return (
    <div className="min-h-dvh bg-[#F8F7F2] text-gray-900 pb-28">
      <header className="sticky top-0 z-10 bg-white border-b border-[#D3D1C7] px-4 py-3 flex items-center gap-3">
        <button type="button" onClick={() => (paso === 1 ? navigate('/chofer') : setPaso((p) => (p - 1) as Paso))} aria-label="Volver"
          className="w-9 h-9 rounded-full bg-[#EEEDE6] flex items-center justify-center"><ArrowLeft size={18} /></button>
        <div className="min-w-0">
          <p className="font-bold leading-tight truncate">{order.clientName}</p>
          <p className="text-xs text-gray-500">Paso {paso} de 3 · {subtitulo}</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-3">
        <div className="grid grid-cols-3 gap-1.5">
          {[1, 2, 3].map((p) => <i key={p} className={`h-1.5 rounded-full ${p <= paso ? 'bg-[#1D9E75]' : 'bg-[#DCDAD1]'}`} />)}
        </div>

        {paso === 1 && (
          <>
            <div className="rounded-2xl border border-[#D3D1C7] bg-white p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">¿Qué entregaste?</p>
              {renglones.map((r, i) => (
                <div key={`${r.productoId}-${i}`} className="flex items-center justify-between gap-3 py-3 border-t first:border-t-0 border-[#EEEDE6]">
                  <div className="min-w-0">
                    <p className="font-semibold text-[15px] leading-tight">{r.nombre}</p>
                    <p className="text-xs text-gray-400">pedido: {r.pedido}{!r.productoId ? ' · no está en el catálogo' : ''}</p>
                  </div>
                  <div className="grid grid-cols-[44px_56px_44px] items-center shrink-0">
                    <button type="button" onClick={() => cambiar(i, -1)} aria-label="Menos" className="h-11 rounded-xl border border-[#D3D1C7] bg-white text-xl font-bold active:scale-95"><Minus size={20} className="mx-auto" /></button>
                    <span className="text-center text-2xl font-black tabular-nums">{r.cantidad}</span>
                    <button type="button" onClick={() => cambiar(i, +1)} aria-label="Más" className="h-11 rounded-xl border border-[#D3D1C7] bg-white text-xl font-bold active:scale-95"><Plus size={20} className="mx-auto" /></button>
                  </div>
                </div>
              ))}
            </div>
            {sinCatalogo.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {sinCatalogo.map((r) => r.nombre).join(', ')}: no lo reconozco en el catálogo, no va a salir en el remito. Avisá a la oficina.
              </p>
            )}
            {parcial && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1">Entregaste menos de lo pedido</p>
                <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo (ej. no le entraba en el freezer)"
                  className="w-full bg-white border border-[#D3D1C7] rounded-xl px-3.5 py-3 text-[15px] focus:outline-none focus:ring-1 focus:ring-accent" />
              </div>
            )}
          </>
        )}

        {paso === 2 && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => setCanal('contado')}
                className={`rounded-2xl px-2 py-4 text-white font-black text-[15px] leading-tight ${canal === 'contado' ? 'bg-[#1D9E75] ring-4 ring-[#1D9E75]/30' : 'bg-[#1D9E75]/55'}`}>
                <FileText size={18} className="mx-auto mb-1" />VENTA CONTADO<span className="block text-[11px] font-medium opacity-90">Redonhielo · factura</span>
              </button>
              <button type="button" onClick={() => setCanal('promo')}
                className={`rounded-2xl px-2 py-4 text-white font-black text-[15px] leading-tight ${canal === 'promo' ? 'bg-[#ea580c] ring-4 ring-[#ea580c]/30' : 'bg-[#ea580c]/55'}`}>
                <Tag size={18} className="mx-auto mb-1" />PROMO<span className="block text-[11px] font-medium opacity-90">Rolito · sin factura</span>
              </button>
            </div>

            {inhabilitado && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{motivoInhabilitado(empresa)}</div>
            )}

            <SelectorSucursal cliente={cliente} empresa={empresa} value={sucursal} onChange={setSucursal} />

            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 pt-1">¿Cómo paga?</p>
            <div className="space-y-2">
              {FORMAS.map((f) => {
                const bloqueada = f.id === 'cuenta_corriente' && !ctaCte.ok
                const sel = formaPago === f.id
                return (
                  <button key={f.id} type="button" disabled={bloqueada} onClick={() => setFormaPago(f.id)}
                    className={`w-full rounded-2xl border-[1.5px] px-4 py-3.5 text-left ${sel ? 'border-[#1D9E75] bg-[#E6F4EE] text-[#178760]' : 'border-[#D3D1C7] bg-white'} ${bloqueada ? 'opacity-40' : ''}`}>
                    <span className="block font-bold text-base">{f.label}</span>
                    <span className="block text-xs">{bloqueada ? 'no habilitada para este cliente' : sel && f.id === formaPagoInicial(cliente) ? 'es su condición habitual' : f.ayuda}</span>
                  </button>
                )
              })}
            </div>

            {noFacturable && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                Con {formaPago === 'contado_transferencia' ? 'transferencia' : 'efectivo'} sale factura y a este cliente no se le puede facturar: {noFacturable.join(', ')}. Elegí cuenta corriente o Promo.
              </div>
            )}
            {(sinPrecioMotivo || itemsSinPrecio.length > 0) && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                {sinPrecioMotivo ?? `Sin precio en Tango: ${itemsSinPrecio.map((i) => i.nombre).join(', ')}.`} No se puede vender hasta que se corrija.
              </div>
            )}

            <div className="rounded-2xl border border-[#D3D1C7] bg-white p-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{conIva ? 'Total con IVA' : 'Total'}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {documento === 'factura_arca' ? 'Sale factura' : tipoComprobanteInterno({ canal, formaPago: formaPago ?? 'contado_efectivo', total }) ? `Sale ${ETIQUETA_COMPROBANTE[tipoComprobanteInterno({ canal, formaPago: formaPago ?? 'contado_efectivo', total })!].toLowerCase()}` : ''}
                  {order.numeroOC ? ` · OC ${order.numeroOC}` : ''}
                </p>
                {conIva && <p className="text-[11px] text-gray-500 tabular-nums mt-0.5">Neto {money(conIva.neto)} · IVA {money(conIva.iva)}{conIva.percepcion > 0 ? ` · Perc. IIBB ${money(conIva.percepcion)}` : ''}</p>}
              </div>
              <p className="text-2xl font-black tabular-nums">{money(conIva ? conIva.total : total)}</p>
            </div>
          </>
        )}

        {paso === 3 && (
          <>
            <div className="rounded-2xl border border-[#D3D1C7] bg-white p-4 text-sm space-y-1">
              {items.map((i) => <p key={i.productoId} className="flex justify-between tabular-nums"><span>{i.cantidad} × {i.nombre}</span><span className="text-gray-500">{money(i.precioUnitario * i.cantidad)}</span></p>)}
              <p className="flex justify-between border-t border-dashed border-[#D3D1C7] pt-2 mt-1 font-bold">
                <span>{documento === 'factura_arca' ? 'Factura' : 'Remito'} · {FORMAS.find((f) => f.id === formaPago)?.label.toLowerCase()}</span>
                <span className="tabular-nums">{money(conIva ? conIva.total : total)}</span>
              </p>
            </div>
            <input value={firmante} onChange={(e) => setFirmante(e.target.value)} placeholder="Nombre de quien firma"
              className="w-full bg-white border border-[#D3D1C7] rounded-xl px-3.5 py-3 text-[15px] focus:outline-none focus:ring-1 focus:ring-accent" />
            <SignaturePad ref={firmaRef} />
            <button type="button" onClick={() => firmaRef.current?.clear()} className="text-xs text-gray-400 underline">Borrar firma</button>
          </>
        )}

        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
      </main>

      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-[#D3D1C7] p-3">
        <div className="max-w-lg mx-auto">
          {paso === 1 && <Button onClick={seguirPaso1} className="w-full h-14 text-lg font-black">SEGUIR</Button>}
          {paso === 2 && <Button onClick={seguirPaso2} className="w-full h-14 text-lg font-black">SEGUIR</Button>}
          {paso === 3 && <Button onClick={confirmar} loading={guardando} className="w-full h-14 text-lg font-black">CONFIRMAR ENTREGA</Button>}
        </div>
      </div>
    </div>
  )
}

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#F8F7F2] text-gray-900">
      <header className="bg-white border-b border-[#D3D1C7] px-4 py-3 flex items-center gap-3">
        <Link to="/chofer" aria-label="Volver" className="w-9 h-9 rounded-full bg-[#EEEDE6] flex items-center justify-center"><ArrowLeft size={18} /></Link>
        <p className="font-bold">{titulo}</p>
      </header>
      <main className="max-w-lg mx-auto p-4 space-y-3">{children}</main>
    </div>
  )
}
