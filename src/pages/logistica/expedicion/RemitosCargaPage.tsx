import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Eye, Minus, Pencil, Plus, Trash2, Truck } from 'lucide-react'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import Badge from '@/components/common/Badge'
import PageHeader from '@/components/common/PageHeader'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { useFlota } from '@/hooks/useFlota'
import { useDepositosReparto } from '@/hooks/useDepositosReparto'
import { etiquetaDeposito, identidadDeposito, nombreDeposito, ordenarDepositosReparto } from '@/utils/depositos'
import { useCatalogo } from '@/hooks/useCatalogo'
import { useDiaActual, useFechaDelDia } from '@/hooks/useDiaActual'
import { palletsInfo } from '@/services/remitoCargaService'
import {
  borrarBorradorCarga, crearBorradorCarga, editarBorradorCarga, subscribeBorradoresDe,
} from '@/services/borradorCargaService'
import { useRemitosCargaDelDia } from '@/hooks/useExpedicionDia'
import { generateRemitoCarga } from '@/utils/pdf'
import { BorradorCarga, PLANTAS, RemitoCarga, RemitoCargaEstado, RemitoCargaItem } from '@/types'
import { reportError } from '@/services/observability'
import RacksInput from '@/components/expedicion/RacksInput'
import CotDestinoForm, { faltantesDestinoPlan } from '@/components/expedicion/CotDestinoForm'
import { useCotConfig } from '@/hooks/useCotConfig'
import { formatoRespaldo, kgDeItems, requiereCot } from '@/utils/cot'
import { generateRemitoCargaOficial } from '@/utils/remitoCargaOficialPdf'
import type { CotDestinoPlan } from '@/types'
import { AROS_POR_TARIMA_MADERA, PUNTALES_POR_PALLET, SOMBREROS_POR_PALLET, describirEnvases, envasesDeRemito } from '@/utils/envases'

// Planificación de la carga (2026-09-18). Esta pantalla YA NO EMITE EL REMITO.
//
// Hasta ahora caja emitía a las 17 el remito del camión que salía a las 4 de la
// mañana: el papel nacía trece horas antes del traslado y el COT viajaba con una
// hora de salida que no era la real, que es justo lo que ARBA mira en la ruta.
//
// Ahora caja PLANIFICA: arma el borrador de carga (qué mercadería, qué camión,
// qué repartidor, para qué día) y muelle emite el remito —con su número, su COT
// y su papel— recién cuando entrega el camión y el camión se va.
//
// El destino del COT se pide SIEMPRE, aunque la carga planificada no llegue al
// umbral: si muelle corrige la carga hacia arriba y lo cruza, el COT tiene que
// poder salir sin ir a buscar al destinatario a las 4 de la mañana.

const ESTADO_LABELS: Record<RemitoCargaEstado, string> = {
  emitido:   'Emitido',
  entregado: 'Entregado',
  salido:    'Salió',
  liquidado: 'Liquidado',
}
const ESTADO_TONOS: Record<RemitoCargaEstado, 'pendiente' | 'confirmado' | 'entregado' | 'neutro'> = {
  emitido:   'pendiente',
  entregado: 'confirmado',
  salido:    'entregado',
  liquidado: 'neutro',
}

const OTRO_CAMION = '__otro__'

