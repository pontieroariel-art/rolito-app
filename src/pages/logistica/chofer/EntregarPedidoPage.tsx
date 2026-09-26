import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Mail, Minus, Pencil, Plus, Tag, FileText, Clock } from 'lucide-react'
import Button from '@/components/ui/Button'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import SelectorSucursal from '@/components/ventas/SelectorSucursal'
import SignaturePad, { SignaturePadHandle } from '@/components/heladeras/SignaturePad'
import CalculadoraCantidad from '@/components/ventas/CalculadoraCantidad'
import { useAuth } from '@/context/AuthContext'
import { useDriverOrders } from '@/hooks/useOrders'
import { useClienteSeleccionado } from '@/hooks/useClienteSeleccionado'
import { usePreciosTango } from '@/hooks/usePreciosTango'
import { useRemitosCargaChofer } from '@/hooks/useRemitosCargaChofer'
import { useDepositoDelUsuario } from '@/hooks/useDepositosReparto'
import { useCatalogo } from '@/hooks/useCatalogo'
import { useOnline } from '@/hooks/useOnline'
import { Timestamp } from 'firebase/firestore'
import { crearVentaCamion } from '@/services/ventaCamionService'
import { entregarConRemitoDeFabrica, markDelivered } from '@/services/orderService'
import { armarEntregaFabrica, esEntregaSinComprobante, renglonesFabrica } from '@/utils/entregaFabrica'
import { claveDia } from '@/utils/diaReparto'
import { asegurarReserva, consumirNumero, precargarSiSeAcerca, codigoComprobanteInterno } from '@/services/numeracionInternaService'
import { getPreciosIncluyenIva } from '@/services/arcaConfigService'
import { reportError } from '@/services/observability'
import { clienteEnSucursal, MOTIVO_SUCURSAL_INHABILITADA, necesitaSucursal, nombreSucursalVenta, sucursalInhabilitada } from '@/utils/sucursalesTango'
import { empresaDeCanal, motivoSinPrecioTango, precioTangoDe } from '@/utils/precioTango'
import { esClienteFacturable } from '@/utils/facturable'
import { admiteCuentaCorriente } from '@/utils/condicionVenta'
import { documentoDeVenta } from '@/utils/circuitoDocumento'
import { tipoComprobanteInterno, ETIQUETA_COMPROBANTE } from '@/utils/comprobanteInterno'
import { inhabilitadoEnTango, motivoInhabilitado } from '@/utils/inhabilitadoTango'
import { desgloseFactura, percepcionVigenteDe } from '@/utils/totalFacturado'
import { SIN_IMPORTE, ventaSinImporte } from '@/utils/ventaSinImporte'
import { normalizarOrdenCompra } from '@/utils/ordenCompraVenta'
import { esEntregaParcial, formaPagoInicial, renglonesDelPedido, sucursalDelPedido, type RenglonEntrega } from '@/utils/entregaPedido'
import type { CanalVenta, ComprobanteInternoVenta, FormaPago, TipoComprobanteInterno, VentaCamionItem } from '@/types'

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
  // Orden de compra (2026-09-26, pedido de los choferes: en Vender se cargaba y
  // al entregar un pedido asignado no). null = sin tocar: vale la del pedido que
  // cargó administración; el chofer la cambia o la agrega si el pedido no la trae.
  const [ordenCompra, setOrdenCompra] = useState<string | null>(null)
  // La O/C que sale en el comprobante: la que cargó el chofer o, sin tocar, la del pedido.
  const ocVenta = normalizarOrdenCompra(ordenCompra ?? order?.numeroOC)
  const [canal, setCanal] = useState<CanalVenta>('contado')
  const [formaPago, setFormaPago] = useState<FormaPago | null>(null)
  const [sucursal, setSucursal] = useState('')
  const [firmante, setFirmante] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  // El éxito lleva su propia copia del nombre del cliente (2026-09-26, auditoría del
  // chofer, A3): al entregar, un pedido de un día anterior sale de la lista y la
  // pantalla mostraba "ya no está en tus entregas" en vez del éxito.
  const [exito, setExito] = useState<{ cliente: string; documento: string | null; total: number; conIva: boolean; parcial: boolean; mail: string; sinImporte: boolean } | null>(null)
  // Entrega con remito de fábrica (Coto/Carrefour, 2026-09-23): un solo paso,
  // cantidades reales y listo. Sin venta, sin comprobante, sin mail ni Tango.
  const sinComprobante = !!order && esEntregaSinComprobante(order)
  const [exitoFabrica, setExitoFabrica] = useState<{ cliente: string; unidades: number; parcial: boolean } | null>(null)
  const [preciosIncluyenIva, setPreciosIncluyenIva] = useState(false)
  useEffect(() => { getPreciosIncluyenIva().then(setPreciosIncluyenIva).catch((err) => reportError(err, { origen: 'EntregarPedidoPage', accion: 'leer config de precios con IVA' })) }, [])

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
      asegurarReserva(tipo, user.uid, online)
        .then((activa) => setNumeracionActiva((prev) => (prev[tipo] === activa ? prev : { ...prev, [tipo]: activa })))
        .catch((err) => reportError(err, { origen: 'EntregarPedidoPage', accion: 'reservar numeración', tipo }))
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
  // Cuenta corriente: el chofer no ve importes (utils/ventaSinImporte).
  const sinImporte = ventaSinImporte(formaPago)
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
  const fijar = (i: number, n: number) =>
    setRenglones((prev) => prev && prev.map((r, k) => (k === i ? { ...r, cantidad: Math.max(0, n) } : r)))
  // Teclado numérico al tocar la cantidad (2026-09-26, pedido de los choferes:
  // con solo + y −, bajar de 100 a 50 eran 50 toques).
  const [calcIdx, setCalcIdx] = useState<number | null>(null)
  const calcRenglon = calcIdx !== null ? renglones?.[calcIdx] ?? null : null
  const unidadDe = (productoId: string | null | undefined) => catalogo.find((p) => p.id === productoId)?.unidad ?? 'u.'
  const calculadora = calcRenglon && (
    <CalculadoraCantidad
      open
      onClose={() => setCalcIdx(null)}
      producto={{ nombre: calcRenglon.nombre, unidad: unidadDe(calcRenglon.productoId) }}
      precioUnitario={0}
      mostrarPrecio={false}
      ayuda={`Pedido: ${calcRenglon.pedido}`}
      cantidadActual={calcRenglon.cantidad}
      onConfirm={(n) => { if (calcIdx !== null) fijar(calcIdx, n) }}
    />
  )

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
    if (sucursalInhabilitada(cliente, empresa, sucursal)) { setError(MOTIVO_SUCURSAL_INHABILITADA); return }
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
        try { comprobanteInterno = { tipo: tipoInterno, ...consumirNumero(tipoInterno, user.uid) } }
        catch (err) { reportError(err, { origen: 'EntregarPedidoPage', accion: 'consumirNumero', tipo: tipoInterno, uid: user.uid }) }   // sale sin número, pero se sabe
      }
      // La venta (remito / factura) y el pedido entregado salen juntos; las dos
      // escrituras se encolan sin señal y suben solas.
      crearVentaCamion(
        {
          canal, cliente: clienteVenta, items, formaPago, firmaCliente: firma, firmanteNombre: firmante, comprobanteInterno,
          pedidoId: order.id, ordenCompra: ocVenta, idFijo: `pedido_${order.id}`,
          clienteSucursalNombre: nombreSucursalVenta(cliente, empresa, clienteVenta.codigoTango),
        },
        {
          uid: user.uid, nombre: user.nombre, camionId: camionIdHoy,
          ...(remitosCarga[0] ? { remitoId: remitosCarga[0].id, remitoCodigo: remitosCarga[0].codigo } : {}),
          ...depositoVenta,
        },
      )
      if (tipoInterno) precargarSiSeAcerca(tipoInterno, user.uid, online)
      const entregados = renglones.map((r) => ({ name: r.nombre, quantity: r.cantidad, ...(r.productoId ? { productoId: r.productoId } : {}) }))
      markDelivered(order.id, entregados, parcial, nota.trim(), { uid: user.uid, nombre: user.nombre })
        .catch((err) => reportError(err, { origen: 'EntregarPedidoPage', accion: 'markDelivered', orderId: order.id }))
      setExito({
        cliente: order.clientName,
        documento: tipoInterno ? `${ETIQUETA_COMPROBANTE[tipoInterno]} ${comprobanteInterno ? codigoComprobanteInterno(comprobanteInterno) : 'sin número'}` : null,
        total: conIva?.total ?? total, conIva: conIva !== null, parcial, mail: cliente.email && !cliente.email.endsWith('@rolito.app') ? cliente.email : '',
        sinImporte,
      })
    } catch (err) {
      reportError(err, { origen: 'EntregarPedidoPage', accion: 'confirmar' })
      setError('No se pudo registrar la entrega. Intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const confirmarFabrica = async () => {
    if (!user || !order || !renglones) return
    setError('')
    const entregados = renglones.map((r) => ({ name: r.nombre, quantity: r.cantidad, ...(r.productoId ? { productoId: r.productoId } : {}) }))
    const conCatalogo = renglonesFabrica(entregados)
    if (conCatalogo.length === 0) { setError('No hay nada para entregar. Si no pudiste entregar, volvé y tocá "No entregado".'); return }
    if (parcial && !nota.trim()) { setError('Contá por qué entregaste menos de lo pedido.'); return }
    setGuardando(true)
    try {
      const entrega = armarEntregaFabrica(entregados, { uid: user.uid, nombre: user.nombre, camionId: camionIdHoy || null }, remitosCarga[0] ?? null, Timestamp.now(), claveDia(new Date()))
      // Sin señal el write queda encolado y la entrega igual figura registrada.
      entregarConRemitoDeFabrica(order.id, entregados, parcial, nota.trim(), entrega, { uid: user.uid, nombre: user.nombre })
        .catch((err) => reportError(err, { origen: 'EntregarPedidoPage', accion: 'entregarConRemitoDeFabrica', orderId: order.id }))
      setExitoFabrica({ cliente: order.clientName, unidades: conCatalogo.reduce((s, r) => s + r.cantidad, 0), parcial })
    } catch (err) {
      reportError(err, { origen: 'EntregarPedidoPage', accion: 'confirmarFabrica' })
      setError('No se pudo registrar la entrega. Intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  // ── Pantalla de éxito (remito de fábrica) ──────────────────────────────────
  if (exitoFabrica) {
    return (
      <div className="min-h-dvh bg-[#F8F7F2] text-gray-900 flex flex-col">
        <main className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto w-full">
          <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center mb-4">
            <CheckCircle2 size={48} className="text-success" strokeWidth={2.2} />
          </div>
          <h2 className="text-2xl font-black">¡Entrega registrada!</h2>
          <p className="text-secundario mt-1">{exitoFabrica.cliente}</p>
          <p className="text-3xl font-black tabular-nums mt-3">{exitoFabrica.unidades} u.</p>
          <div className="mt-5 w-full rounded-2xl border border-[#D3D1C7] bg-white p-4 text-left text-sm space-y-2">
            <p className="flex gap-2"><span className="text-success font-bold">✓</span> Pedido entregado{exitoFabrica.parcial ? ' (parcial)' : ''}</p>
            <p className="flex gap-2"><FileText size={16} className="text-secundario shrink-0 mt-0.5" /> Con remito de fábrica: no sale comprobante de la app.</p>
            <p className="flex gap-2"><span className="text-success font-bold">✓</span> Descontado del camión para la liquidación.</p>
          </div>
          <Button onClick={() => navigate('/chofer')} className="mt-6 w-full h-14 text-base">Volver a mis entregas</Button>
        </main>
      </div>
    )
  }

  // ── Pantalla de éxito ──────────────────────────────────────────────────────
  if (exito) {
    return (
      <div className="min-h-dvh bg-[#F8F7F2] text-gray-900 flex flex-col">
        <main className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto w-full">
          <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center mb-4">
            <CheckCircle2 size={48} className="text-success" strokeWidth={2.2} />
          </div>
          <h2 className="text-2xl font-black">¡Entrega registrada!</h2>
          <p className="text-secundario mt-1">{exito.cliente}</p>
          <p className="text-3xl font-black tabular-nums mt-3">{exito.sinImporte ? 'Cuenta corriente' : money(exito.total)}</p>
          {exito.conIva && !exito.sinImporte && <p className="text-xs text-secundario mt-0.5">IVA incluido, como sale en la factura</p>}
          <div className="mt-5 w-full rounded-2xl border border-[#D3D1C7] bg-white p-4 text-left text-sm space-y-2">
            <p className="flex gap-2"><span className="text-success font-bold">✓</span> Pedido entregado{exito.parcial ? ' (parcial)' : ''}</p>
            <p className="flex gap-2"><span className="text-success font-bold">✓</span> {exito.documento ? `${exito.documento}${ocVenta ? ` · OC ${ocVenta}` : ''}` : 'Factura en camino: la ves en Mis ventas'}</p>
            <p className="flex gap-2"><Mail size={16} className="text-success shrink-0 mt-0.5" /> {exito.mail ? `El comprobante se manda solo a ${exito.mail}` : 'El cliente no tiene mail en Tango: entregale el papel desde Mis ventas'}</p>
            <p className="flex gap-2"><Clock size={16} className="text-amber-600 shrink-0 mt-0.5" /> Tango: en camino</p>
          </div>
          <Button onClick={() => navigate('/chofer/ventas')} className="mt-6 w-full h-14 text-base">Ver el comprobante</Button>
          <Link to="/chofer" className="mt-3 text-sm text-secundario underline">Volver a mis entregas</Link>
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
  // Un pedido ya entregado o cancelado no se vuelve a entregar (2026-09-26,
  // auditoría del chofer, C2): volviendo atrás desde "Ver el comprobante" se
  // podía recorrer de nuevo y salía otra venta con su comprobante, Tango y stock.
  if (order.status === 'entregado' || order.status === 'cancelado') {
    return (
      <Marco titulo={order.clientName}>
        <p className="text-base font-semibold text-gray-900">
          {order.status === 'entregado' ? 'Este pedido ya está entregado.' : 'Este pedido está cancelado.'}
        </p>
        <p className="text-sm text-gray-600">
          {order.status === 'entregado'
            ? 'El comprobante está en Mis ventas. Si hay que corregir algo, anulalo desde ahí o pedíselo a la oficina.'
            : 'Si el cliente igual quiere hielo, hacé la venta desde Vender.'}
        </p>
        <div className="flex flex-col gap-2 pt-1">
          {order.status === 'entregado' && <Link to="/chofer/ventas" className="text-sm text-accent underline">Ver en Mis ventas</Link>}
          <Link to="/chofer" className="text-sm text-accent underline">Volver a mis entregas</Link>
        </div>
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

  if (sinComprobante) {
    return (
      <div className="min-h-dvh bg-[#F8F7F2] text-gray-900 pb-28">
        <header className="sticky top-0 z-10 bg-white border-b border-[#D3D1C7] px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => navigate('/chofer')} aria-label="Volver"
            className="w-9 h-9 rounded-full bg-[#EEEDE6] flex items-center justify-center"><ArrowLeft size={18} /></button>
          <div className="min-w-0">
            <p className="font-bold leading-tight truncate">{order.clientName}</p>
            <p className="text-xs text-secundario">Entrega con remito de fábrica</p>
          </div>
        </header>

        <main className="max-w-lg mx-auto p-4 space-y-3">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
            <FileText size={18} className="shrink-0 mt-0.5" />
            <p>Este cliente recibe con el remito que imprimió la oficina. No sale comprobante de la app: solo cargá <b>lo que bajaste del camión</b>.</p>
          </div>
          <div className="rounded-2xl border border-[#D3D1C7] bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-secundario mb-1">¿Qué bajaste?</p>
            {renglones.map((r, i) => (
              <FilaCantidad key={`${r.productoId}-${i}`} nombre={r.nombre} pedido={r.pedido} sinCatalogo={!r.productoId} cantidad={r.cantidad} onMenos={() => cambiar(i, -1)} onMas={() => cambiar(i, +1)} onTocar={() => setCalcIdx(i)} />
            ))}
          </div>
          {sinCatalogo.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {sinCatalogo.map((r) => r.nombre).join(', ')}: no lo reconozco en el catálogo, no va a descontar del camión. Avisá a la oficina.
            </p>
          )}
          {parcial && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-1">Bajaste menos de lo pedido</p>
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo (ej. rechazaron un pallet)"
                className="w-full bg-white border border-[#D3D1C7] rounded-xl px-3.5 py-3 text-[15px] focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          )}
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
          {calculadora}
        </main>

        <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-[#D3D1C7] p-3">
          <div className="max-w-lg mx-auto">
            <Button onClick={confirmarFabrica} loading={guardando} className="w-full h-14 text-lg font-black">CONFIRMAR ENTREGA</Button>
          </div>
        </div>
      </div>
    )
  }

  const subtitulo = ['Cantidades', 'Venta y pago', 'Firma'][paso - 1]

  return (
    <div className="min-h-dvh bg-[#F8F7F2] text-gray-900 pb-28">
      <header className="sticky top-0 z-10 bg-white border-b border-[#D3D1C7] px-4 py-3 flex items-center gap-3">
        <button type="button" onClick={() => (paso === 1 ? navigate('/chofer') : setPaso((p) => (p - 1) as Paso))} aria-label="Volver"
          className="w-9 h-9 rounded-full bg-[#EEEDE6] flex items-center justify-center"><ArrowLeft size={18} /></button>
        <div className="min-w-0">
          <p className="font-bold leading-tight truncate">{order.clientName}</p>
          <p className="text-xs text-secundario">Paso {paso} de 3 · {subtitulo}</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-3">
        <div className="grid grid-cols-3 gap-1.5">
          {[1, 2, 3].map((p) => <i key={p} className={`h-1.5 rounded-full ${p <= paso ? 'bg-[#1D9E75]' : 'bg-[#DCDAD1]'}`} />)}
        </div>

        {paso === 1 && (
          <>
            {calculadora}
            <div className="rounded-2xl border border-[#D3D1C7] bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-secundario mb-1">¿Qué entregaste?</p>
              {renglones.map((r, i) => (
                <FilaCantidad key={`${r.productoId}-${i}`} nombre={r.nombre} pedido={r.pedido} sinCatalogo={!r.productoId} cantidad={r.cantidad} onMenos={() => cambiar(i, -1)} onMas={() => cambiar(i, +1)} onTocar={() => setCalcIdx(i)} />
              ))}
            </div>
            {sinCatalogo.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {sinCatalogo.map((r) => r.nombre).join(', ')}: no lo reconozco en el catálogo, no va a salir en el remito. Avisá a la oficina.
              </p>
            )}
            {parcial && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-1">Entregaste menos de lo pedido</p>
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

            <p className="text-xs font-bold uppercase tracking-wide text-secundario pt-1">¿Cómo paga?</p>
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

            <div className="space-y-1.5 pt-1">
              <label htmlFor="oc-entrega" className="text-xs font-bold uppercase tracking-wide text-secundario">Orden de compra del cliente</label>
              <input id="oc-entrega" value={ordenCompra ?? order.numeroOC ?? ''} onChange={(e) => setOrdenCompra(e.target.value)}
                placeholder="Nº de OC (si el cliente la pide)" maxLength={40} autoComplete="off" enterKeyHint="done"
                className="w-full h-12 bg-white border border-[#D3D1C7] rounded-xl px-3.5 text-base focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent placeholder-gray-400" />
              {order.numeroOC && (ordenCompra === null || ordenCompra === order.numeroOC) && (
                <p className="text-xs text-secundario">Viene del pedido cargado por administración. Si el cliente te da otra, cambiala.</p>
              )}
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
                <p className="text-xs font-bold uppercase tracking-wide text-secundario">{sinImporte ? SIN_IMPORTE : conIva ? 'Total con IVA' : 'Total'}</p>
                <p className="text-xs text-secundario mt-0.5">
                  {documento === 'factura_arca' ? 'Sale factura' : tipoComprobanteInterno({ canal, formaPago: formaPago ?? 'contado_efectivo', total }) ? `Sale ${ETIQUETA_COMPROBANTE[tipoComprobanteInterno({ canal, formaPago: formaPago ?? 'contado_efectivo', total })!].toLowerCase()}` : ''}
                  {ocVenta ? ` · OC ${ocVenta}` : ''}
                </p>
                {conIva && !sinImporte && <p className="text-[11px] text-secundario tabular-nums mt-0.5">Neto {money(conIva.neto)} · IVA {money(conIva.iva)}{conIva.percepcion > 0 ? ` · Perc. IIBB ${money(conIva.percepcion)}` : ''}</p>}
              </div>
              <p className="shrink-0 whitespace-nowrap text-2xl font-black tabular-nums">{sinImporte ? `${items.reduce((s, i) => s + i.cantidad, 0)} u.` : money(conIva ? conIva.total : total)}</p>
            </div>
          </>
        )}

        {paso === 3 && (
          <>
            <div className="rounded-2xl border border-[#D3D1C7] bg-white p-4 text-sm space-y-1">
              {items.map((i) => <p key={i.productoId} className="flex justify-between tabular-nums"><span>{i.cantidad} × {i.nombre}</span>{!sinImporte && <span className="text-secundario">{money(i.precioUnitario * i.cantidad)}</span>}</p>)}
              <p className="flex justify-between border-t border-dashed border-[#D3D1C7] pt-2 mt-1 font-bold">
                <span>{documento === 'factura_arca' ? 'Factura' : 'Remito'} · {FORMAS.find((f) => f.id === formaPago)?.label.toLowerCase()}</span>
                <span className="tabular-nums">{sinImporte ? `${items.reduce((s, i) => s + i.cantidad, 0)} u.` : money(conIva ? conIva.total : total)}</span>
              </p>
            </div>
            <input value={firmante} onChange={(e) => setFirmante(e.target.value)} placeholder="Nombre de quien firma"
              className="w-full bg-white border border-[#D3D1C7] rounded-xl px-3.5 py-3 text-[15px] focus:outline-none focus:ring-1 focus:ring-accent" />
            <SignaturePad ref={firmaRef} />
            <button type="button" onClick={() => firmaRef.current?.clear()} className="text-xs text-secundario underline">Borrar firma</button>
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

// Un renglón del pedido en dos pisos (2026-09-26): arriba el producto y lo
// pedido, abajo − · cantidad · + a todo el ancho, 56 px de alto, para tocar con
// el camión en marcha y con guantes. El número es un botón que abre el teclado
// para tipear lo entregado (pedido de los choferes: bajar de 100 a 50 eran 50
// toques del −); − y + quedan para ajustar de a uno.
function FilaCantidad({ nombre, pedido, sinCatalogo, cantidad, onMenos, onMas, onTocar }: {
  nombre: string; pedido: number; sinCatalogo: boolean; cantidad: number
  onMenos: () => void; onMas: () => void; onTocar: () => void
}) {
  const distinto = cantidad !== pedido
  return (
    <div className="py-3 border-t first:border-t-0 border-[#EEEDE6] flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 font-bold text-base leading-tight">{nombre}{sinCatalogo && <span className="block text-xs font-normal text-amber-700">no está en el catálogo</span>}</p>
        <p className="shrink-0 text-sm text-secundario tabular-nums">Pedido <b className="text-gray-900">{pedido}</b></p>
      </div>
      <div className="grid grid-cols-[56px_1fr_56px] gap-2">
        <button type="button" onClick={onMenos} aria-label="Uno menos" className="h-14 rounded-xl border border-[#D3D1C7] bg-white active:scale-95 touch-manipulation"><Minus size={22} className="mx-auto" /></button>
        <button type="button" onClick={onTocar} aria-label={`Entregado ${cantidad}. Tocá para escribir la cantidad`}
          className={`h-14 rounded-xl border-2 flex items-center justify-center gap-2 active:scale-[0.98] touch-manipulation ${distinto ? 'border-amber-400 bg-amber-50' : 'border-[#1D9E75]/40 bg-[#F4FBF8]'}`}>
          <span className="text-3xl font-black tabular-nums text-gray-900">{cantidad}</span>
          <Pencil size={16} className="text-secundario" />
        </button>
        <button type="button" onClick={onMas} aria-label="Uno más" className="h-14 rounded-xl border border-[#D3D1C7] bg-white active:scale-95 touch-manipulation"><Plus size={22} className="mx-auto" /></button>
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
