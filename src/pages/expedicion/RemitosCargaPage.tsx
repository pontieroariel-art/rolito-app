import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus, Printer, Truck } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useFlota } from '../../hooks/useFlota'
import { useDepositosReparto } from '../../hooks/useDepositosReparto'
import { etiquetaDeposito, identidadDeposito, nombreDeposito, ordenarDepositosReparto } from '../../utils/depositos'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useFechaDelDia } from '../../hooks/useDiaActual'
import { crearRemitoCarga, palletsInfo, subscribeRemitosCargaDelDia } from '../../services/remitoCargaService'
import { generateRemitoCarga } from '../../utils/pdf'
import { PLANTAS, RemitoCarga, RemitoCargaEstado, RemitoCargaItem } from '../../types'
import { reportError } from '@/services/observability'
import RacksInput from '@/components/expedicion/RacksInput'
import CotCargaForm from '@/components/expedicion/CotCargaForm'
import { useCotConfig } from '@/hooks/useCotConfig'
import { presentarCotRemito } from '@/services/cotConfigService'
import { formatoRespaldo, kgDeItems, requiereCot, talonarioRemitoCarga, validarSolicitudCot } from '@/utils/cot'
import { generateRemitoCargaOficial } from '@/utils/remitoCargaOficialPdf'
import { TalonarioRemitoCargaNoInicializadoError } from '../../services/remitoCargaService'
import type { CotSolicitud } from '../../types'
import { AROS_POR_PALLET, PUNTALES_POR_PALLET, describirEnvases, envasesDeRemito } from '@/utils/envases'

const ESTADO_LABELS: Record<RemitoCargaEstado, string> = {
  emitido:   'Emitido',
  entregado: 'Entregado',
  salido:    'Salió',
  liquidado: 'Liquidado',
}
const ESTADO_COLORS: Record<RemitoCargaEstado, string> = {
  emitido:   'bg-amber-100 text-amber-700 border-amber-200',
  entregado: 'bg-blue-100 text-blue-700 border-blue-200',
  salido:    'bg-green-100 text-green-700 border-green-200',
  liquidado: 'bg-gray-100 text-gray-600 border-gray-200',
}

// Pantalla principal del rol caja (Fase 1 del módulo expedición): armar el
// remito de carga del camión, imprimirlo para muelle y ver los del día.
const OTRO_CAMION = '__otro__'

