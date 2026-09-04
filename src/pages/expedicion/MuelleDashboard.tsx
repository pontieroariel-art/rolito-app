import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, PackageCheck, Truck } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useFechaDelDia } from '../../hooks/useDiaActual'
import { asignarDarsena, subscribeRemitosCargaDelDia } from '../../services/remitoCargaService'
import {
  confirmarEntregaRemito, crearDescargaCamion, subscribeDescargasDelDia,
} from '../../services/descargaCamionService'
import {
  confirmarEntregaVentanilla, llamarTurno, marcarTurnoAusente, marcarTurnoPreparado,
  subscribeVentanillaDelDia,
} from '../../services/ventaVentanillaService'
import {
  DARSENAS_POR_PLANTA, DARSENAS_VENTANILLA, DescargaCamion, DescargaCamionItem,
  PLANTAS, RemitoCarga, VentaVentanilla,
} from '../../types'
import { reportError } from '@/services/observability'

// Pantalla del rol muelle (tablet en planta): confirma la entrega de la
// mercadería contra el remito de carga, y cuenta la descarga física cuando el
// camión vuelve (mercadería sana, bolsas rotas de los cambios, y envases:
// pallets completos / parciales / vacíos — cada pallet = base + 4 puntales).
export default function MuelleDashboard() {
  const { user } = useAuth()
  const { catalogo } = useCatalogo()
  const plantaId = user?.planta ?? 'torcuato'
  const fecha = useFechaDelDia()

  const [remitos,     setRemitos]     = useState<RemitoCarga[]>([])
  const [descargas,   setDescargas]   = useState<DescargaCamion[]>([])
  const [ventanillas, setVentanillas] = useState<VentaVentanilla[]>([])

  useEffect(() => subscribeRemitosCargaDelDia(plantaId, fecha, setRemitos), [plantaId, fecha])
  useEffect(() => subscribeDescargasDelDia(plantaId, fecha, setDescargas), [plantaId, fecha])
  useEffect(() => subscribeVentanillaDelDia(plantaId, fecha, setVentanillas), [plantaId, fecha])

  // ── Descarga: formulario ──
  const [remitoDescargaId, setRemitoDescargaId] = useState('')
  const [sanas,  setSanas]  = useState<Record<string, number>>({})
  const [rotas,  setRotas]  = useState<Record<string, number>>({})
  const [palletsCompletos, setPalletsCompletos] = useState(0)
  const [palletsParciales, setPalletsParciales] = useState(0)
  const [palletsVacios,    setPalletsVacios]    = useState(0)
  const [confirmando, setConfirmando] = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  // Id del remito/turno que se está entregando: evita el doble toque (el
  // segundo update lo rechazan las reglas y se veía como error).
  const [procesando,  setProcesando]  = useState<string | null>(null)
  const [error,       setError]       = useState('')
  const [okMsg,       setOkMsg]       = useState('')

  const porEntregar = remitos.filter((r) => r.estado === 'emitido')
  // Cola de turnos de ventanilla, en orden. Los ausentes van aparte (no
  // bloquean la cola; se re-llaman cuando aparecen).
  const colaVentanilla = ventanillas
    .filter((v) => v.estado === 'pendiente_entrega' && v.turnoEstado !== 'ausente')
    .sort((a, b) => a.turno - b.turno)
  const ausentes = ventanillas
    .filter((v) => v.estado === 'pendiente_entrega' && v.turnoEstado === 'ausente')
    .sort((a, b) => a.turno - b.turno)
  const darsenasVentanilla = DARSENAS_VENTANILLA[plantaId]
  const darsenaLibre = (n: number) =>
    !colaVentanilla.some((v) => v.turnoEstado === 'llamado' && v.darsena === n)
  const minutosEsperando = (v: VentaVentanilla) =>
    Math.max(0, Math.round((Date.now() - v.fecha.toMillis()) / 60_000))
  // Para descargar: cualquier remito ya entregado (el camión salió y volvió).
  const entregados  = remitos.filter((r) => r.estado !== 'emitido')
  const remitoDescarga = entregados.find((r) => r.id === remitoDescargaId)

  const toItems = (m: Record<string, number>): DescargaCamionItem[] =>
    catalogo
      .filter((p) => (m[p.id] ?? 0) > 0)
      .map((p) => ({ productoId: p.id, nombre: p.nombre, cantidad: m[p.id] }))

  const num = (v: string) => Math.max(0, Math.min(99999, parseInt(v.replace(/\D/g, ''), 10) || 0))

  const entregar = async (r: RemitoCarga) => {
    if (!user || procesando) return
    setError('')
    setProcesando(r.id)
    try {
      await confirmarEntregaRemito(r, { uid: user.uid, nombre: user.nombre, plantaId })
    } catch (err) {
      reportError(err, { origen: 'MuelleDashboard', accion: 'error al confirmar entrega' })
      setError('No se pudo confirmar la entrega. Intentá de nuevo.')
    } finally {
      setProcesando(null)
    }
  }

  const entregarVentanilla = async (v: VentaVentanilla) => {
    if (!user || procesando) return
    setError('')
    setProcesando(v.id)
    try {
      await confirmarEntregaVentanilla(v, { uid: user.uid, nombre: user.nombre })
    } catch (err) {
      reportError(err, { origen: 'MuelleDashboard', accion: 'error al entregar ventanilla' })
      setError('No se pudo confirmar la entrega. Intentá de nuevo.')
    } finally {
      setProcesando(null)
    }
  }

  const registrarDescarga = async () => {
    if (!user || !remitoDescarga) return
    setGuardando(true)
    setError('')
    try {
      await crearDescargaCamion(
        {
          camionId:     remitoDescarga.camionId,
          camionLabel:  remitoDescarga.camionLabel,
          choferId:     remitoDescarga.choferId,
          choferNombre: remitoDescarga.choferNombre,
          items:        toItems(sanas),
          bolsasRotas:  toItems(rotas),
          palletsCompletos, palletsParciales, palletsVacios,
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setConfirmando(false)
      setRemitoDescargaId('')
      setSanas({})
      setRotas({})
      setPalletsCompletos(0); setPalletsParciales(0); setPalletsVacios(0)
      setOkMsg(`Descarga de ${remitoDescarga.choferNombre} registrada.`)
    } catch (err) {
      reportError(err, { origen: 'MuelleDashboard', accion: 'error al registrar descarga' })
      setError('No se pudo registrar la descarga. Revisá la conexión e intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const inputClass = 'w-16 text-center bg-white border border-[#D3D1C7] rounded-lg py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent'
  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Muelle</h1>
            <p className="text-gray-500 text-sm">{PLANTAS[plantaId].label}</p>
          </div>
          <a href="/muelle/tv" target="_blank" rel="noreferrer" className="text-xs text-gray-400 underline hover:text-accent mt-1">
            Pantalla TV →
          </a>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}
        {okMsg && (
          <div className="bg-accent/10 border border-accent/30 rounded-lg px-3 py-2 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-accent shrink-0" />
            <p className="text-sm text-gray-700">{okMsg}</p>
          </div>
        )}

        {/* ── Cargas para entregar ── */}
        <section className="space-y-2">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Truck size={18} className="text-accent" /> Cargas para entregar
          </h2>
          {porEntregar.length === 0 && (
            <p className="text-gray-400 text-sm">No hay remitos pendientes de entrega.</p>
          )}
          {porEntregar.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{r.codigo}</p>
                <p className="text-xs text-gray-500">{r.camionLabel} · {r.choferNombre}</p>
              </div>
              <div className="text-xs text-gray-600 space-y-0.5">
                {r.items.map((i) => (
                  <div key={i.productoId} className="flex justify-between">
                    <span>{i.nombre}{i.pallets ? ` · ${i.pallets} pallet${i.pallets > 1 ? 's' : ''}` : ''}</span>
                    <span className="font-medium">{i.cantidad}</span>
                  </div>
                ))}
                {r.palletsCarga > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Pallets de carga</span><span className="font-medium">{r.palletsCarga}</span>
                  </div>
                )}
              </div>
              {/* Dársena: alimenta el tablero de TV — sin asignar queda "en
                  espera". Los camiones usan SOLO sus dársenas (las de
                  ventanilla quedan para los turnos de clientes). */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 shrink-0">Dársena</span>
                <div className="flex gap-1.5 flex-wrap">
                  {Array.from({ length: DARSENAS_POR_PLANTA[plantaId] }, (_, i) => i + 1)
                    .filter((n) => !DARSENAS_VENTANILLA[plantaId].includes(n))
                    .map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => asignarDarsena(r, n).catch((err) => {
                        reportError(err, { origen: 'MuelleDashboard', accion: 'error al asignar dársena' })
                        setError('No se pudo asignar la dársena. Intentá de nuevo.')
                      })}
                      className={`w-9 h-9 rounded-lg border text-sm font-bold transition-colors ${
                        r.darsena === n
                          ? 'bg-accent text-white border-accent'
                          : 'bg-white text-gray-600 border-[#D3D1C7] hover:bg-gray-50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <Button onClick={() => entregar(r)} loading={procesando === r.id} disabled={!!procesando} className="w-full">Mercadería entregada</Button>
            </div>
          ))}
        </section>

        {/* ── Cola de turnos de ventanilla ── */}
        {(colaVentanilla.length > 0 || ausentes.length > 0) && (
          <section className="space-y-2">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <PackageCheck size={18} className="text-accent" /> Turnos de ventanilla
            </h2>
            {colaVentanilla.map((v) => (
              <div key={v.id} className={`bg-white rounded-xl border shadow-sm p-3 space-y-2 ${
                v.turnoEstado === 'llamado' ? 'border-green-400' : v.turnoEstado === 'preparado' ? 'border-amber-300' : 'border-[#D3D1C7]'
              }`}>
                <div className="flex items-center gap-3">
                  <span className={`shrink-0 w-12 h-12 rounded-xl font-black text-xl flex items-center justify-center ${
                    v.turnoEstado === 'llamado' ? 'bg-green-600 text-white'
                      : v.turnoEstado === 'preparado' ? 'bg-amber-400 text-white' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {v.turno}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{v.clienteNombre}</p>
                    <p className="text-xs text-gray-500">
                      {v.turnoEstado === 'llamado' && v.darsena
                        ? `Llamado a dársena ${v.darsena}`
                        : v.turnoEstado === 'preparado' ? 'Preparado — listo para llamar' : 'En espera'}
                      {' · '}{minutosEsperando(v)} min
                    </p>
                  </div>
                </div>
                <div className="text-xs text-gray-600 space-y-0.5">
                  {v.items.map((i) => (
                    <div key={i.productoId} className="flex justify-between">
                      <span>{i.nombre}</span>
                      <span className="font-medium">{i.cantidad}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {v.turnoEstado === 'en_espera' && (
                    <Button variant="outline" onClick={() => marcarTurnoPreparado(v).catch(() => setError('No se pudo marcar. Intentá de nuevo.'))} className="flex-1">
                      Preparado
                    </Button>
                  )}
                  {v.turnoEstado !== 'llamado' && darsenasVentanilla.map((n) => (
                    <Button
                      key={n}
                      disabled={!darsenaLibre(n)}
                      onClick={() => llamarTurno(v, n).catch(() => setError('No se pudo llamar. Intentá de nuevo.'))}
                      className="flex-1"
                    >
                      Llamar a D{n}
                    </Button>
                  ))}
                  {v.turnoEstado === 'llamado' && (
                    <>
                      <Button onClick={() => entregarVentanilla(v)} loading={procesando === v.id} disabled={!!procesando} className="flex-[2]">Mercadería entregada</Button>
                      <Button variant="outline" onClick={() => marcarTurnoAusente(v).catch(() => setError('No se pudo marcar. Intentá de nuevo.'))} className="flex-1">
                        No se presentó
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}

            {ausentes.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Ausentes (llamar cuando aparezcan)</p>
                {ausentes.map((v) => (
                  <div key={v.id} className="flex items-center gap-3">
                    <span className="shrink-0 w-10 h-10 rounded-lg bg-white border border-red-200 text-red-600 font-black flex items-center justify-center">
                      {v.turno}
                    </span>
                    <p className="flex-1 text-sm text-gray-800 truncate">{v.clienteNombre}</p>
                    {darsenasVentanilla.map((n) => (
                      <Button
                        key={n}
                        variant="outline"
                        disabled={!darsenaLibre(n)}
                        onClick={() => llamarTurno(v, n).catch(() => setError('No se pudo llamar. Intentá de nuevo.'))}
                      >
                        D{n}
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Registrar descarga ── */}
        <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <PackageCheck size={18} className="text-accent" /> Registrar descarga
          </h2>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Camión que volvió</label>
            <select value={remitoDescargaId} onChange={(e) => { setRemitoDescargaId(e.target.value); setOkMsg('') }} className={selectClass}>
              <option value="">Elegir remito del día…</option>
              {entregados.map((r) => (
                <option key={r.id} value={r.id}>{r.codigo} · {r.camionLabel} · {r.choferNombre}</option>
              ))}
            </select>
          </div>

          {remitoDescarga && (
            <>
              <div>
                <p className="text-xs text-gray-500 mb-2">Mercadería que volvió (contada)</p>
                <div className="space-y-2">
                  {catalogo.map((p) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <span className="flex-1 text-sm text-gray-800">{p.nombre}</span>
                      <input
                        value={sanas[p.id] ?? 0}
                        onChange={(e) => setSanas((prev) => ({ ...prev, [p.id]: num(e.target.value) }))}
                        inputMode="numeric"
                        className={inputClass}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2">Bolsas rotas recibidas (de los cambios)</p>
                <div className="space-y-2">
                  {catalogo.map((p) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <span className="flex-1 text-sm text-gray-800">{p.nombre}</span>
                      <input
                        value={rotas[p.id] ?? 0}
                        onChange={(e) => setRotas((prev) => ({ ...prev, [p.id]: num(e.target.value) }))}
                        inputMode="numeric"
                        className={inputClass}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2">
                  Envases (salieron {remitoDescarga.palletsCarga} pallets — base + 4 puntales cada uno)
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Completos</label>
                    <input value={palletsCompletos} onChange={(e) => setPalletsCompletos(num(e.target.value))} inputMode="numeric" className={selectClass} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Parciales</label>
                    <input value={palletsParciales} onChange={(e) => setPalletsParciales(num(e.target.value))} inputMode="numeric" className={selectClass} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Vacíos</label>
                    <input value={palletsVacios} onChange={(e) => setPalletsVacios(num(e.target.value))} inputMode="numeric" className={selectClass} />
                  </div>
                </div>
                {(palletsCompletos + palletsParciales + palletsVacios) !== remitoDescarga.palletsCarga && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    Volvieron {palletsCompletos + palletsParciales + palletsVacios} de {remitoDescarga.palletsCarga} pallets — la diferencia queda registrada en la liquidación.
                  </p>
                )}
              </div>

              <Button onClick={() => setConfirmando(true)} className="w-full">Revisar y registrar descarga</Button>
            </>
          )}
        </section>

        {/* ── Descargas de hoy ── */}
        <section className="space-y-2">
          <h2 className="font-semibold text-gray-800">Descargas de hoy</h2>
          {descargas.length === 0 && (
            <p className="text-gray-400 text-sm">Todavía no se registró ninguna descarga hoy.</p>
          )}
          {descargas.map((d) => (
            <div key={d.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{d.choferNombre}</p>
                <p className="text-xs text-gray-500">{d.camionLabel}</p>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {d.items.reduce((s, i) => s + i.cantidad, 0)} bolsas ·
                {' '}{d.palletsCompletos} completos · {d.palletsParciales} parciales · {d.palletsVacios} vacíos
                {d.bolsasRotas.length > 0 && ` · ${d.bolsasRotas.reduce((s, i) => s + i.cantidad, 0)} rotas`}
              </p>
            </div>
          ))}
        </section>

        {/* ── Confirmación de descarga ── */}
        {confirmando && remitoDescarga && (
          <Modal open onClose={() => setConfirmando(false)} title="Confirmar descarga">
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                {remitoDescarga.camionLabel} · <span className="font-medium">{remitoDescarga.choferNombre}</span>
              </p>
              <div className="border border-[#D3D1C7] rounded-lg divide-y divide-gray-100 text-sm">
                {toItems(sanas).map((i) => (
                  <div key={i.productoId} className="flex justify-between px-3 py-1.5">
                    <span className="text-gray-700">{i.nombre}</span>
                    <span className="font-medium text-gray-900">{i.cantidad}</span>
                  </div>
                ))}
                {toItems(rotas).map((i) => (
                  <div key={`rota-${i.productoId}`} className="flex justify-between px-3 py-1.5">
                    <span className="text-gray-700">{i.nombre} <span className="text-red-500 text-xs">(rotas)</span></span>
                    <span className="font-medium text-gray-900">{i.cantidad}</span>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-1.5 bg-gray-50">
                  <span className="text-gray-700">Pallets: completos / parciales / vacíos</span>
                  <span className="font-medium text-gray-900">{palletsCompletos} / {palletsParciales} / {palletsVacios}</span>
                </div>
              </div>
              <p className="text-xs text-gray-500">La descarga es definitiva — es el conteo contra el que se liquida el día.</p>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
                <Button onClick={registrarDescarga} loading={guardando} className="flex-1">Registrar</Button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </div>
  )
}
