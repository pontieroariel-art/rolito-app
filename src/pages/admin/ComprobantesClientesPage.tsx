import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckSquare, FileDown, FileText, Files, Mail, RefreshCw, Search, Share2, Square, Truck, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import MenuCompartirPdf, { type DatosMail, type PdfGenerado } from '@/components/ui/MenuCompartirPdf'
import EnvioLoteModal from '@/components/facturacion/EnvioLoteModal'
import VentasAppCliente from '@/components/facturacion/VentasAppCliente'
import RemitosPendientesTango from '@/components/facturacion/RemitosPendientesTango'
import { useAuth } from '@/context/AuthContext'
import { useClientesIndex } from '@/hooks/useClientesIndex'
import { useClienteSeleccionado } from '@/hooks/useClienteSeleccionado'
import { useTangoComprobantes } from '@/hooks/useTangoComprobantes'
import { useRefrescarComprobantesTango } from '@/hooks/useRefrescarComprobantesTango'
import { generarPdfsLote, type ProgresoLote } from '@/services/comprobantesLoteService'
import { obtenerFacturaPdf, obtenerRemitoPdf } from '@/services/facturaAdeudadaService'
import { subscribeSaldoCliente } from '@/services/saldosTangoService'
import { reportError } from '@/services/observability'
import { coincideBusqueda, normalizarBusqueda, INPUT_BUSQUEDA_PROPS } from '@/utils/busqueda'
import { compartirArchivos, descargarArchivos, puedeCompartirArchivos } from '@/utils/compartir'
import { armarComposicion, emailDelCliente, opcionesSucursal, type OpcionSucursal } from '@/utils/comprobantesTango'
import {
  armarItemsLote, armarMailLote, describirLote, etiquetaEstado, fechaCorta, fechaLarga, filtrarItems, resumenLote,
  type FiltroLote, type ItemLote,
} from '@/utils/comprobantesLote'
import { formatoARS } from '@/utils/money'
import { nombreSucursal } from '@/utils/sucursalesTango'
import { NOMBRE_EMPRESA_CORTO, estaVinculadoATango } from '@/utils/tangoEmpresas'
import { haceCuanto } from '@/pages/supervisor/SupervisorClientesPage'
import type { ComprobanteSaldoTango, UserProfile } from '@/types'
import type { GrupoRecibo as Grupo } from '@/utils/composicionSaldos'

// Comprobantes de clientes (2026-09-10, pedido de facturación): buscar un
// cliente, ver sus facturas/NC/ND y remitos de Tango de los últimos 12 meses
// (mismo dato que la ficha del supervisor: índice tangoComprobantes + saldo en
// caché), tildar los que hagan falta y mandarlos en bloque en UN mail al cliente
// (con todos los PDF adjuntos), compartirlos por WhatsApp o bajarlos. Cada fila
// también se entrega de a una. Al elegir un cliente se pide al bridge que
// refresque sus comprobantes desde Tango (una vez por cliente).

const MAX_RESULTADOS = 50
const INPUT = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
const TONO: Record<ReturnType<typeof etiquetaEstado>['tono'], string> = {
  pendiente: 'text-red-600', ok: 'text-accent', neutro: 'text-gray-500', anulado: 'text-gray-400',
}
const claveGrupo = (g: Grupo) => `${g.empresa}|${g.codigo}`

export default function ComprobantesClientesPage() {
  const [params, setParams] = useSearchParams()
  const clienteUid = params.get('cliente') ?? ''
  const elegirCliente = (uid: string) => setParams(uid ? { cliente: uid } : {}, { replace: false })

  return (
    <main className="max-w-7xl mx-auto p-4 space-y-4 pb-28">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Files size={22} className="text-accent" /> Comprobantes de clientes</h1>
        <p className="text-gray-500 text-sm">Buscá un cliente, elegí sus facturas y remitos de Tango y mandalos todos juntos por mail, WhatsApp o descarga.</p>
      </div>
      {/* Remitos anulados en la app que la oficina tiene que anular en Tango (2026-09-12). */}
      <RemitosPendientesTango />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
        <BuscadorClientes seleccionado={clienteUid} onElegir={elegirCliente} />
        {clienteUid
          ? <PanelCliente key={clienteUid} uid={clienteUid} onCerrar={() => elegirCliente('')} />
          : (
            <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-8 text-center text-sm text-gray-500">
              Elegí un cliente de la lista para ver sus comprobantes.
            </div>
          )}
      </div>
    </main>
  )
}

