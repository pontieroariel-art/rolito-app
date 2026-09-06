import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, CheckCircle2, FileDown, Landmark, Plus, ReceiptText, RefreshCw, Share2, Trash2 } from 'lucide-react'
import ChequeForm from '@/components/supervisor/ChequeForm'
import RetencionForm, { RETENCION_LABELS } from '@/components/supervisor/RetencionForm'
import { entregarReciboSupervisor } from '@/components/supervisor/CobranzaSupervisorCard'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ClienteCombobox, { toComboItems } from '@/components/ui/ClienteCombobox'
import { useAuth } from '@/context/AuthContext'
import { useOnline } from '@/hooks/useOnline'
import { useClientesActivos } from '@/hooks/useClientesActivos'
import { useSaldoClienteEnVivo } from '@/hooks/useSaldoClienteEnVivo'
import { useDepositoDelUsuario } from '@/hooks/useDepositosReparto'
import { crearCobranzaCompleta, type OrigenCobranzaCompleta } from '@/services/cobranzaService'
import {
  asegurarReserva, codigoRecibo, consumirNumero, precargarSiSeAcerca,
} from '@/services/reciboSupervisorService'
import { puedeCompartirArchivos } from '@/utils/compartir'
import { aCentavos, formatoARS, parseImporte, sumaCentavos } from '@/utils/money'
import { haceCuanto } from '@/pages/supervisor/SupervisorClientesPage'
import { EMPRESAS_TANGO, NOMBRE_EMPRESA, estaVinculadoATango } from '@/utils/tangoEmpresas'
import { ChequeRecibido, Cobranza, ComprobanteSaldoTango, EmpresaTango, ImputacionFactura, PlantaId, RetencionRecibida } from '@/types'

const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

// Estado de edición de una fila de la composición de saldos: si está marcada
// para cobrar y con cuánto (default: el saldo completo de la factura).
interface FilaImputacion {
  seleccionada: boolean
  importeStr:   string
}

// La empresa y el código van en la clave: la misma factura (tipo+número) puede
// existir en Redonhielo y en Rolito, y un CUIT puede tener varios códigos.
const empresaDe = (c: ComprobanteSaldoTango): EmpresaTango => c.empresa ?? 'redonhielo'
const claveComp = (c: ComprobanteSaldoTango) => `${empresaDe(c)}|${c.codigoTango ?? ''}|${c.tipo}|${c.numero}`

