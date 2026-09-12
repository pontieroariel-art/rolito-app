import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, CheckCircle2, FileDown, Landmark, Plus, ReceiptText, RefreshCw, Share2, Trash2 } from 'lucide-react'
import ChequeForm from '@/components/supervisor/ChequeForm'
import RetencionForm, { RETENCION_LABELS } from '@/components/supervisor/RetencionForm'
import { entregarReciboSupervisor } from '@/components/supervisor/CobranzaSupervisorCard'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ClienteCombobox, { indexAComboItems } from '@/components/ui/ClienteCombobox'
import { useAuth } from '@/context/AuthContext'
import { useOnline } from '@/hooks/useOnline'
import { useClientesIndex } from '@/hooks/useClientesIndex'
import { useClienteSeleccionado } from '@/hooks/useClienteSeleccionado'
import { useSaldoClienteEnVivo } from '@/hooks/useSaldoClienteEnVivo'
import { useDepositoDelUsuario } from '@/hooks/useDepositosReparto'
import { crearCobranzaCompleta, type OrigenCobranzaCompleta } from '@/services/cobranzaService'
import {
  asegurarReserva, codigoRecibo, consumirNumero, precargarSiSeAcerca,
} from '@/services/reciboSupervisorService'
import { puedeCompartirArchivos } from '@/utils/compartir'
import { aCentavos, formatoARS, parseImporte, sumaCentavos } from '@/utils/money'
import { haceCuanto } from '@/pages/comercial/supervisor/SupervisorClientesPage'
import { EMPRESAS_TANGO, NOMBRE_EMPRESA, estaVinculadoATango, tangoIdsDe } from '@/utils/tangoEmpresas'
import { agruparPorEmpresaYCodigo, claveComp, empresaDe, grupoDe, mismoGrupo, type GrupoRecibo } from '@/utils/composicionSaldos'
import { nombreSucursal } from '@/utils/sucursalesTango'
import { AplicacionACuenta, ChequeRecibido, Cobranza, ComprobanteSaldoTango, EmpresaTango, ImputacionFactura, PlantaId, RetencionRecibida } from '@/types'

const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

// Estado de edición de una fila de la composición de saldos: si está marcada
// para cobrar y con cuánto (default: el saldo completo de la factura).
interface FilaImputacion {
  seleccionada: boolean
  importeStr:   string
}

// Un recibo = UNA empresa y UN código de cliente (en Tango es una base y un
// talonario distintos; decisión de Ariel 2026-09-06: "si es de Rolito que sea
// de Rolito, si no los saldos no quedan bien"). La agrupación por empresa y
// código vive en utils/composicionSaldos.ts (la comparten la ficha y el PDF).

export interface CobranzaCompletaProps {
  /** Quién cobra: supervisor en la calle, caja en el mostrador o chofer en el camión. */
  origen:     OrigenCobranzaCompleta
  plantaId?:  PlantaId          // solo caja
  /** Cliente preseleccionado (p. ej. desde "Clientes con deuda"). */
  clienteInicial?: string
  /** A dónde vuelve el link "Volver al inicio" de la pantalla de éxito. */
  volverA:    string
  /** Ancho del contenido: el supervisor y el chofer son mobile (max-w-md); caja es una PC. */
  ancho?:     'md' | '3xl'
}

