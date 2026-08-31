import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Banknote, CheckCircle2, FileDown, Landmark, Plus, ReceiptText, RefreshCw, Trash2 } from 'lucide-react'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import ChequeForm from '@/components/supervisor/ChequeForm'
import RetencionForm, { RETENCION_LABELS } from '@/components/supervisor/RetencionForm'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ClienteCombobox, { toComboItems } from '@/components/ui/ClienteCombobox'
import { useAuth } from '@/context/AuthContext'
import { useOnline } from '@/hooks/useOnline'
import { useClientesActivos } from '@/hooks/useClientesActivos'
import { useSaldoClienteEnVivo } from '@/hooks/useSaldoClienteEnVivo'
import { crearCobranzaSupervisor } from '@/services/cobranzaService'
import {
  asegurarReserva, codigoRecibo, consumirNumero, precargarSiSeAcerca,
} from '@/services/reciboSupervisorService'
import { generateReciboCobranzaSupervisor } from '@/utils/pdf'
import { aCentavos, formatoARS, parseImporte, sumaCentavos } from '@/utils/money'
import { haceCuanto } from './SupervisorClientesPage'
import { ChequeRecibido, Cobranza, ComprobanteSaldoTango, ImputacionFactura, RetencionRecibida } from '@/types'

const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

// Estado de edición de una fila de la composición de saldos: si está marcada
// para cobrar y con cuánto (default: el saldo completo de la factura).
interface FilaImputacion {
  seleccionada: boolean
  importeStr:   string
}

const claveComp = (c: ComprobanteSaldoTango) => `${c.tipo}|${c.numero}`