// Un recibo = UNA empresa y UN código de cliente (en Tango es una base y un
// talonario distintos; decisión de Ariel 2026-09-06: "si es de Rolito que sea
// de Rolito, si no los saldos no quedan bien").
interface GrupoRecibo { empresa: EmpresaTango; codigo: string }
const grupoDe = (c: ComprobanteSaldoTango): GrupoRecibo => ({ empresa: empresaDe(c), codigo: c.codigoTango ?? '' })
const mismoGrupo = (a: GrupoRecibo, b: GrupoRecibo) => a.empresa === b.empresa && a.codigo === b.codigo

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
  const { clientes, loading: loadingClientes } = useClientesActivos()

  const [clienteId, setClienteId] = useState(clienteInicial ?? '')
  const [filas, setFilas] = useState<Record<string, FilaImputacion>>({})
  const [efectivoStr, setEfectivoStr] = useState('')
  const [transferenciaStr, setTransferenciaStr] = useState('')
  const [cheques, setCheques] = useState<ChequeRecibido[]>([])
  const [retenciones, setRetenciones] = useState<RetencionRecibida[]>([])
  const [modal, setModal] = useState<'cheque' | 'retencion' | 'confirmar' | null>(null)
  const [exito, setExito] = useState<Cobranza | null>(null)
  const [avisoRecibo, setAvisoRecibo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [numeracionActiva, setNumeracionActiva] = useState(false)

  // Solo clientes vinculados a Tango (en cualquiera de las dos empresas) pueden cobrarse con imputación.
  const clientesTango = useMemo(
    () => clientes.filter((c) => estaVinculadoATango(c)),
    [clientes],
  )
  const cliente = useMemo(() => clientesTango.find((c) => c.uid === clienteId) ?? null, [clientesTango, clienteId])

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
    setError('')
  }, [clienteId])

  const comprobantes = useMemo(() => saldo?.comprobantes ?? [], [saldo])

  // Bloques por empresa (y dentro por código si el CUIT tiene varios): cada
  // bloque es un recibo posible; al tildar una factura, los demás se apagan.
  const bloques = useMemo(() => {
    const out: Array<{ grupo: GrupoRecibo; comprobantes: ComprobanteSaldoTango[]; subtotal: number }> = []
    for (const empresa of EMPRESAS_TANGO) {
      const deEmpresa = comprobantes.filter((c) => empresaDe(c) === empresa)
      const codigos = [...new Set(deEmpresa.map((c) => c.codigoTango ?? ''))]
      for (const codigo of codigos) {
        const lista = deEmpresa.filter((c) => (c.codigoTango ?? '') === codigo)
        out.push({ grupo: { empresa, codigo }, comprobantes: lista, subtotal: sumaCentavos(lista.map((c) => c.saldoPendiente)) / 100 })
      }
    }
    return out
  }, [comprobantes])
  const variosCodigos = (empresa: EmpresaTango) => bloques.filter((b) => b.grupo.empresa === empresa).length > 1

  const grupoSeleccionado: GrupoRecibo | null = useMemo(() => {
    const c = comprobantes.find((x) => filas[claveComp(x)]?.seleccionada)
    return c ? grupoDe(c) : null
  }, [comprobantes, filas])

  const imputaciones: ImputacionFactura[] = useMemo(() => {
    return comprobantes
      .filter((c) => filas[claveComp(c)]?.seleccionada)
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
    sumaCentavos(retenciones.map((r) => r.importe))
  const diferenciaCent = totalImputadoCent - totalMediosCent

  const imputacionInvalida = imputaciones.some(
    (i) => aCentavos(i.importeImputado) <= 0 || aCentavos(i.importeImputado) > aCentavos(i.saldoAlMomento),
  )

  const toggleFila = (c: ComprobanteSaldoTango) => {
    const clave = claveComp(c)
    if (grupoSeleccionado && !mismoGrupo(grupoSeleccionado, grupoDe(c))) {
      setError(`Un recibo cobra facturas de una sola empresa${variosCodigos(empresaDe(c)) ? ' y un solo código de cliente' : ''}. Emití este recibo y después hacé otro para ${NOMBRE_EMPRESA[empresaDe(c)]}.`)
      return
    }
    setError('')
    setFilas((prev) => {
      const actual = prev[clave]
      if (actual?.seleccionada) return { ...prev, [clave]: { ...actual, seleccionada: false } }
      return { ...prev, [clave]: { seleccionada: true, importeStr: actual?.importeStr || String(c.saldoPendiente).replace('.', ',') } }
    })
  }

  const abrirConfirmacion = () => {
    setError('')
    if (!cliente)                 { setError('Elegí el cliente que paga.'); return }
    if (imputaciones.length === 0) { setError('Marcá al menos una factura a cobrar.'); return }
    if (imputacionInvalida)       { setError('Hay una imputación en cero o mayor al saldo de la factura.'); return }
    if (totalMediosCent === 0)    { setError('Cargá al menos un medio de pago.'); return }
    if (diferenciaCent !== 0)     { setError('La suma de los valores no coincide con lo imputado.'); return }
    setModal('confirmar')
  }

  const confirmar = async () => {
    if (!user || !cliente || !saldo || !grupoSeleccionado) return
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
          clienteNombre: cliente.razonSocial || cliente.nombre,
          empresa:       grupoSeleccionado.empresa,
          ...(grupoSeleccionado.codigo ? { codigoTango: grupoSeleccionado.codigo } : {}),
          numeroRecibo,
          imputaciones,
          medios: {
            efectivo:      parseImporte(efectivoStr),
            transferencia: parseImporte(transferenciaStr),
            cheques,
            retenciones,
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
        <ClienteCombobox items={toComboItems(clientesTango)} value={clienteId} onChange={setClienteId} placeholder="Buscar cliente…" />
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
                <p className="text-xs text-gray-400 mt-1">Si te está adelantando plata sin factura, hoy eso lo carga la oficina en Tango.</p>
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
                      <p className="text-sm font-semibold text-gray-900">
                        {NOMBRE_EMPRESA[grupo.empresa]}
                        {(variosCodigos(grupo.empresa) || grupo.codigo) && <span className="text-xs font-normal text-gray-500"> · cód. {grupo.codigo || '—'}</span>}
                      </p>
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
                  return (
                    <div key={clave} className={`bg-white rounded-xl border shadow-sm p-3 ${seleccionada ? 'border-accent' : 'border-[#D3D1C7]'}`}>
                      <button type="button" onClick={() => toggleFila(c)} className="w-full text-left" aria-disabled={apagado}>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" readOnly checked={seleccionada} className="accent-[#1D9E75] pointer-events-none" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{c.tipo} {c.numero}</p>
                            <p className="text-xs text-gray-500">
                              {c.fechaEmision || (c.fechaVencimiento ? `Vto. ${c.fechaVencimiento}` : '')}
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

          {/* ── Medios de pago ── */}
          {imputaciones.length > 0 && (
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
              <div className={`rounded-xl border p-3 ${diferenciaCent === 0 && totalImputadoCent > 0 ? 'bg-accent/10 border-accent' : 'bg-white border-[#D3D1C7]'}`}>
                <div className="flex justify-between text-sm text-gray-700">
                  <span>Imputado a facturas</span>
                  <span className="font-semibold">{formatoARS(totalImputadoCent / 100)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-700 mt-1">
                  <span>Valores recibidos</span>
                  <span className="font-semibold">{formatoARS(totalMediosCent / 100)}</span>
                </div>
                {diferenciaCent !== 0 && (
                  <p className={`text-sm font-semibold mt-2 ${diferenciaCent > 0 ? 'text-red-500' : 'text-amber-600'}`}>
                    {diferenciaCent > 0
                      ? `Faltan ${formatoARS(diferenciaCent / 100)} en valores`
                      : `Sobran ${formatoARS(-diferenciaCent / 100)} en valores`}
                  </p>
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

      {cliente && imputaciones.length > 0 && (
        <Button onClick={abrirConfirmacion} disabled={diferenciaCent !== 0 || imputacionInvalida || totalMediosCent === 0} className="w-full">
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
              Cobrás <span className="font-semibold">{formatoARS(totalImputadoCent / 100)}</span> a{' '}
              <span className="font-semibold">{cliente.razonSocial || cliente.nombre}</span>, imputado a{' '}
              {imputaciones.length} {imputaciones.length === 1 ? 'factura' : 'facturas'} de{' '}
              <span className="font-semibold">{grupoSeleccionado ? NOMBRE_EMPRESA[grupoSeleccionado.empresa] : ''}</span>
              {grupoSeleccionado?.codigo ? ` (cód. ${grupoSeleccionado.codigo})` : ''}.
            </p>
            <ul className="text-xs text-gray-600 space-y-1">
              {parseImporte(efectivoStr) > 0 && <li>Efectivo: {formatoARS(parseImporte(efectivoStr))}</li>}
              {parseImporte(transferenciaStr) > 0 && <li>Transferencia: {formatoARS(parseImporte(transferenciaStr))}</li>}
              {cheques.map((ch, i) => <li key={i}>Cheque {ch.numero} ({ch.bancoNombre}): {formatoARS(ch.importe)}</li>)}
              {retenciones.map((r, i) => <li key={i}>{RETENCION_LABELS[r.tipo]}: {formatoARS(r.importe)}</li>)}
            </ul>
            <p className="text-xs text-gray-500">El registro es definitivo e impacta en la cuenta corriente de Tango.</p>
            {retenciones.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                Las retenciones todavía no entran solas a Tango: este recibo lo termina de cargar la oficina con el certificado. Guardá el papel.
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