// Cobranza COMPLETA de cuenta corriente — la misma para supervisor, ventanilla
// y chofer (decisión de Ariel 2026-09-05: "todos tienen la opción de realizar
// una cobranza"): composición de saldos de Tango → imputación por factura
// (total o parcial) → medios de pago (efectivo / transferencia / cheques /
// retenciones) → recibo numerado (una sola serie RS- para toda la empresa,
// que en Tango entra por el talonario 1106/1108) → cola tango-outbox.
export default function CobranzaCompleta({ origen, plantaId, clienteInicial, volverA, ancho = 'md' }: CobranzaCompletaProps) {
  const { user } = useAuth()
  const online = useOnline()
  // Búsqueda con el índice liviano (2026-09-10); la ficha completa se baja al elegir.
  const { clientes, loading: loadingClientes } = useClientesIndex()

  const [clienteId, setClienteId] = useState(clienteInicial ?? '')
  const [filas, setFilas] = useState<Record<string, FilaImputacion>>({})
  const [efectivoStr, setEfectivoStr] = useState('')
  const [transferenciaStr, setTransferenciaStr] = useState('')
  const [cheques, setCheques] = useState<ChequeRecibido[]>([])
  const [retenciones, setRetenciones] = useState<RetencionRecibida[]>([])
  // Pago a cuenta sin factura imputada (2026-09-08): en qué empresa y código queda el saldo a favor.
  const [grupoACuenta, setGrupoACuenta] = useState<GrupoRecibo | null>(null)
  const [modal, setModal] = useState<'cheque' | 'retencion' | 'confirmar' | null>(null)
  const [exito, setExito] = useState<Cobranza | null>(null)
  const [avisoRecibo, setAvisoRecibo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [numeracionActiva, setNumeracionActiva] = useState(false)

  // Solo clientes vinculados a Tango (en cualquiera de las dos empresas) pueden cobrarse con imputación.
  const itemsTango = useMemo(() => indexAComboItems(clientes.filter((c) => c.vinculadoTango)), [clientes])
  const { cliente: clienteCargado, loading: cargandoCliente } = useClienteSeleccionado(clienteId || null)
  const cliente = useMemo(() => (clienteCargado && estaVinculadoATango(clienteCargado) ? clienteCargado : null), [clienteCargado])

  const actor = useMemo(
    () => (user ? { uid: user.uid, nombre: user.nombre } : null),
    [user],
  )
  const { deposito: depositoUsuario } = useDepositoDelUsuario(user?.uid)
  const { saldo, cargando: cargandoSaldo, refrescando, esCache, frescas } = useSaldoClienteEnVivo(cliente, actor)

  // Reserva de números de recibo para poder emitir sin señal (chofer y
  // supervisor). Si el contador no está inicializado, los recibos salen sin
  // número y el cobro no se bloquea nunca.
  useEffect(() => {
    if (!user) return
    asegurarReserva(user.uid, online).then(setNumeracionActiva)
    // online a propósito: si vuelve la señal, reintenta la reserva.
  }, [user, online])

  // Al cambiar de cliente se resetea todo el armado del recibo.
  useEffect(() => {
    setFilas({})
    setEfectivoStr('')
    setTransferenciaStr('')
    setCheques([])
    setRetenciones([])
    setGrupoACuenta(null)
    setError('')
  }, [clienteId])

  const comprobantes = useMemo(() => saldo?.comprobantes ?? [], [saldo])

  // Bloques por empresa (y dentro por código si el CUIT tiene varios): cada
  // bloque es un recibo posible; al tildar una factura, los demás se apagan.
  const bloques = useMemo(() => agruparPorEmpresaYCodigo(comprobantes), [comprobantes])
  const variosCodigos = (empresa: EmpresaTango) => bloques.filter((b) => b.grupo.empresa === empresa).length > 1

  const grupoSeleccionado: GrupoRecibo | null = useMemo(() => {
    const c = comprobantes.find((x) => filas[claveComp(x)]?.seleccionada)
    return c ? grupoDe(c) : null
  }, [comprobantes, filas])

  // Dónde puede quedar un pago a cuenta: cada código del cliente en cada empresa.
  const gruposPosibles: GrupoRecibo[] = useMemo(() => {
    const ids = tangoIdsDe(cliente)
    return EMPRESAS_TANGO.flatMap((empresa) => (ids[empresa] ?? []).map((x) => ({ empresa, codigo: x.codigo })))
  }, [cliente])
  // Con un solo código no hay nada que elegir.
  useEffect(() => {
    if (!grupoACuenta && gruposPosibles.length === 1) setGrupoACuenta(gruposPosibles[0])
  }, [gruposPosibles, grupoACuenta])
  // El grupo del recibo: el de las facturas marcadas o, sin facturas, el elegido para el a cuenta.
  const grupoRecibo: GrupoRecibo | null = grupoSeleccionado ?? grupoACuenta

  // Saldo a favor (recibos a cuenta ya en Tango) que se aplica a las facturas de este recibo:
  // se marca como una factura más, pero suma del lado de los valores (etapa 2, 2026-09-08).
  const aplicaciones: AplicacionACuenta[] = useMemo(() => {
    return comprobantes
      .filter((c) => c.saldoPendiente < 0 && filas[claveComp(c)]?.seleccionada)
      .map((c) => ({
        reciboNumero: c.numero,
        ...(typeof c.idComprobanteTango === 'number' ? { idReciboTango: c.idComprobanteTango } : {}),
        importe: parseImporte(filas[claveComp(c)].importeStr),
      }))
  }, [comprobantes, filas])
  const aplicadoCent = sumaCentavos(aplicaciones.map((a) => a.importe))
  const aplicacionInvalida = comprobantes.some((c) => c.saldoPendiente < 0 && filas[claveComp(c)]?.seleccionada
    && (aCentavos(parseImporte(filas[claveComp(c)].importeStr)) <= 0 || aCentavos(parseImporte(filas[claveComp(c)].importeStr)) > -aCentavos(c.saldoPendiente)))

  const imputaciones: ImputacionFactura[] = useMemo(() => {
    return comprobantes
      .filter((c) => c.saldoPendiente > 0 && filas[claveComp(c)]?.seleccionada)
      .map((c) => ({
        comprobanteTipo:   c.tipo,
        comprobanteNumero: c.numero,
        ...(typeof c.idComprobanteTango === 'number' ? { idComprobanteTango: c.idComprobanteTango } : {}),
        saldoAlMomento:    c.saldoPendiente,
        importeImputado:   parseImporte(filas[claveComp(c)].importeStr),
      }))
  }, [comprobantes, filas])

  const totalImputadoCent = sumaCentavos(imputaciones.map((i) => i.importeImputado))
  const totalMediosCent =
    aCentavos(parseImporte(efectivoStr)) +
    aCentavos(parseImporte(transferenciaStr)) +
    sumaCentavos(cheques.map((c) => c.importe)) +
    sumaCentavos(retenciones.map((r) => r.importe)) +
    aplicadoCent
  // Lo imputado nunca supera los valores; si sobran valores, la diferencia queda A CUENTA
  // del cliente (decisión de Ariel 2026-09-08: siempre, cualquier medio, también choferes).
  const faltanCent  = Math.max(0, totalImputadoCent - totalMediosCent)
  const aCuentaCent = Math.max(0, totalMediosCent - totalImputadoCent)
  // Usar saldo a favor y a la vez dejar plata a cuenta no tiene sentido (y en Tango no cierra).
  const mezclaACuenta = aplicadoCent > 0 && aCuentaCent > 0
  const seccionValores = imputaciones.length > 0 || aplicaciones.length > 0 || !!grupoACuenta

  // Facturas del mismo grupo que quedan sin marcar mientras sobra plata: se avisa, no se frena.
  const sinImputar = useMemo(() => {
    if (!grupoRecibo || aCuentaCent === 0) return []
    return comprobantes.filter((c) => c.saldoPendiente > 0 && mismoGrupo(grupoDe(c), grupoRecibo) && !filas[claveComp(c)]?.seleccionada)
  }, [comprobantes, filas, grupoRecibo, aCuentaCent])

  const imputacionInvalida = imputaciones.some(
    (i) => aCentavos(i.importeImputado) <= 0 || aCentavos(i.importeImputado) > aCentavos(i.saldoAlMomento),
  )

  const toggleFila = (c: ComprobanteSaldoTango) => {
    const clave = claveComp(c)
    if (c.saldoPendiente === 0) return
    // Saldo a favor: solo se puede aplicar si el recibo ya está en Tango (trae su ID).
    if (c.saldoPendiente < 0 && typeof c.idComprobanteTango !== 'number') {
      setError('Ese saldo a favor todavía no está confirmado en Tango: se puede usar cuando entre.')
      return
    }
    if (grupoSeleccionado && !mismoGrupo(grupoSeleccionado, grupoDe(c))) {
      setError(`Un recibo cobra facturas de una sola empresa${variosCodigos(empresaDe(c)) ? ' y un solo código de cliente' : ''}. Emití este recibo y después hacé otro para ${NOMBRE_EMPRESA[empresaDe(c)]}.`)
      return
    }
    setError('')
    setFilas((prev) => {
      const actual = prev[clave]
      if (actual?.seleccionada) return { ...prev, [clave]: { ...actual, seleccionada: false } }
      return { ...prev, [clave]: { seleccionada: true, importeStr: actual?.importeStr || String(Math.abs(c.saldoPendiente)).replace('.', ',') } }
    })
  }

  const abrirConfirmacion = () => {
    setError('')
    if (!cliente)                 { setError('Elegí el cliente que paga.'); return }
    if (!grupoRecibo)             { setError('Marcá al menos una factura a cobrar, o elegí en qué empresa queda a cuenta.'); return }
    if (imputacionInvalida)       { setError('Hay una imputación en cero o mayor al saldo de la factura.'); return }
    if (aplicacionInvalida)       { setError('Hay un saldo a favor aplicado en cero o mayor al disponible.'); return }
    if (totalMediosCent === 0)    { setError('Cargá al menos un medio de pago.'); return }
    if (faltanCent > 0)           { setError(`Faltan ${formatoARS(faltanCent / 100)} en valores para cubrir lo imputado.`); return }
    if (mezclaACuenta)            { setError('Estás usando saldo a favor y dejando plata a cuenta a la vez. Bajá el saldo aplicado o marcá más facturas.'); return }
    setModal('confirmar')
  }

  const confirmar = async () => {
    if (!user || !cliente || !saldo || !grupoRecibo) return
    setGuardando(true)
    try {
      // Con numeración activa consume un número de la reserva local; si justo
      // se agotó (carrera), el recibo sale sin número antes que bloquear.
      let numeroRecibo: string | undefined
      if (numeracionActiva) {
        try { numeroRecibo = codigoRecibo(consumirNumero(user.uid)) } catch { /* sin número */ }
      }
      const cobranza = await crearCobranzaCompleta(
        {
          clienteId:     cliente.uid,
          // Con varias sucursales, el recibo dice cuál ("RAZON SOCIAL — sucursal · dirección").
          clienteNombre: (cliente.razonSocial || cliente.nombre) + (nombreSucursal(cliente, grupoRecibo.empresa, grupoRecibo.codigo) ? ` — ${nombreSucursal(cliente, grupoRecibo.empresa, grupoRecibo.codigo)}` : ''),
          empresa:       grupoRecibo.empresa,
          ...(grupoRecibo.codigo ? { codigoTango: grupoRecibo.codigo } : {}),
          numeroRecibo,
          imputaciones,
          medios: {
            efectivo:      parseImporte(efectivoStr),
            transferencia: parseImporte(transferenciaStr),
            cheques,
            retenciones,
            ...(aplicaciones.length ? { aCuentaAplicado: aplicaciones } : {}),
          },
        },
        { uid: user.uid, nombre: user.nombre, ...(depositoUsuario ? { depositoTango: depositoUsuario.codigo } : {}) },
        { origen, plantaId },
      )
      if (numeracionActiva) precargarSiSeAcerca(user.uid, online)
      setExito(cobranza)
      setModal(null)
      setClienteId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la cobranza. Intentá de nuevo.')
      setModal(null)
    } finally {
      setGuardando(false)
    }
  }

  const entregarRecibo = async (c: Cobranza, compartir: boolean) => {
    setAvisoRecibo('')
    setAvisoRecibo(await entregarReciboSupervisor(c, compartir))
  }

  const anchoClase = ancho === '3xl' ? 'max-w-3xl' : 'max-w-md'

  if (loadingClientes) return <LoadingSpinner />

  if (exito) {
    return (
      <div className={`${anchoClase} mx-auto p-4 pt-10 text-center space-y-4`}>
        <CheckCircle2 size={48} className="text-accent mx-auto" />
        <div>
          <p className="text-lg font-semibold text-gray-900">Cobranza registrada</p>
          <p className="text-sm text-gray-600 mt-1">{exito.numeroRecibo ? `Recibo ${exito.numeroRecibo} — ` : ''}{formatoARS(exito.importe)} — {exito.clienteNombre}</p>
          {exito.aCuenta ? <p className="text-sm text-amber-700 mt-1">{formatoARS(exito.aCuenta)} quedan a cuenta del cliente (saldo a favor).</p> : null}
          <p className="text-xs text-gray-500 mt-2">Queda encolada para impactar en la cuenta corriente de Tango.</p>
        </div>
        <div className="flex flex-col gap-2 pt-2 max-w-md mx-auto">
          <Button onClick={() => entregarRecibo(exito, true)} className="w-full">
            <Share2 size={16} className="mr-2" /> {puedeCompartirArchivos() ? 'Enviar recibo (WhatsApp, mail…)' : 'Enviar recibo'}
          </Button>
          <Button variant="outline" onClick={() => entregarRecibo(exito, false)} className="w-full">
            <FileDown size={16} className="mr-2" /> {origen === 'caja' ? 'Descargar / imprimir recibo' : 'Descargar recibo PDF'}
          </Button>
          {avisoRecibo && <p className="text-xs text-gray-500">{avisoRecibo}</p>}
          <Button variant="outline" onClick={() => setExito(null)} className="w-full">Registrar otra cobranza</Button>
          <Link to={volverA} className="text-sm text-gray-500 hover:text-accent">Volver al inicio</Link>
        </div>
      </div>
    )
  }

  return (
    <div className={`${anchoClase} mx-auto p-4 space-y-4 pb-8`}>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Cliente</label>
        <ClienteCombobox items={itemsTango} value={clienteId} onChange={setClienteId} placeholder="Buscar cliente…" />
        {clienteId && cargandoCliente && <p className="text-xs text-gray-400 mt-1">Cargando la ficha del cliente…</p>}
      </div>

      {cliente && (
        <>
          {/* ── Composición de saldos ── */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Facturas pendientes</h2>
              {refrescando ? (
                <span className="flex items-center gap-1 text-xs text-gray-400"><RefreshCw size={12} className="animate-spin" /> Consultando Tango…</span>
              ) : saldo ? (
                <span className="text-xs text-gray-400">{esCache ? `Cache · ${haceCuanto(saldo.actualizadoEn)}` : 'Al día con Tango'}</span>
              ) : null}
            </div>

            {cargandoSaldo ? (
              <p className="text-sm text-gray-500 text-center py-4">Cargando saldo…</p>
            ) : comprobantes.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 text-center">
                <p className="text-sm text-gray-600">Este cliente no tiene facturas pendientes en el cache de Tango.</p>
                <p className="text-xs text-gray-400 mt-1">Si te adelanta plata sin factura, cobrala a cuenta acá abajo.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {bloques.map(({ grupo, comprobantes: lista, subtotal }) => {
                  const apagado = !!grupoSeleccionado && !mismoGrupo(grupoSeleccionado, grupo)
                  const rama = saldo?.porEmpresa?.[grupo.empresa]
                  const frescaEmpresa = frescas.includes(grupo.empresa)
                  return (
                  <div key={`${grupo.empresa}|${grupo.codigo}`} className={apagado ? 'opacity-50' : ''}>
                    <div className="flex items-baseline justify-between mb-1.5 px-0.5">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {NOMBRE_EMPRESA[grupo.empresa]}
                          {(variosCodigos(grupo.empresa) || grupo.codigo) && <span className="text-xs font-normal text-gray-500"> · cód. {grupo.codigo || '—'}</span>}
                        </p>
                        {/* Sucursal del código (cuentas con varias: Rappi, Coto…), para saber a quién se le está cobrando. */}
                        {nombreSucursal(cliente, grupo.empresa, grupo.codigo) && (
                          <p className="text-xs text-gray-500">{nombreSucursal(cliente, grupo.empresa, grupo.codigo)}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">{formatoARS(subtotal)}</p>
                        {rama?.actualizadoEn && !frescaEmpresa && <p className="text-[10px] text-gray-400">{haceCuanto(rama.actualizadoEn)}</p>}
                      </div>
                    </div>
                    {apagado && <p className="text-[11px] text-gray-500 mb-1.5 px-0.5">Se cobra en otro recibo: un recibo por empresa.</p>}
                    <div className="space-y-2">
                {lista.map((c) => {
                  const clave = claveComp(c)
                  const fila = filas[clave]
                  const seleccionada = fila?.seleccionada ?? false
                  const importeFila = seleccionada ? parseImporte(fila.importeStr) : 0
                  const excedida = seleccionada && aCentavos(importeFila) > aCentavos(c.saldoPendiente)
                  const parcial = seleccionada && !excedida && aCentavos(importeFila) > 0 && aCentavos(importeFila) < aCentavos(c.saldoPendiente)
                  // Saldo a favor (recibo a cuenta): se puede APLICAR a las facturas de este recibo
                  // si ya está en Tango; si todavía es de la app, se muestra y nada más.
                  if (c.saldoPendiente < 0) {
                    const enTango = typeof c.idComprobanteTango === 'number'
                    const disponible = -c.saldoPendiente
                    const aplicado = seleccionada ? parseImporte(fila.importeStr) : 0
                    const excedido = seleccionada && aCentavos(aplicado) > aCentavos(disponible)
                    return (
                      <div key={clave} className={`rounded-xl border p-3 ${seleccionada ? 'bg-amber-50 border-accent' : 'bg-amber-50 border-amber-200'}`}>
                        <button type="button" onClick={() => toggleFila(c)} className="w-full text-left" aria-disabled={apagado || !enTango}>
                          <div className="flex items-center gap-2">
                            {enTango && <input type="checkbox" readOnly checked={seleccionada} className="accent-[#1D9E75] pointer-events-none" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-amber-800 truncate">Saldo a favor · {c.tipo} {c.numero}</p>
                              <p className="text-xs text-amber-700">
                                {c.fechaEmision ? `${c.fechaEmision} · ` : ''}{enTango ? 'Tocá para usarlo en este recibo.' : 'Todavía no está en Tango.'}
                              </p>
                            </div>
                            <p className="text-sm font-semibold text-amber-800 shrink-0">{formatoARS(c.saldoPendiente)}</p>
                          </div>
                        </button>
                        {seleccionada && (
                          <div className="mt-2 pl-6">
                            <label className="text-xs text-amber-800 mb-1 block">Importe a aplicar de este saldo a favor</label>
                            <input
                              value={fila.importeStr}
                              onChange={(e) => setFilas((prev) => ({ ...prev, [clave]: { ...prev[clave], importeStr: e.target.value } }))}
                              inputMode="decimal"
                              className={`${inputClass} ${excedido ? 'border-red-400' : ''}`}
                            />
                            {excedido && <p className="text-xs text-red-500 mt-1">Mayor al saldo a favor disponible.</p>}
                          </div>
                        )}
                      </div>
                    )
                  }
                  return (
                    <div key={clave} className={`bg-white rounded-xl border shadow-sm p-3 ${seleccionada ? 'border-accent' : 'border-[#D3D1C7]'}`}>
                      <button type="button" onClick={() => toggleFila(c)} className="w-full text-left" aria-disabled={apagado}>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" readOnly checked={seleccionada} className="accent-[#1D9E75] pointer-events-none" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{c.tipo} {c.numero}</p>
                            <p className="text-xs text-gray-500">
                              {/* Emisión y vencimiento (pedido de los cobradores 2026-09-09). La emisión
                                  solo viene si el diseño de la Live de deudas en Tango la incluye. */}
                              {[c.fechaEmision ? `Emitida ${c.fechaEmision}` : '', c.fechaVencimiento ? `Vto. ${c.fechaVencimiento}` : ''].filter(Boolean).join(' · ')}
                              {c.diasAtraso ? (
                                <span className="text-red-500"> · {c.diasAtraso} {c.diasAtraso === 1 ? 'día' : 'días'} de atraso</span>
                              ) : null}
                              {aCentavos(c.saldoPendiente) < aCentavos(c.importeOriginal) && (
                                <span className="text-amber-600"> · cobro parcial previo</span>
                              )}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold text-gray-900">{formatoARS(c.saldoPendiente)}</p>
                            {aCentavos(c.saldoPendiente) < aCentavos(c.importeOriginal) && (
                              <p className="text-xs text-gray-400">de {formatoARS(c.importeOriginal)}</p>
                            )}
                          </div>
                        </div>
                      </button>
                      {seleccionada && (
                        <div className="mt-2 pl-6">
                          <label className="text-xs text-gray-500 mb-1 block">Importe a cobrar de esta factura</label>
                          <input
                            value={fila.importeStr}
                            onChange={(e) => setFilas((prev) => ({ ...prev, [clave]: { ...prev[clave], importeStr: e.target.value } }))}
                            inputMode="decimal"
                            className={`${inputClass} ${excedida ? 'border-red-400' : ''}`}
                          />
                          {excedida && <p className="text-xs text-red-500 mt-1">Mayor al saldo de la factura.</p>}
                          {parcial && <p className="text-xs text-amber-600 mt-1">Cobro parcial — quedan {formatoARS((aCentavos(c.saldoPendiente) - aCentavos(importeFila)) / 100)} pendientes.</p>}
                        </div>
                      )}
                    </div>
                  )
                })}
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ── Pago a cuenta sin factura (2026-09-08) ── */}
          {imputaciones.length === 0 && aplicaciones.length === 0 && !cargandoSaldo && gruposPosibles.length > 0 && (
            <section className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 space-y-2">
              <p className="text-sm font-medium text-gray-900">Cobrar a cuenta, sin imputar factura</p>
              <p className="text-xs text-gray-500">La plata queda como saldo a favor del cliente en Tango, para imputar a sus próximas facturas.</p>
              {gruposPosibles.length === 1 ? (
                <p className="text-xs text-gray-700">En <span className="font-semibold">{NOMBRE_EMPRESA[gruposPosibles[0].empresa]}</span>{gruposPosibles[0].codigo ? ` · cód. ${gruposPosibles[0].codigo}` : ''}.</p>
              ) : (
                <select
                  value={grupoACuenta ? `${grupoACuenta.empresa}|${grupoACuenta.codigo}` : ''}
                  onChange={(e) => { const [empresa, codigo] = e.target.value.split('|'); setGrupoACuenta(empresa ? { empresa: empresa as EmpresaTango, codigo } : null) }}
                  className={inputClass}
                >
                  <option value="">Elegí empresa y código…</option>
                  {gruposPosibles.map((g) => (
                    <option key={`${g.empresa}|${g.codigo}`} value={`${g.empresa}|${g.codigo}`}>
                      {NOMBRE_EMPRESA[g.empresa]} · cód. {g.codigo}{nombreSucursal(cliente, g.empresa, g.codigo) ? ` · ${nombreSucursal(cliente, g.empresa, g.codigo)}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </section>
          )}

          {/* ── Medios de pago ── */}
          {seccionValores && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Valores recibidos</h2>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Banknote size={12} /> Efectivo</label>
                  <input value={efectivoStr} onChange={(e) => setEfectivoStr(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputClass} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Landmark size={12} /> Transferencia</label>
                  <input value={transferenciaStr} onChange={(e) => setTransferenciaStr(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputClass} />
                </div>
              </div>

              {cheques.map((ch, i) => (
                <div key={`${ch.numero}-${i}`} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">Cheque Nº {ch.numero}{ch.esEcheq ? ' (e-cheq)' : ''}</p>
                      <p className="text-xs text-gray-500">{ch.bancoNombre}</p>
                      <p className="text-xs text-gray-500">Emisión {ch.fechaEmision} · Acred. {ch.fechaAcreditacion} · {ch.dias} {ch.dias === 1 ? 'día' : 'días'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-gray-900">{formatoARS(ch.importe)}</p>
                      <button type="button" onClick={() => setCheques((prev) => prev.filter((_, j) => j !== i))}
                        className="text-gray-400 hover:text-red-500 mt-1" aria-label="Quitar cheque">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {retenciones.map((r, i) => (
                <div key={`${r.nroCertificado}-${i}`} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{RETENCION_LABELS[r.tipo]}</p>
                      <p className="text-xs text-gray-500">Certificado Nº {r.nroCertificado}{r.fecha ? ` · ${r.fecha}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-gray-900">{formatoARS(r.importe)}</p>
                      <button type="button" onClick={() => setRetenciones((prev) => prev.filter((_, j) => j !== i))}
                        className="text-gray-400 hover:text-red-500 mt-1" aria-label="Quitar retención">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex gap-2">
                <Button variant="outline" type="button" onClick={() => setModal('cheque')} className="flex-1">
                  <Plus size={16} className="mr-1" /> Cheque
                </Button>
                <Button variant="outline" type="button" onClick={() => setModal('retencion')} className="flex-1">
                  <Plus size={16} className="mr-1" /> Retención
                </Button>
              </div>

              {/* ── Cuadre en vivo ── */}
              <div className={`rounded-xl border p-3 ${faltanCent === 0 && totalMediosCent > 0 && aCuentaCent === 0 ? 'bg-accent/10 border-accent' : aCuentaCent > 0 && faltanCent === 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-[#D3D1C7]'}`}>
                <div className="flex justify-between text-sm text-gray-700">
                  <span>Imputado a facturas</span>
                  <span className="font-semibold">{formatoARS(totalImputadoCent / 100)}</span>
                </div>
                {aplicadoCent > 0 && (
                  <div className="flex justify-between text-sm text-gray-700 mt-1">
                    <span>Saldo a favor aplicado</span>
                    <span className="font-semibold">{formatoARS(aplicadoCent / 100)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-gray-700 mt-1">
                  <span>{aplicadoCent > 0 ? 'Valores recibidos + saldo aplicado' : 'Valores recibidos'}</span>
                  <span className="font-semibold">{formatoARS(totalMediosCent / 100)}</span>
                </div>
                {mezclaACuenta && (
                  <p className="text-sm font-semibold mt-2 text-red-500">Estás usando saldo a favor y dejando plata a cuenta a la vez: bajá el saldo aplicado.</p>
                )}
                {faltanCent > 0 && (
                  <p className="text-sm font-semibold mt-2 text-red-500">Faltan {formatoARS(faltanCent / 100)} en valores</p>
                )}
                {aCuentaCent > 0 && (
                  <div className="mt-2">
                    <p className="text-sm font-semibold text-amber-700">Queda a cuenta del cliente: {formatoARS(aCuentaCent / 100)}</p>
                    <p className="text-xs text-amber-700">Saldo a favor en {grupoRecibo ? NOMBRE_EMPRESA[grupoRecibo.empresa] : 'Tango'}, para imputar a sus próximas facturas.</p>
                    {sinImputar.length > 0 && (
                      <p className="text-xs text-amber-800 mt-1">
                        Ojo: tiene {sinImputar.length} {sinImputar.length === 1 ? 'factura más pendiente' : 'facturas más pendientes'} por {formatoARS(sumaCentavos(sinImputar.map((c) => c.saldoPendiente)) / 100)}. Si esta plata es para pagarlas, marcalas arriba.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      )}

      {cliente && seccionValores && (
        <Button onClick={abrirConfirmacion} disabled={faltanCent > 0 || imputacionInvalida || aplicacionInvalida || mezclaACuenta || totalMediosCent === 0} className="w-full">
          <ReceiptText size={16} className="mr-2" /> Emitir recibo
        </Button>
      )}

      {modal === 'cheque' && (
        <Modal open onClose={() => setModal(null)} title="Agregar cheque">
          <ChequeForm
            onAgregar={(ch) => { setCheques((prev) => [...prev, ch]); setModal(null) }}
            onCancelar={() => setModal(null)}
          />
        </Modal>
      )}

      {modal === 'retencion' && (
        <Modal open onClose={() => setModal(null)} title="Agregar retención">
          <RetencionForm
            onAgregar={(r) => { setRetenciones((prev) => [...prev, r]); setModal(null) }}
            onCancelar={() => setModal(null)}
          />
        </Modal>
      )}

      {modal === 'confirmar' && cliente && (
        <Modal open onClose={() => setModal(null)} title="Confirmar cobranza">
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Cobrás <span className="font-semibold">{formatoARS(totalMediosCent / 100)}</span> a{' '}
              <span className="font-semibold">{cliente.razonSocial || cliente.nombre}</span>
              {imputaciones.length > 0 ? (
                <>, {formatoARS(totalImputadoCent / 100)} imputado a {imputaciones.length} {imputaciones.length === 1 ? 'factura' : 'facturas'} de{' '}</>
              ) : (
                <>, todo a cuenta en{' '}</>
              )}
              <span className="font-semibold">{grupoRecibo ? NOMBRE_EMPRESA[grupoRecibo.empresa] : ''}</span>
              {grupoRecibo?.codigo ? ` (cód. ${grupoRecibo.codigo})` : ''}.
            </p>
            {aCuentaCent > 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                <span className="font-semibold">{formatoARS(aCuentaCent / 100)}</span> quedan a cuenta: saldo a favor del cliente en Tango.
              </p>
            )}
            <ul className="text-xs text-gray-600 space-y-1">
              {parseImporte(efectivoStr) > 0 && <li>Efectivo: {formatoARS(parseImporte(efectivoStr))}</li>}
              {parseImporte(transferenciaStr) > 0 && <li>Transferencia: {formatoARS(parseImporte(transferenciaStr))}</li>}
              {cheques.map((ch, i) => <li key={i}>Cheque {ch.numero} ({ch.bancoNombre}): {formatoARS(ch.importe)}</li>)}
              {retenciones.map((r, i) => <li key={i}>{RETENCION_LABELS[r.tipo]}: {formatoARS(r.importe)}</li>)}
              {aplicaciones.map((a, i) => <li key={`ac${i}`}>Saldo a favor aplicado (recibo {a.reciboNumero}): {formatoARS(a.importe)}</li>)}
            </ul>
            <p className="text-xs text-gray-500">El registro es definitivo e impacta en la cuenta corriente de Tango.</p>
            {retenciones.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                Guardá el certificado de retención en papel: administración lo necesita para el crédito fiscal. Si Tango no toma el recibo, queda marcado con error y lo revisa la oficina.
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setModal(null)} className="flex-1" disabled={guardando}>Cancelar</Button>
              <Button onClick={confirmar} className="flex-1" disabled={guardando}>{guardando ? 'Guardando…' : 'Confirmar'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