export default function RemitosCargaPage() {
  const { user } = useAuth()
  const { camiones } = useFlota()
  const { depositos } = useDepositosReparto()
  const { catalogo } = useCatalogo()

  const plantaId = user?.planta ?? 'torcuato'
  const fecha = useFechaDelDia()
  const hoyClave = useDiaActual()

  // Arranca en HOY (2026-09-18, corrección de Ariel): durante el día se arman
  // cargas para el mismo día — el segundo viaje sale a la tarde. La del camión
  // de la madrugada se arma eligiendo mañana a mano.
  const [paraFecha,  setParaFecha]  = useState(hoyClave)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [camionId,   setCamionId]   = useState('')
  // "Otro camión": patente tipeada a mano (2026-09-06, pedido de Ariel). Como en
  // Bluesoft: tercerizados y camiones de temporada que no están en la flota.
  const [patenteManual, setPatenteManual] = useState('')
  // Código del depósito de Tango del repartidor (expedición por depósito, 2026-09-06).
  const [depositoCod, setDepositoCod] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  // Cuando la cantidad no cierra en pallets justos, caja decide si el resto
  // viaja en un pallet propio (true) o suelto arriba del camión (default).
  const [restoEnPallet, setRestoEnPallet] = useState<Record<string, boolean>>({})
  // Envases que salen (2026-09-07): muelle le dicta a caja cuántos pallets son
  // de madera y cuántos de metal, y qué racks de agua van.
  const [tarimasMadera, setTarimasMadera] = useState(0)
  const [palletsMetal,  setPalletsMetal]  = useState(0)
  const [metalEditado,  setMetalEditado]  = useState(false)
  const [racks,         setRacks]         = useState<number[]>([])
  const [confirmando, setConfirmando] = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')
  const [aviso,       setAviso]       = useState('')
  const { abrir } = useVisorComprobante()
  const remitos = useRemitosCargaDelDia(plantaId, fecha)
  const { cfg: cotCfg } = useCotConfig()
  const [cotDestino, setCotDestino] = useState<CotDestinoPlan | null>(null)
  // Al reabrir un borrador, el destino guardado precarga el formulario del COT.
  const [cotInicial, setCotInicial] = useState<CotDestinoPlan | null>(null)

  // Borradores del día que se planifica y de hoy (los de hoy son la carga que
  // muelle todavía no emitió: caja los sigue pudiendo corregir).
  const [borradores, setBorradores] = useState<BorradorCarga[]>([])
  const fechasBorrador = useMemo(
    () => [...new Set([hoyClave, paraFecha])],
    [hoyClave, paraFecha],
  )
  useEffect(
    () => subscribeBorradoresDe(plantaId, fechasBorrador, setBorradores),
    [plantaId, fechasBorrador],
  )

  const camionesActivos = useMemo(() => camiones.filter((c) => c.activo), [camiones])
  const camionFlota = camionesActivos.find((c) => c.id === camionId)
  const patenteLimpia = patenteManual.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const camion = camionId === OTRO_CAMION
    ? (patenteLimpia.length >= 6 ? { id: `manual:${patenteLimpia}`, patente: patenteLimpia, modelo: 'sin registrar' } : undefined)
    : camionFlota
  // Primero los depósitos que ya tienen carga hoy en esta planta.
  const depositosReparto = useMemo(
    () => ordenarDepositosReparto(depositos, new Set(remitos.map((r) => r.choferId))),
    [depositos, remitos],
  )
  const deposito = depositosReparto.find((d) => d.codigo === depositoCod)

  // Los pallets NO se cargan a mano: los justos se derivan de las bolsas (floor
  // por producto, con las unidades por pallet del catálogo) y el excedente suma
  // un pallet más solo si caja tilda "va en pallet propio".
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
  const envases = useMemo(() => ({ tarimasMadera, palletsMetal, racks }), [tarimasMadera, palletsMetal, racks])
  // Kilos de la carga PLANIFICADA según config/cot.productos. Muelle los recalcula al aceptar.
  const { kg, sinPeso } = useMemo(() => kgDeItems(items, cotCfg.productos), [items, cotCfg.productos])
  const cruzaUmbral = requiereCot(kg, cotDestino?.respaldo.importe ?? 0, cotCfg)
  const num = (v: string) => Math.max(0, Math.min(999, parseInt(v.replace(/\D/g, ''), 10) || 0))
  const inputEnvase = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  // Los borradores del día que se está planificando, y los de hoy que muelle
  // todavía no emitió (caja los puede seguir corrigiendo).
  const borradoresDelDia = useMemo(() => borradores.filter((b) => b.paraFecha === paraFecha), [borradores, paraFecha])
  const borradoresDeHoy  = useMemo(() => borradores.filter((b) => b.paraFecha === hoyClave && b.estado === 'pendiente'), [borradores, hoyClave])
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

  const limpiar = useCallback(() => {
    setEditandoId(null)
    setCamionId('')
    setPatenteManual('')
    setDepositoCod('')
    setCantidades({})
    setRestoEnPallet({})
    setTarimasMadera(0); setPalletsMetal(0); setMetalEditado(false); setRacks([])
    setCotDestino(null); setCotInicial(null)
    setError('')
  }, [])

  const editar = (b: BorradorCarga) => {
    limpiar()
    setEditandoId(b.id)
    setParaFecha(b.paraFecha)
    const enFlota = camionesActivos.some((x) => x.id === b.camionId)
    if (enFlota) setCamionId(b.camionId)
    else { setCamionId(OTRO_CAMION); setPatenteManual(b.camionId.replace(/^manual:/, '')) }
    if (b.depositoTango) setDepositoCod(b.depositoTango)
    setCantidades(Object.fromEntries(b.items.map((i) => [i.productoId, i.cantidad])))
    setRestoEnPallet({})
    setCotInicial(b.cotDestino)
    setCotDestino(b.cotDestino)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const borrar = async (b: BorradorCarga) => {
    if (!window.confirm(`¿Dar de baja la carga de ${b.camionLabel} para el ${b.paraFecha}? Muelle deja de verla.`)) return
    try {
      await borrarBorradorCarga(b.id)
      if (editandoId === b.id) limpiar()
      setAviso(`Se dio de baja la carga de ${b.camionLabel}.`)
    } catch (err) {
      reportError(err, { origen: 'RemitosCargaPage', accion: 'borrar borrador' })
      setAviso('No se pudo dar de baja la carga. Probá de nuevo.')
    }
  }

  const confirmar = async () => {
    if (!user || !camion || !deposito) return
    setGuardando(true)
    setError('')
    // El destino del COT es obligatorio siempre (ver comentario de cabecera).
    const faltas = faltantesDestinoPlan(cotDestino)
    if (faltas.length) { setError(faltas.join(' ')); setGuardando(false); return }
    try {
      const datos = {
        paraFecha,
        camionId:     camion.id,
        camionLabel:  `${camion.patente} · ${camion.modelo}`,
        choferId:     identidadDeposito(deposito),
        choferNombre: nombreDeposito(deposito),
        depositoTango: deposito.codigo,
        depositoTangoNombre: deposito.nombre,
        items,
        envases,
        kg,
        cotDestino:   cotDestino as CotDestinoPlan,
      }
      if (editandoId) {
        await editarBorradorCarga(editandoId, datos)
        setAviso(`Carga corregida: ${datos.camionLabel} para el ${paraFecha}.`)
      } else {
        await crearBorradorCarga(datos, { uid: user.uid, nombre: user.nombre, plantaId })
        setAviso(`Carga armada para ${datos.choferNombre} (${datos.camionLabel}). Muelle emite el remito cuando entregue el camión.`)
      }
      setConfirmando(false)
      limpiar()
    } catch (err) {
      reportError(err, { origen: 'RemitosCargaPage', accion: 'guardar borrador' })
      setError('No se pudo guardar la carga. Revisá la conexión e intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  // Los remitos ya emitidos son de muelle: caja solo los mira.
  const verRemito = async (r: RemitoCarga) => {
    try {
      const blob = await (r.remitoR
        ? generateRemitoCargaOficial(r)
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
        }))
      if (blob) abrir({ blob, nombre: `${r.codigo}.pdf`, titulo: r.remitoR ? `Remito R ${r.codigo}` : `Remito de carga ${r.codigo}`, subtitulo: `${r.camionLabel} · ${r.choferNombre}` })
    } catch (err) { reportError(err, { origen: 'RemitosCargaPage', accion: 'ver remito' }) }
  }

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo="Cargas de los camiones"
        icono={<ClipboardList size={22} />}
        contexto={`${PLANTAS[plantaId].label} · caja arma la carga, muelle emite el remito al entregar el camión`}
        chips={borradoresDelDia.length > 0 ? <Badge tono="confirmado">{borradoresDelDia.length} armada{borradoresDelDia.length === 1 ? '' : 's'}</Badge> : undefined}
      />

      {aviso && <p className="text-xs text-gray-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">{aviso}</p>}

      {/* ── Nueva carga ── */}
      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Truck size={18} className="text-accent" /> {editandoId ? 'Corregir la carga' : 'Armar una carga'}
          </h2>
          {editandoId && (
            <button type="button" onClick={limpiar} className="text-xs text-secundario hover:text-accent underline underline-offset-2">
              Cancelar la corrección
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-secundario mb-1 block">¿Para qué día es la carga?</label>
            <input type="date" value={paraFecha} onChange={(e) => setParaFecha(e.target.value || hoyClave)} className={selectClass} />
            <p className="text-[11px] text-secundario mt-0.5">El primer viaje se arma el día anterior.</p>
          </div>
          <div>
            <label className="text-xs text-secundario mb-1 block">Camión</label>
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
            <label className="text-xs text-secundario mb-1 block">Repartidor (depósito de Tango)</label>
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
          <p className="text-xs text-secundario mb-2">Mercadería</p>
          <div className="space-y-2">
            {catalogo.map((p) => {
              const info = palletsInfo(p, cantidades[p.id] ?? 0)
              const pallets = info ? info.completos + (info.resto > 0 && restoEnPallet[p.id] ? 1 : 0) : 0
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-gray-800">
                      {p.nombre}
                      {pallets > 0 && (
                        <span className="ml-2 text-xs text-accent font-medium">{pallets} pallet{pallets > 1 ? 's' : ''}</span>
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
                        className="w-16 text-center bg-white border border-[#D3D1C7] rounded-lg py-1.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setCantidad(p.id, +1)}
                        className="w-8 h-8 rounded-lg border border-[#D3D1C7] text-gray-600 flex items-center justify-center hover:bg-gray-50 active:scale-95"
                      ><Plus size={14} /></button>
                    </div>
                  </div>
                  {info && info.resto > 0 && (
                    <label className="flex items-center gap-2 mt-1 ml-3 text-xs text-secundario cursor-pointer select-none">
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

        {/* ── Destino del COT ── obligatorio siempre, no solo por encima del umbral. */}
        {sinPeso.length > 0 && items.length > 0 && (
          <p className="text-xs text-amber-600">Sin peso por unidad en Ajustes → COT de ARBA: {sinPeso.join(', ')}. Los kilos de la carga no los cuentan.</p>
        )}
        {cruzaUmbral && !cotCfg.habilitado && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            La carga pesa {kg.toLocaleString('es-AR')} kg y necesita COT de ARBA, pero la presentación desde la app está apagada (Ajustes → COT de ARBA): hay que sacarlo a mano en la web de ARBA.
          </p>
        )}
        <CotDestinoForm plantaId={plantaId} cfg={cotCfg} kg={kg} patente={camion?.patente ?? ''} valor={cotInicial} onChange={setCotDestino} />

        {/* Los ENVASES ya no se declaran acá (corrección de Ariel, 18/09): caja
            no sabe con qué tipo de pallet va a salir la carga ni qué racks se van
            a usar. Los cuenta MUELLE al entregar el camión, y van al remito. */}

        <Button onClick={() => setConfirmando(true)} disabled={!puedeConfirmar} className="w-full">
          {editandoId ? 'Revisar y guardar la corrección' : 'Revisar y dejar la carga para el muelle'}
        </Button>
        <p className="text-xs text-secundario text-center">
          Esto es la instrucción para el muelle, no un papel: no lleva número, ni COT presentado, ni remito impreso. El remito lo emite muelle al entregar el camión.
        </p>
      </section>

      {/* ── Cargas armadas (borradores) ── */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario">
          Cargas armadas · esperando al muelle
        </h2>
        {borradoresDelDia.length === 0 && borradoresDeHoy.length === 0 && (
          <p className="text-secundario text-sm">Todavía no armaste ninguna carga.</p>
        )}
        {[...borradoresDelDia, ...borradoresDeHoy].map((b) => (
          <div key={b.id} className={`bg-white rounded-xl border shadow-sm p-3 flex items-center gap-3 ${editandoId === b.id ? 'border-accent' : 'border-[#D3D1C7]'}`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate" title={b.camionLabel}>
                {b.camionLabel} <span className="font-normal text-secundario">· {b.choferNombre}</span>
              </p>
              <p className="text-xs text-secundario truncate">
                Para el {b.paraFecha === hoyClave ? 'día de hoy' : b.paraFecha} · <span className="tabular-nums">{b.items.reduce((s, i) => s + i.cantidad, 0)}</span> bolsas
                {b.kg ? <> · <span className="tabular-nums">{b.kg.toLocaleString('es-AR')}</span> kg</> : null}
                {' · COT a '}{b.cotDestino.destino.tipo === 'planta' ? PLANTAS[b.cotDestino.destino.plantaId].label : b.cotDestino.destino.razonSocial}
              </p>
            </div>
            <Badge tono={b.estado === 'pendiente' ? 'pendiente' : b.estado === 'aceptado' ? 'entregado' : 'neutro'}>
              {b.estado === 'pendiente' ? 'Sin emitir' : b.estado === 'aceptado' ? 'Emitida por muelle' : 'Vencida'}
            </Badge>
            {b.estado === 'pendiente' && (
              <>
                <button onClick={() => editar(b)} title="Corregir la carga"
                  className="text-secundario hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10">
                  <Pencil size={16} />
                </button>
                <button onClick={() => borrar(b)} title="Dar de baja la carga"
                  className="text-secundario hover:text-red-600 transition-colors p-2 rounded-lg hover:bg-red-50">
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        ))}
      </section>

      {/* ── Remitos que ya emitió muelle (solo lectura) ── */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario">Remitos emitidos hoy por el muelle</h2>
        {remitos.length === 0 && (
          <p className="text-secundario text-sm">Todavía no salió ningún camión hoy.</p>
        )}
        {remitos.map((r) => (
          <div key={r.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                {r.codigo}
                {r.remitoR && <span className="ml-2 text-xs font-medium text-secundario">Remito R {formatoRespaldo({ prefijo: r.remitoR.puntoVenta, numero: r.remitoR.numero })}</span>}
              </p>
              <p className="text-xs text-secundario truncate">
                {r.camionLabel} · {r.choferNombre} · <span className="tabular-nums">{r.items.reduce((s, i) => s + i.cantidad, 0)}</span> bolsas{r.kg ? ` · ${r.kg.toLocaleString('es-AR')} kg` : ''}
                {describirEnvases(envasesDeRemito(r)) && ` · ${describirEnvases(envasesDeRemito(r))}`}
              </p>
            </div>
            {r.cotSolicitud && (
              r.cot?.estado === 'presentado'
                ? <Badge tono="confirmado" title={r.cot.fechaValidez ? `Válido hasta ${r.cot.fechaValidez}` : ''}>COT {r.cot.numero}</Badge>
                : <Badge tono={r.cot?.estado === 'error' ? 'cancelado' : 'aviso'} title={r.cot?.error ?? 'Todavía no se presentó a ARBA'}>
                    {r.cot?.estado === 'error' ? 'COT con error' : 'COT pendiente'}
                  </Badge>
            )}
            <Badge tono={ESTADO_TONOS[r.estado]}>{ESTADO_LABELS[r.estado]}</Badge>
            <button
              onClick={() => verRemito(r)}
              title="Ver el remito que emitió muelle"
              className="text-secundario hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10"
            >
              <Eye size={16} />
            </button>
          </div>
        ))}
      </section>

      {/* ── Confirmación ── */}
      {confirmando && (
        <Modal open onClose={() => setConfirmando(false)} title={editandoId ? 'Guardar la corrección de la carga' : 'Dejar la carga para el muelle'}>
          <div className="space-y-3">
            <div className="text-sm text-gray-700 space-y-1">
              <p><span className="text-secundario">Para el día:</span> {paraFecha}</p>
              <p><span className="text-secundario">Camión:</span> {camion?.patente} · {camion?.modelo}</p>
              <p><span className="text-secundario">Repartidor:</span> {deposito ? etiquetaDeposito(deposito) : ''}</p>
            </div>
            <div className="border border-[#D3D1C7] rounded-lg divide-y divide-[#E7E5DC]">
              {items.map((i) => (
                <div key={i.productoId} className="flex justify-between px-3 py-1.5 text-sm">
                  <span className="text-gray-700">
                    {i.nombre}
                    {i.pallets ? <span className="ml-2 text-xs text-secundario">{i.pallets} pallet{i.pallets > 1 ? 's' : ''}</span> : null}
                  </span>
                  <span className="font-medium text-gray-900 tabular-nums">{i.cantidad}</span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-1.5 text-sm bg-[#F8F7F2]">
                <span className="text-gray-700">Pallets de carga</span>
                <span className="font-medium text-gray-900 tabular-nums">{palletsCarga}</span>
              </div>
              <div className="px-3 py-1.5 text-xs text-gray-600 bg-[#F8F7F2]">
                Envases: {describirEnvases(envasesDeRemito({ palletsCarga, envases })) || 'ninguno'}
              </div>
              <div className="px-3 py-1.5 text-xs text-gray-600 bg-[#F8F7F2]">
                Peso planificado: <span className="tabular-nums">{kg.toLocaleString('es-AR')}</span> kg{cruzaUmbral ? ' · supera el umbral del COT' : ''}
                {cotDestino && ` · COT a ${cotDestino.destino.tipo === 'planta' ? PLANTAS[cotDestino.destino.plantaId].label : cotDestino.destino.razonSocial}`}
              </div>
            </div>
            <p className="text-xs text-secundario">
              Queda como instrucción para el muelle. El remito, su número y el COT salen cuando muelle entregue el camión: acá no se imprime nada.
            </p>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <p className="text-red-500 text-sm">{error}</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmar} loading={guardando} className="flex-1">{editandoId ? 'Guardar la corrección' : 'Dejar la carga'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}