// Cobranza completa del supervisor: composición de saldos de Tango →
// imputación por factura (total o parcial) → medios de pago multi-ítem
// (efectivo / transferencia / cheques / retenciones) → recibo numerado.
export default function CobranzaSupervisorPage() {
  const { user } = useAuth()
  const online = useOnline()
  const [searchParams] = useSearchParams()
  const { clientes, loading: loadingClientes } = useClientesActivos()

  const [clienteId, setClienteId] = useState(searchParams.get('cliente') ?? '')
  const [filas, setFilas] = useState<Record<string, FilaImputacion>>({})
  const [efectivoStr, setEfectivoStr] = useState('')
  const [transferenciaStr, setTransferenciaStr] = useState('')
  const [cheques, setCheques] = useState<ChequeRecibido[]>([])
  const [retenciones, setRetenciones] = useState<RetencionRecibida[]>([])
  const [modal, setModal] = useState<'cheque' | 'retencion' | 'confirmar' | null>(null)
  const [exito, setExito] = useState<Cobranza | null>(null)
  const [error, setError] = useState('')
  const [numeracionActiva, setNumeracionActiva] = useState(false)

  // Solo clientes vinculados a Tango pueden cobrarse con imputación.
  const clientesTango = useMemo(
    () => clientes.filter((c) => typeof c.idGva14Tango === 'number'),
    [clientes],
  )
  const cliente = useMemo(() => clientesTango.find((c) => c.uid === clienteId) ?? null, [clientesTango, clienteId])

  const actor = useMemo(
    () => (user ? { uid: user.uid, nombre: user.nombre } : null),
    [user],
  )
  const { saldo, cargando: cargandoSaldo, refrescando, esCache } = useSaldoClienteEnVivo(cliente, actor)

  // Reserva de números de recibo para poder emitir sin señal. La numeración
  // es opcional: si el contador no está inicializado (decisión hasta conectar
  // Tango), los recibos salen sin número y el cobro no se bloquea nunca.
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

  const confirmar = () => {
    if (!user || !cliente || !saldo) return
    try {
      // Con numeración activa consume un número de la reserva local; si justo
      // se agotó (carrera), el recibo sale sin número antes que bloquear.
      let numeroRecibo: string | undefined
      if (numeracionActiva) {
        try { numeroRecibo = codigoRecibo(consumirNumero(user.uid)) } catch { /* sin número */ }
      }
      const cobranza = crearCobranzaSupervisor(
        {
          clienteId:     cliente.uid,
          clienteNombre: cliente.razonSocial || cliente.nombre,
          empresa:       saldo.empresa,
          numeroRecibo,
          imputaciones,
          medios: {
            efectivo:      parseImporte(efectivoStr),
            transferencia: parseImporte(transferenciaStr),
            cheques,
            retenciones,
          },
        },
        { uid: user.uid, nombre: user.nombre },
      )
      if (numeracionActiva) precargarSiSeAcerca(user.uid, online)
      setExito(cobranza)
      setModal(null)
      setClienteId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la cobranza. Intentá de nuevo.')
      setModal(null)
    }
  }

  const descargarRecibo = (c: Cobranza) => {
    if (!c.imputaciones || !c.medios) return
    generateReciboCobranzaSupervisor({
      numeroRecibo:  c.numeroRecibo,
      clienteNombre: c.clienteNombre,
      empresa:       c.empresa ?? 'redonhielo',
      importe:       c.importe,
      imputaciones:  c.imputaciones,
      medios:        c.medios,
      registradoPor: c.registradoPor.nombre,
      fecha:         c.fecha.toDate(),
    })
  }

  if (loadingClientes) return <LoadingSpinner fullScreen />

  if (exito) {
    return (
      <div className="min-h-screen bg-[#F8F7F2]">
        <SupervisorHeader title="Cobrar" back />
        <main className="max-w-md mx-auto p-4 pt-10 text-center space-y-4">
          <CheckCircle2 size={48} className="text-accent mx-auto" />
          <div>
            <p className="text-lg font-semibold text-gray-900">Cobranza registrada</p>
            <p className="text-sm text-gray-600 mt-1">{exito.numeroRecibo ? `Recibo ${exito.numeroRecibo} — ` : ''}{formatoARS(exito.importe)} — {exito.clienteNombre}</p>
            <p className="text-xs text-gray-500 mt-2">Queda encolada para impactar en la cuenta corriente de Tango.</p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => descargarRecibo(exito)} className="w-full">
              <FileDown size={16} className="mr-2" /> Descargar recibo PDF
            </Button>
            <Button variant="outline" onClick={() => setExito(null)} className="w-full">Registrar otra cobranza</Button>
            <Link to="/supervisor" className="text-sm text-gray-500 hover:text-accent">Volver al inicio</Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8F7F2]">
      <SupervisorHeader title="Cobrar" back />
      <main className="max-w-md mx-auto p-4 space-y-4 pb-28">
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
                </div>
              ) : (
                <div className="space-y-2">
                  {comprobantes.map((c) => {
                    const clave = claveComp(c)
                    const fila = filas[clave]
                    const seleccionada = fila?.seleccionada ?? false
                    const importeFila = seleccionada ? parseImporte(fila.importeStr) : 0
                    const excedida = seleccionada && aCentavos(importeFila) > aCentavos(c.saldoPendiente)
                    const parcial = seleccionada && !excedida && aCentavos(importeFila) > 0 && aCentavos(importeFila) < aCentavos(c.saldoPendiente)
                    return (
                      <div key={clave} className={`bg-white rounded-xl border shadow-sm p-3 ${seleccionada ? 'border-accent' : 'border-[#D3D1C7]'}`}>
                        <button type="button" onClick={() => toggleFila(c)} className="w-full text-left">
                          <div className="flex items-center gap-2">
                            <input type="checkbox" readOnly checked={seleccionada} className="accent-[#1D9E75] pointer-events-none" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{c.tipo} {c.numero}</p>
                              <p className="text-xs text-gray-500">
                                {c.fechaEmision}
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
                {imputaciones.length} {imputaciones.length === 1 ? 'factura' : 'facturas'}.
              </p>
              <ul className="text-xs text-gray-600 space-y-1">
                {parseImporte(efectivoStr) > 0 && <li>Efectivo: {formatoARS(parseImporte(efectivoStr))}</li>}
                {parseImporte(transferenciaStr) > 0 && <li>Transferencia: {formatoARS(parseImporte(transferenciaStr))}</li>}
                {cheques.map((ch, i) => <li key={i}>Cheque {ch.numero} ({ch.bancoNombre}): {formatoARS(ch.importe)}</li>)}
                {retenciones.map((r, i) => <li key={i}>{RETENCION_LABELS[r.tipo]}: {formatoARS(r.importe)}</li>)}
              </ul>
              <p className="text-xs text-gray-500">El registro es definitivo e impacta en la cuenta corriente de Tango.</p>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" type="button" onClick={() => setModal(null)} className="flex-1">Cancelar</Button>
                <Button onClick={confirmar} className="flex-1">Confirmar</Button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </div>
  )
}