// ── Buscador ──────────────────────────────────────────────────────────────────

function BuscadorClientes({ seleccionado, onElegir }: { seleccionado: string; onElegir: (uid: string) => void }) {
  const { clientes, loading } = useClientesIndex()
  const [busqueda, setBusqueda] = useState('')
  const resultados = useMemo(() => {
    const q = normalizarBusqueda(busqueda)
    const base = q
      ? clientes.filter((c) => coincideBusqueda(q, c.razonSocial, c.nombreContacto, c.cuit, c.codigos.join(' '), c.sucursales.join(' '), c.direccion, c.localidad))
      : clientes
    return base.slice(0, MAX_RESULTADOS)
  }, [clientes, busqueda])

  return (
    <aside className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-3 space-y-2 lg:sticky lg:top-4">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input {...INPUT_BUSQUEDA_PROPS} autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre, código de Tango, CUIT o dirección…" aria-label="Buscar cliente"
          className={`${INPUT} pl-9`} />
      </div>
      {loading ? (
        <p className="text-sm text-gray-500 text-center py-6">Cargando clientes…</p>
      ) : resultados.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6">Ningún cliente coincide.</p>
      ) : (
        <>
          <p className="text-[11px] text-gray-500 px-1">
            {resultados.length === MAX_RESULTADOS ? `Primeros ${MAX_RESULTADOS} de ${clientes.length}: afiná la búsqueda` : `${resultados.length} ${resultados.length === 1 ? 'cliente' : 'clientes'}`}
          </p>
          <ul className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100 -mx-1">
            {resultados.map((c) => (
              <li key={c.uid}>
                <button type="button" onClick={() => onElegir(c.uid)}
                  className={`w-full text-left px-2 py-2 rounded-lg transition-colors ${c.uid === seleccionado ? 'bg-accent/10' : 'hover:bg-[#F8F7F2]'}`}>
                  <p className="text-sm font-medium text-gray-900 truncate">{c.razonSocial}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {c.codigos.length ? `${c.codigos[0]}${c.codigos.length > 1 ? ` +${c.codigos.length - 1}` : ''}` : 'Sin código de Tango'}{c.cuit ? ` · CUIT ${c.cuit}` : ''}
                  </p>
                  {c.localidad && <p className="text-[11px] text-gray-400 truncate">{c.localidad}</p>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}

// ── Panel del cliente ─────────────────────────────────────────────────────────

function PanelCliente({ uid, onCerrar }: { uid: string; onCerrar: () => void }) {
  const { user } = useAuth()
  const actor = useMemo(() => (user ? { uid: user.uid, nombre: user.nombre } : null), [user])
  const { cliente, loading } = useClienteSeleccionado(uid)
  const { indices, cargando: cargandoIndices } = useTangoComprobantes(cliente)
  const { refrescar, refrescando, aviso: avisoTango } = useRefrescarComprobantesTango(cliente ?? null, actor)
  const [pendientes, setPendientes] = useState<ComprobanteSaldoTango[]>([])
  const [saldoAl, setSaldoAl] = useState<{ toDate(): Date } | undefined>(undefined)

  // Saldo en caché (saldosTango): marca cuáles facturas siguen debiendo. La
  // consulta en vivo la piden supervisor/caja; acá alcanza con la caché.
  useEffect(() => subscribeSaldoCliente(uid, (s) => { setPendientes(s?.comprobantes ?? []); setSaldoAl(s?.actualizadoEn ?? undefined) }), [uid])

  const bloques = useMemo(() => armarComposicion(pendientes, indices, 'todas'), [pendientes, indices])
  const items = useMemo(() => armarItemsLote(bloques, indices), [bloques, indices])
  const opciones = useMemo(() => (cliente ? opcionesSucursal(cliente, bloques) : []), [cliente, bloques])

  const [filtro, setFiltro] = useState<FiltroLote>({ clase: 'todos', pendientes: false, sucursal: null, texto: '', desde: '', hasta: '' })
  const visibles = useMemo(() => filtrarItems(items, filtro), [items, filtro])
  const email = useMemo(() => emailDelCliente(cliente, indices, filtro.sucursal ?? null), [cliente, indices, filtro.sucursal])

  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set())
  const elegidos = useMemo(() => items.filter((i) => seleccion.has(i.clave)), [items, seleccion])
  const alternar = (clave: string) => setSeleccion((prev) => { const n = new Set(prev); if (n.has(clave)) n.delete(clave); else n.add(clave); return n })
  const todosVisiblesElegidos = visibles.length > 0 && visibles.every((i) => seleccion.has(i.clave))
  const alternarVisibles = () => setSeleccion((prev) => {
    const n = new Set(prev)
    if (todosVisiblesElegidos) visibles.forEach((i) => n.delete(i.clave))
    else visibles.forEach((i) => n.add(i.clave))
    return n
  })

  const clienteMail = useMemo(() => (cliente ? { uid: cliente.uid, razonSocial: cliente.razonSocial } : null), [cliente])
  const [mailAbierto, setMailAbierto] = useState(false)
  const [progreso, setProgreso] = useState<ProgresoLote | null>(null)
  const [aviso, setAviso] = useState('')
  const cancelar = useRef(false)
  useEffect(() => () => { cancelar.current = true }, [])

  // Descargar o compartir en bloque: se generan los PDF de a uno y salen juntos.
  const entregarLote = useCallback(async (modo: 'descargar' | 'compartir') => {
    if (!elegidos.length || !clienteMail) return
    setAviso('')
    cancelar.current = false
    setProgreso({ hecho: 0, total: elegidos.length, actual: elegidos[0] })
    try {
      const r = await generarPdfsLote(elegidos, setProgreso, () => cancelar.current)
      if (cancelar.current) return
      const avisos: string[] = []
      if (r.fallidos.length) avisos.push(`${r.fallidos.length === 1 ? 'No se pudo armar' : 'No se pudieron armar'} ${r.fallidos.map((f) => `${f.item.titulo} (${f.motivo})`).join('; ')}`)
      if (r.generados.length) {
        const archivos = r.generados.map((g) => ({ blob: g.blob, nombre: g.nombre }))
        if (modo === 'descargar') await descargarArchivos(archivos)
        else {
          const m = armarMailLote(r.generados.map((g) => g.item), clienteMail)
          const res = await compartirArchivos(archivos, { titulo: m.asunto, texto: m.mensaje })
          if (res === 'descargado') avisos.push('Este dispositivo no puede compartir archivos: se descargaron los PDF.')
        }
      }
      setAviso(avisos.join(' '))
    } catch (err) {
      reportError(err, { origen: 'ComprobantesClientesPage.lote', modo })
      setAviso('No se pudieron generar los PDF. Probá de nuevo.')
    } finally {
      setProgreso(null)
    }
  }, [elegidos, clienteMail])

  if (loading || !cliente) {
    return <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-8 text-center text-sm text-gray-500">{loading ? 'Cargando la ficha…' : 'No se encontró el cliente.'}</div>
  }
  if (!estaVinculadoATango(cliente)) {
    return (
      <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-6 space-y-2">
        <Cabecera cliente={cliente} email="" onCerrar={onCerrar} />
        <p className="text-sm text-gray-600">Este cliente no está vinculado a Tango: no tiene facturas ni remitos para mostrar.</p>
        <VentasAppCliente clienteUid={uid} />
      </div>
    )
  }

  const resumen = resumenLote(elegidos)
  const puedeCompartir = puedeCompartirArchivos()
  const ocupado = progreso !== null

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-3">
        <Cabecera cliente={cliente} email={email} onCerrar={onCerrar} />
        <p className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1">
          {(refrescando || cargandoIndices) && <RefreshCw size={12} className="animate-spin" />}
          {refrescando ? 'Actualizando facturas y remitos desde Tango…' : cargandoIndices ? 'Cargando…' : `Facturas y remitos de los últimos 12 meses${saldoAl ? ` · saldo de Tango ${haceCuanto(saldoAl) || 'en caché'}` : ''}`}
          {avisoTango && !refrescando && <span className={avisoTango.startsWith('Actualizado') ? 'text-accent' : 'text-amber-700'}>· {avisoTango}</span>}
          {!refrescando && (
            <button type="button" onClick={refrescar} className="text-accent font-medium hover:underline">Actualizar desde Tango</button>
          )}
        </p>

        <Filtros filtro={filtro} onChange={setFiltro} opciones={opciones} />
      </div>

      <div className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-[#F8F7F2] border-b border-[#D3D1C7]">
          <button type="button" onClick={alternarVisibles} disabled={!visibles.length} className="flex items-center gap-2 text-sm text-gray-700 disabled:opacity-50">
            {todosVisiblesElegidos ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} className="text-gray-400" />}
            {todosVisiblesElegidos ? 'Ninguno' : `Elegir ${visibles.length === items.length ? 'todos' : 'los visibles'}`}
          </button>
          <p className="text-xs text-gray-500">
            {visibles.length === items.length ? `${items.length} comprobantes` : `${visibles.length} de ${items.length} comprobantes`}
            {seleccion.size > 0 && <span className="text-gray-900 font-medium"> · {seleccion.size} {seleccion.size === 1 ? 'elegido' : 'elegidos'}</span>}
          </p>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-6 text-center">{cargandoIndices || refrescando ? 'Buscando comprobantes…' : 'No hay facturas ni remitos en los últimos 12 meses.'}</p>
        ) : visibles.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-6 text-center">Ningún comprobante coincide con el filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-gray-500">
                <tr className="border-b border-gray-100">
                  <th className="w-10" />
                  <th className="text-left px-2 py-2 font-semibold">Comprobante</th>
                  <th className="text-left px-2 py-2 font-semibold">Fecha</th>
                  {opciones.length > 0 && <th className="text-left px-2 py-2 font-semibold">Cuenta</th>}
                  <th className="text-right px-2 py-2 font-semibold">Importe</th>
                  <th className="text-left px-2 py-2 font-semibold">Estado</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibles.map((i) => (
                  // La clave incluye el mail: el menú de la fila lo toma al montarse
                  // (MenuCompartirPdf) y el mail de Tango puede llegar o cambiar después.
                  <FilaItem key={`${i.clave}|${email}`} item={i} elegido={seleccion.has(i.clave)} onAlternar={() => alternar(i.clave)}
                    cliente={cliente} email={email} conCuenta={opciones.length > 0} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {aviso && <p className="text-xs text-amber-700 px-1">{aviso}</p>}

      {/* Ventas hechas con la app: desde acá facturación anula las de días ya cerrados (2026-09-11). */}
      <VentasAppCliente clienteUid={uid} />

      {(seleccion.size > 0 || ocupado) && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-3xl bg-white rounded-2xl border border-[#D3D1C7] shadow-xl p-3 flex flex-wrap items-center gap-2">
          {progreso ? (
            <>
              <RefreshCw size={16} className="animate-spin text-accent" />
              <p className="text-sm text-gray-900 flex-1 min-w-0 truncate">Generando {progreso.hecho} de {progreso.total}{progreso.actual ? ` · ${progreso.actual.titulo}` : ''}</p>
              <Button variant="outline" size="sm" onClick={() => { cancelar.current = true }}>Cancelar</Button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-900 flex-1 min-w-[10rem]">
                <span className="font-semibold">{describirLote(resumen)}</span>
                {resumen.facturas > 1 && <span className="text-gray-500"> · {formatoARS(resumen.importeFacturas)}</span>}
              </p>
              <button type="button" onClick={() => setSeleccion(new Set())} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1"><X size={14} /> Limpiar</button>
              <Button variant="outline" size="sm" onClick={() => entregarLote('descargar')} disabled={ocupado}><FileDown size={16} className="mr-1" /> Descargar</Button>
              {puedeCompartir && <Button variant="outline" size="sm" onClick={() => entregarLote('compartir')} disabled={ocupado}><Share2 size={16} className="mr-1" /> WhatsApp</Button>}
              <Button size="sm" onClick={() => setMailAbierto(true)} disabled={ocupado}><Mail size={16} className="mr-1" /> Enviar por mail</Button>
            </>
          )}
        </div>
      )}

      {clienteMail && (
        <EnvioLoteModal abierto={mailAbierto} onClose={() => setMailAbierto(false)} items={elegidos} cliente={clienteMail} email={email}
          onEnviado={() => setSeleccion(new Set())} />
      )}
    </div>
  )
}

function Cabecera({ cliente, email, onCerrar }: { cliente: UserProfile; email: string; onCerrar: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-gray-900 truncate">{cliente.razonSocial}</h2>
        <p className="text-xs text-gray-500">
          {[cliente.cuit ? `CUIT ${cliente.cuit}` : '', cliente.codigoCliente ? `Cód. ${cliente.codigoCliente}` : ''].filter(Boolean).join(' · ')}
        </p>
        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
          <Mail size={12} className="text-gray-400" />
          {email ? <span>{email} <span className="text-gray-400">(ficha de Tango)</span></span> : <span className="text-amber-700">Sin mail en Tango: al enviar vas a tener que escribirlo.</span>}
        </p>
      </div>
      <button type="button" onClick={onCerrar} aria-label="Cerrar cliente" className="text-gray-400 hover:text-gray-700 p-1 -m-1 shrink-0"><X size={18} /></button>
    </div>
  )
}

function Filtros({ filtro, onChange, opciones }: { filtro: FiltroLote; onChange: (f: FiltroLote) => void; opciones: OpcionSucursal[] }) {
  const set = (parte: Partial<FiltroLote>) => onChange({ ...filtro, ...parte })
  const sucursalKey = filtro.sucursal ? claveGrupo(filtro.sucursal) : ''
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex gap-1">
        {(['todos', 'facturas', 'remitos'] as const).map((c) => (
          <button key={c} type="button" onClick={() => set({ clase: c })}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${(filtro.clase ?? 'todos') === c ? 'bg-accent text-white border-accent' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
            {c === 'todos' ? 'Todo' : c === 'facturas' ? 'Facturas' : 'Remitos'}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1.5 text-xs text-gray-700 py-1.5">
        <input type="checkbox" checked={!!filtro.pendientes} onChange={(e) => set({ pendientes: e.target.checked })} className="accent-accent" />
        Solo pendientes
      </label>
      {opciones.length > 0 && (
        <select value={sucursalKey} onChange={(e) => set({ sucursal: opciones.find((o) => claveGrupo(o.grupo) === e.target.value)?.grupo ?? null })}
          aria-label="Cuenta / sucursal" className={`${INPUT} w-auto py-1.5 text-xs`}>
          <option value="">Todas las cuentas</option>
          {opciones.map((o) => <option key={claveGrupo(o.grupo)} value={claveGrupo(o.grupo)}>{o.etiqueta}</option>)}
        </select>
      )}
      <label className="text-xs text-gray-500">
        Desde
        <input type="date" value={filtro.desde ?? ''} onChange={(e) => set({ desde: e.target.value })} className={`${INPUT} py-1 text-xs mt-0.5`} />
      </label>
      <label className="text-xs text-gray-500">
        Hasta
        <input type="date" value={filtro.hasta ?? ''} onChange={(e) => set({ hasta: e.target.value })} className={`${INPUT} py-1 text-xs mt-0.5`} />
      </label>
      <div className="relative flex-1 min-w-[10rem]">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input {...INPUT_BUSQUEDA_PROPS} value={filtro.texto ?? ''} onChange={(e) => set({ texto: e.target.value })} placeholder="Número…" aria-label="Buscar por número"
          className={`${INPUT} pl-8 py-1.5 text-xs`} />
      </div>
    </div>
  )
}

// ── Fila ──────────────────────────────────────────────────────────────────────

function FilaItem({ item, elegido, onAlternar, cliente, email, conCuenta }: {
  item: ItemLote; elegido: boolean; onAlternar: () => void; cliente: UserProfile; email: string; conCuenta: boolean
}) {
  const estado = etiquetaEstado(item)
  const mail = useMemo<DatosMail>(() => {
    const m = armarMailLote([item], cliente)
    return { para: email, asunto: m.asunto, mensaje: m.mensaje, comprobante: m.comprobante, clienteUid: cliente.uid, clienteNombre: cliente.razonSocial,
      presentacion: {
        titulo: item.titulo, emoji: item.clase === 'factura' ? (item.tipo === 'FAC' ? '🧾' : '📄') : '🚚',
        filas: item.clase === 'factura'
          ? [
            ...(item.fecha ? [{ label: 'Emisión', value: fechaLarga(item.fecha) }] : []),
            ...(item.fechaVencimiento ? [{ label: 'Vencimiento', value: fechaLarga(item.fechaVencimiento) }] : []),
            { label: 'Importe', value: formatoARS(item.importe) },
            ...(item.pendiente !== null && item.pendiente !== item.importe ? [{ label: 'Pendiente', value: formatoARS(item.pendiente) }] : []),
            ...(item.estado !== 'pendiente' ? [{ label: 'Estado', value: estado.texto }] : []),
          ]
          : [...(item.fecha ? [{ label: 'Fecha', value: fechaLarga(item.fecha) }] : []), ...(item.bultos ? [{ label: 'Bultos', value: String(item.bultos) }] : [])],
      } }
  }, [item, cliente, email, estado.texto])
  const generar = (): Promise<PdfGenerado> => item.clase === 'factura'
    ? obtenerFacturaPdf({ tipo: item.tipo, numero: item.numero }, item.empresa)
    : obtenerRemitoPdf(item.numero, item.empresa)
  const anulado = estado.tono === 'anulado'
  const grupo: Grupo = { empresa: item.empresa, codigo: item.codigo }

  return (
    <tr className={`${elegido ? 'bg-accent/5' : ''} hover:bg-[#F8F7F2] cursor-pointer`} onClick={onAlternar}>
      <td className="pl-3 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={elegido} onChange={onAlternar} aria-label={`Elegir ${item.titulo}`} className="accent-accent w-4 h-4 cursor-pointer" />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {item.clase === 'factura' ? <FileText size={15} className="text-gray-400 shrink-0" /> : <Truck size={15} className="text-gray-400 shrink-0" />}
          <div className="min-w-0">
            <p className={`font-medium truncate ${anulado ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{item.titulo}</p>
            {item.clase === 'factura' && item.remitos.length > 0 && (
              <p className="text-[11px] text-gray-500 truncate">{item.remitos.length === 1 ? 'Remito' : 'Remitos'} {item.remitos.map((r) => r.replace(/^R(\d{5})(\d{8})$/, '$1-$2')).join(', ')}</p>
            )}
            {item.clase === 'remito' && item.bultos > 0 && <p className="text-[11px] text-gray-500">{item.bultos} bultos</p>}
          </div>
        </div>
      </td>
      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">
        {fechaCorta(item.fecha)}
        {item.clase === 'factura' && item.fechaVencimiento && <span className="block text-[11px] text-gray-400">Vto. {fechaCorta(item.fechaVencimiento)}</span>}
      </td>
      {conCuenta && (
        <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap">
          {NOMBRE_EMPRESA_CORTO[item.empresa]} · {item.codigo}
          {nombreSucursal(cliente, grupo.empresa, grupo.codigo) && <span className="block text-[11px] text-gray-400 truncate max-w-[12rem]">{nombreSucursal(cliente, grupo.empresa, grupo.codigo)}</span>}
        </td>
      )}
      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
        {item.clase === 'factura' ? (
          <>
            <span className={anulado ? 'text-gray-400' : 'text-gray-900'}>{formatoARS(item.importe)}</span>
            {item.pendiente !== null && item.pendiente !== item.importe && <span className="block text-[11px] text-red-600">debe {formatoARS(item.pendiente)}</span>}
          </>
        ) : <span className="text-gray-400">—</span>}
      </td>
      <td className={`px-2 py-2 text-xs ${TONO[estado.tono]}`}>{estado.texto}</td>
      <td className="pr-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
        <MenuCompartirPdf titulo={item.titulo} texto={`${item.titulo} — ${cliente.razonSocial}`} mail={mail} generar={generar}
          trigger={(abrir, ocupado) => (
            <button type="button" onClick={abrir} disabled={ocupado} aria-label={`Enviar ${item.titulo}`}
              className="w-8 h-8 rounded-lg border border-[#D3D1C7] inline-flex items-center justify-center text-accent hover:bg-accent/10 disabled:opacity-50">
              {ocupado ? <RefreshCw size={14} className="animate-spin" /> : <Share2 size={14} />}
            </button>
          )} />
      </td>
    </tr>
  )
}