export default function RemitosCargaPage() {
  const { user } = useAuth()
  const { camiones } = useFlota()
  const { depositos } = useDepositosReparto()
  const { catalogo } = useCatalogo()

  const plantaId = user?.planta ?? 'torcuato'
  const fecha = useFechaDelDia()

  const [camionId,   setCamionId]   = useState('')
  // "Otro camión": patente tipeada a mano (2026-09-06, pedido de Ariel). Como en
  // Bluesoft: tercerizados y camiones de temporada que no están en la flota.
  // Se guarda camionId = 'manual:<PATENTE>' y camionLabel = la patente.
  const [patenteManual, setPatenteManual] = useState('')
  // Código del depósito de Tango del repartidor (expedición por depósito,
  // 2026-09-06): la carga se emite a un depósito, tenga o no usuario en la app.
  const [depositoCod, setDepositoCod] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  // Cuando la cantidad no cierra en pallets justos, caja decide si el resto
  // viaja en un pallet propio (true) o suelto arriba del camión (default).
  const [restoEnPallet, setRestoEnPallet] = useState<Record<string, boolean>>({})
  // Envases que salen (2026-09-07): muelle le dicta a caja cuántos pallets son
  // de madera y cuántos de metal, y qué racks de agua van. El total sugerido
  // sigue saliendo de la mercadería; mientras caja no toque "metal", el
  // sugerido menos la madera cae en metal solo.
  const [tarimasMadera, setTarimasMadera] = useState(0)
  const [palletsMetal,  setPalletsMetal]  = useState(0)
  const [metalEditado,  setMetalEditado]  = useState(false)
  const [racks,         setRacks]         = useState<number[]>([])
  const [confirmando, setConfirmando] = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')
  const [remitos,     setRemitos]     = useState<RemitoCarga[]>([])
  // COT de ARBA (2026-09-10): lo que caja declara cuando la carga supera el umbral.
  const { cfg: cotCfg } = useCotConfig()
  const [cotSolicitud, setCotSolicitud] = useState<CotSolicitud | null>(null)
  const [presentandoCot, setPresentandoCot] = useState<string | null>(null)
  const [avisoCot, setAvisoCot] = useState('')

  useEffect(
    () => subscribeRemitosCargaDelDia(plantaId, fecha, setRemitos),
    [plantaId, fecha],
  )

  const camionesActivos = useMemo(() => camiones.filter((c) => c.activo), [camiones])
  const camionFlota = camionesActivos.find((c) => c.id === camionId)
  const patenteLimpia = patenteManual.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const camion = camionId === OTRO_CAMION
    ? (patenteLimpia.length >= 6 ? { id: `manual:${patenteLimpia}`, patente: patenteLimpia, modelo: 'sin registrar' } : undefined)
    : camionFlota
  // Primero los depósitos que ya tienen remito hoy en esta planta.
  const depositosReparto = useMemo(
    () => ordenarDepositosReparto(depositos, new Set(remitos.map((r) => r.choferId))),
    [depositos, remitos],
  )
  const deposito = depositosReparto.find((d) => d.codigo === depositoCod)

  // Los pallets NO se cargan a mano: los pallets justos se derivan de las
  // bolsas (floor por producto, con las unidades por pallet del catálogo) y el
  // excedente suma un pallet más solo si caja tilda "va en pallet propio".
  // Cada pallet = 1 base de metal + 4 puntales — en la descarga las bases
  // vuelven completas, parciales o vacías.
  const items: RemitoCargaItem[] = useMemo(
    () => catalogo
      .filter((p) => (cantidades[p.id] ?? 0) > 0)
      .map((p) => {
        const cantidad = cantidades[p.id]
        const info     = palletsInfo(p, cantidad)
        const pallets  = info
          ? info.completos + (info.resto > 0 && restoEnPallet[p.id] ? 1 : 0)
          : 0
        return { productoId: p.id, nombre: p.nombre, cantidad, ...(pallets > 0 ? { pallets } : {}) }
      }),
    [catalogo, cantidades, restoEnPallet],
  )

  const palletsSugeridos = items.reduce((s, i) => s + (i.pallets ?? 0), 0)
  useEffect(() => {
    if (!metalEditado) setPalletsMetal(Math.max(0, palletsSugeridos - tarimasMadera))
  }, [palletsSugeridos, tarimasMadera, metalEditado])
  const palletsCarga = tarimasMadera + palletsMetal
  const envases = { tarimasMadera, palletsMetal, racks }
  // Kilos de la carga según config/cot.productos; si supera el umbral, hace falta COT.
  const { kg, sinPeso } = useMemo(() => kgDeItems(items, cotCfg.productos), [items, cotCfg.productos])
  const requiereCotCarga = requiereCot(kg, cotSolicitud?.respaldo.importe ?? 0, cotCfg)
  const pideCot = requiereCotCarga && cotCfg.habilitado
  // Talonario del remito R oficial de la carga (00025 con CAI vigente): si está, la app numera e imprime el R.
  const talonarioR = useMemo(() => talonarioRemitoCarga(cotCfg), [cotCfg])
  const num = (v: string) => Math.max(0, Math.min(999, parseInt(v.replace(/\D/g, ''), 10) || 0))
  const inputEnvase = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  const setCantidad = (productoId: string, delta: number) =>
    setCantidades((prev) => {
      const next = Math.max(0, Math.min(99999, (prev[productoId] ?? 0) + delta))
      return { ...prev, [productoId]: next }
    })

  const setCantidadInput = (productoId: string, value: string) => {
    const n = Math.max(0, Math.min(99999, parseInt(value.replace(/\D/g, ''), 10) || 0))
    setCantidades((prev) => ({ ...prev, [productoId]: n }))
  }

  const puedeConfirmar = !!camion && !!deposito && items.length > 0

  // Con remito R numerado por la app sale el papel oficial "PARA REPARTO"; si no, el interno.
  const imprimir = (r: RemitoCarga) => r.remitoR
    ? generateRemitoCargaOficial(r).catch((err) => reportError(err, { origen: 'RemitosCargaPage', accion: 'error al generar el remito R' }))
    : generateRemitoCarga({
      codigo:       r.codigo,
      plantaId:     r.plantaId,
      camionLabel:  r.camionLabel,
      choferNombre: r.choferNombre,
      items:        r.items,
      palletsCarga: r.palletsCarga,
      envases:      r.envases,
      creadoPor:    r.creadoPor,
      fecha:        r.fecha.toDate(),
      ...(r.cot?.estado === 'presentado' && r.cot.numero ? { cot: { numero: r.cot.numero, fechaValidez: r.cot.fechaValidez } } : {}),
      ...(r.kg ? { kg: r.kg } : {}),
    }).catch((err) => reportError(err, { origen: 'RemitosCargaPage', accion: 'error al generar el PDF' }))

  // Reintento manual de la presentación a ARBA (quedó en error o se emitió con la presentación apagada).
  const reintentarCot = async (r: RemitoCarga) => {
    setPresentandoCot(r.id)
    setAvisoCot('')
    try {
      const res = await presentarCotRemito(r.id)
      setAvisoCot(res.ok ? `${r.codigo}: COT ${res.cot} obtenido.` : `${r.codigo}: ${res.error ?? 'ARBA no devolvió COT.'}`)
    } catch (err) {
      reportError(err, { origen: 'RemitosCargaPage', accion: 'reintentar COT' })
      setAvisoCot(`${r.codigo}: no se pudo presentar a ARBA. Probá de nuevo.`)
    } finally {
      setPresentandoCot(null)
    }
  }

  const confirmar = async () => {
    if (!user || !camion || !deposito) return
    setGuardando(true)
    setError('')
    // COT: si la carga lo requiere y la presentación está habilitada, la solicitud tiene que estar completa.
    if (pideCot) {
      const faltas = cotSolicitud ? validarSolicitudCot(cotSolicitud, { respaldoAuto: !!talonarioR }) : ['Completá los datos del COT de ARBA (destinatario, remito R, importe).']
      if (faltas.length) { setError(faltas.join(' ')); setGuardando(false); return }
    }
    try {
      const remito = await crearRemitoCarga(
        {
          camionId:     camion.id,
          camionLabel:  `${camion.patente} · ${camion.modelo}`,
          choferId:     identidadDeposito(deposito),
          choferNombre: nombreDeposito(deposito),
          depositoTango: deposito.codigo,
          depositoTangoNombre: deposito.nombre,
          items,
          envases,
          kg,
          ...(pideCot && cotSolicitud ? { cotSolicitud } : {}),
          ...(talonarioR ? { remitoR: talonarioR } : {}),
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setConfirmando(false)
      setCamionId('')
      setPatenteManual('')
      setDepositoCod('')
      setCantidades({})
      setRestoEnPallet({})
      setTarimasMadera(0); setPalletsMetal(0); setMetalEditado(false); setRacks([])
      setCotSolicitud(null)
      imprimir(remito)
    } catch (err) {
      reportError(err, { origen: 'RemitosCargaPage', accion: 'error al crear' })
      setError(err instanceof TalonarioRemitoCargaNoInicializadoError ? err.message : 'No se pudo crear el remito. Revisá la conexión e intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Remitos de carga</h1>
        <p className="text-gray-500 text-sm">{PLANTAS[plantaId].label}</p>
      </div>

      {/* ── Nuevo remito ── */}
      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2"><Truck size={18} className="text-accent" /> Nueva carga</h2>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Camión</label>
            <select value={camionId} onChange={(e) => setCamionId(e.target.value)} className={selectClass}>
              <option value="">Elegir camión…</option>
              {camionesActivos.map((c) => (
                <option key={c.id} value={c.id}>{c.patente} · {c.modelo}</option>
              ))}
              <option value={OTRO_CAMION}>Otro camión (escribir la patente)…</option>
            </select>
            {camionId === OTRO_CAMION && (
              <input
                value={patenteManual}
                onChange={(e) => setPatenteManual(e.target.value)}
                placeholder="Patente, ej. AB123CD"
                maxLength={10}
                autoFocus
                className={`${selectClass} mt-2 uppercase`}
              />
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Repartidor (depósito de Tango)</label>
            <select value={depositoCod} onChange={(e) => setDepositoCod(e.target.value)} className={selectClass}>
              <option value="">Elegir repartidor…</option>
              {depositosReparto.map((d) => (
                <option key={d.codigo} value={d.codigo}>{etiquetaDeposito(d)}{d.uid ? '' : ' · sin usuario en la app'}</option>
              ))}
            </select>
            {depositosReparto.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No hay depósitos de reparto cargados: sincronizalos desde Ajustes → Depósitos.</p>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-500 mb-2">Mercadería</p>
          <div className="space-y-2">
            {catalogo.map((p) => {
              const info = palletsInfo(p, cantidades[p.id] ?? 0)
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-gray-800">
                      {p.nombre}
                      {info && info.completos > 0 && (
                        <span className="ml-2 text-xs text-accent font-medium">
                          {info.completos + (info.resto > 0 && restoEnPallet[p.id] ? 1 : 0)} pallet{(info.completos + (info.resto > 0 && restoEnPallet[p.id] ? 1 : 0)) > 1 ? 's' : ''}
                        </span>
                      )}
                      {info && info.completos === 0 && info.resto > 0 && restoEnPallet[p.id] && (
                        <span className="ml-2 text-xs text-accent font-medium">1 pallet</span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setCantidad(p.id, -1)}
                        className="w-8 h-8 rounded-lg border border-[#D3D1C7] text-gray-600 flex items-center justify-center hover:bg-gray-50 active:scale-95"
                      ><Minus size={14} /></button>
                      <input
                        value={cantidades[p.id] ?? 0}
                        onChange={(e) => setCantidadInput(p.id, e.target.value)}
                        inputMode="numeric"
                        className="w-16 text-center bg-white border border-[#D3D1C7] rounded-lg py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setCantidad(p.id, +1)}
                        className="w-8 h-8 rounded-lg border border-[#D3D1C7] text-gray-600 flex items-center justify-center hover:bg-gray-50 active:scale-95"
                      ><Plus size={14} /></button>
                    </div>
                  </div>
                  {info && info.resto > 0 && (
                    <label className="flex items-center gap-2 mt-1 ml-3 text-xs text-gray-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={restoEnPallet[p.id] ?? false}
                        onChange={(e) => setRestoEnPallet((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                        className="accent-[#1D9E75]"
                      />
                      {info.resto} suelta{info.resto > 1 ? 's' : ''} — tildá si van en pallet propio
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── COT de ARBA ── solo cuando la carga supera el umbral (kilos / importe). */}
        {sinPeso.length > 0 && items.length > 0 && (
          <p className="text-xs text-amber-600">Sin peso por unidad en Ajustes → COT de ARBA: {sinPeso.join(', ')}. Los kilos de la carga no los cuentan.</p>
        )}
        {requiereCotCarga && !cotCfg.habilitado && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            La carga pesa {kg.toLocaleString('es-AR')} kg y necesita COT de ARBA, pero la presentación desde la app está apagada (Ajustes → COT de ARBA): hay que sacarlo a mano en la web de ARBA.
          </p>
        )}
        {pideCot && (
          <CotCargaForm plantaId={plantaId} cfg={cotCfg} kg={kg} patente={camion?.patente ?? ''} respaldoAuto={!!talonarioR} onChange={setCotSolicitud} />
        )}

        {/* ── Envases que salen ── muelle se lo dicta a caja al cargar. Cada
            pallet lleva 4 puntales y 1 aro implícitos; los racks de agua van
            por número. Solo avisa si no cierra con el sugerido, no bloquea. */}
        <div className="bg-accent/5 border border-accent/20 rounded-lg px-3 py-3 space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm font-medium text-gray-800">Envases que salen</p>
            <p className="text-xs text-gray-500">Sugerido por la mercadería: <b className="text-gray-700">{palletsSugeridos}</b> pallet{palletsSugeridos === 1 ? '' : 's'}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Pallets de madera (completos)</label>
              <input value={tarimasMadera} onChange={(e) => setTarimasMadera(num(e.target.value))} inputMode="numeric" className={inputEnvase} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Pallets de metal</label>
              <input value={palletsMetal} onChange={(e) => { setMetalEditado(true); setPalletsMetal(num(e.target.value)) }} inputMode="numeric" className={inputEnvase} />
            </div>
          </div>
          <p className="text-xs text-gray-600">
            = <b>{palletsCarga}</b> pallet{palletsCarga === 1 ? '' : 's'} · {palletsCarga * PUNTALES_POR_PALLET} puntales · {palletsCarga * AROS_POR_PALLET} aro{palletsCarga === 1 ? '' : 's'}
            {metalEditado && (
              <button type="button" onClick={() => setMetalEditado(false)} className="ml-2 text-accent hover:underline">Volver al sugerido</button>
            )}
          </p>
          {palletsCarga !== palletsSugeridos && (
            <p className="text-xs text-amber-600">
              Salen {palletsCarga} pallets y la mercadería sugiere {palletsSugeridos}. Se emite igual; revisá con muelle.
            </p>
          )}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Racks de agua (números)</label>
            <RacksInput value={racks} onChange={setRacks} />
          </div>
        </div>

        <Button onClick={() => setConfirmando(true)} disabled={!puedeConfirmar} className="w-full">
          Revisar y emitir remito
        </Button>
      </section>

      {/* ── Remitos del día ── */}
      <section className="space-y-2">
        <h2 className="font-semibold text-gray-800">Remitos de hoy</h2>
        {avisoCot && <p className="text-xs text-gray-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">{avisoCot}</p>}
        {remitos.length === 0 && (
          <p className="text-gray-400 text-sm">Todavía no se emitió ningún remito hoy.</p>
        )}
        {remitos.map((r) => (
          <div key={r.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                {r.codigo}
                {r.remitoR && <span className="ml-2 text-xs font-medium text-gray-500">Remito R {formatoRespaldo({ prefijo: r.remitoR.puntoVenta, numero: r.remitoR.numero })}</span>}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {r.camionLabel} · {r.choferNombre} · {r.items.reduce((s, i) => s + i.cantidad, 0)} bolsas{r.kg ? ` · ${r.kg.toLocaleString('es-AR')} kg` : ''}
                {describirEnvases(envasesDeRemito(r)) && ` · ${describirEnvases(envasesDeRemito(r))}`}
              </p>
            </div>
            {r.cotSolicitud && (
              r.cot?.estado === 'presentado'
                ? <span className="text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap bg-blue-100 text-blue-700 border-blue-200" title={r.cot.fechaValidez ? `Válido hasta ${r.cot.fechaValidez}` : ''}>COT {r.cot.numero}</span>
                : (
                  <button type="button" onClick={() => reintentarCot(r)} disabled={presentandoCot === r.id}
                    title={r.cot?.error ?? 'Todavía no se presentó a ARBA'}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${r.cot?.estado === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'} disabled:opacity-50`}>
                    {presentandoCot === r.id ? 'Presentando…' : r.cot?.estado === 'error' ? 'COT con error · reintentar' : 'COT pendiente · presentar'}
                  </button>
                )
            )}
            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${ESTADO_COLORS[r.estado]}`}>
              {ESTADO_LABELS[r.estado]}
            </span>
            <button
              onClick={() => imprimir(r)}
              title="Reimprimir remito"
              className="text-gray-400 hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10"
            >
              <Printer size={16} />
            </button>
          </div>
        ))}
      </section>

      {/* ── Confirmación ── */}
      {confirmando && (
        <Modal open onClose={() => setConfirmando(false)} title="Confirmar remito de carga">
          <div className="space-y-3">
            <div className="text-sm text-gray-700 space-y-1">
              <p><span className="text-gray-500">Camión:</span> {camion?.patente} · {camion?.modelo}</p>
              <p><span className="text-gray-500">Repartidor:</span> {deposito ? etiquetaDeposito(deposito) : ''}</p>
            </div>
            <div className="border border-[#D3D1C7] rounded-lg divide-y divide-gray-100">
              {items.map((i) => (
                <div key={i.productoId} className="flex justify-between px-3 py-1.5 text-sm">
                  <span className="text-gray-700">
                    {i.nombre}
                    {i.pallets ? <span className="ml-2 text-xs text-gray-400">{i.pallets} pallet{i.pallets > 1 ? 's' : ''}</span> : null}
                  </span>
                  <span className="font-medium text-gray-900">{i.cantidad}</span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-1.5 text-sm bg-gray-50">
                <span className="text-gray-700">Pallets de carga</span>
                <span className="font-medium text-gray-900">{palletsCarga}</span>
              </div>
              <div className="px-3 py-1.5 text-xs text-gray-600 bg-gray-50">
                Envases: {describirEnvases(envasesDeRemito({ palletsCarga, envases })) || 'ninguno'}
              </div>
              {kg > 0 && (
                <div className="px-3 py-1.5 text-xs text-gray-600 bg-gray-50">
                  Peso: {kg.toLocaleString('es-AR')} kg
                  {pideCot && cotSolicitud
                    ? ` · COT de ARBA: ${cotSolicitud.destino.tipo === 'planta' ? `traslado a ${PLANTAS[cotSolicitud.destino.plantaId].label}` : `a ${cotSolicitud.destino.razonSocial}`}, remito R ${cotSolicitud.respaldo.numero}`
                    : requiereCotCarga ? ' · requiere COT' : ''}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Al confirmar se asigna el número correlativo y se imprime el remito para muelle.
            </p>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <p className="text-red-500 text-sm">{error}</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmar} loading={guardando} className="flex-1">Emitir e imprimir</Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}
