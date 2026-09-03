import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useMotivosReparacion, useTiposReparacion } from '../../hooks/useReparacionCatalogos'
import { useMotivosIngreso } from '../../hooks/useMotivosIngreso'
import { usePasosTaller } from '../../hooks/usePasosTaller'
import { useAuth } from '../../context/AuthContext'
import { saveMotivosReparacion, saveTiposReparacion } from '../../services/reparacionCatalogService'
import { saveMotivosIngreso } from '../../services/motivoIngresoService'
import { savePasosTaller } from '../../services/pasosTallerService'
import { registrarAccionRutina, ActorAdmin } from '../../services/historialAdminService'
import {
  AREAS_HELADERA, AreaHeladera, MotivoIngreso, MotivoReparacion, PasoTaller,
  TipoOperacionIngreso, TipoPipelineHeladera, TipoReparacion,
} from '../../types'
import { AREA_HELADERA_LABELS, SECTORES_REPARACION, TIPO_OPERACION_LABELS, TIPO_PIPELINE_LABELS } from '../../utils/heladeraLabels'
import { reportError } from '@/services/observability'

function nuevoId(nombre: string) {
  return `${nombre.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}_${Date.now()}`
}

// ── Motivos de ingreso a depósito ────────────────────────────────────────────

function MotivosIngresoEditor({ motivos, onSaved }: { motivos: MotivoIngreso[]; onSaved: () => void }) {
  const [nombre, setNombre] = useState('')
  const [tipoOperacion, setTipoOperacion] = useState<TipoOperacionIngreso>('CAMBIO')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleAdd = async () => {
    if (!nombre.trim()) return
    setSaving(true)
    setError('')
    try {
      const nuevo: MotivoIngreso = { id: nuevoId(nombre), nombre: nombre.trim(), tipoOperacion, activo: true }
      await saveMotivosIngreso([...motivos, nuevo])
      onSaved()
      setNombre('')
    } catch {
      setError('No se pudo guardar. Revisá tu conexión y reintentá.')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (id: string, patch: Partial<MotivoIngreso>) => {
    setError('')
    try {
      await saveMotivosIngreso(motivos.map((m) => (m.id === id ? { ...m, ...patch } : m)))
      onSaved()
    } catch {
      setError('No se pudo guardar. Revisá tu conexión y reintentá.')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar este motivo de ingreso?')) return
    setError('')
    try {
      await saveMotivosIngreso(motivos.filter((m) => m.id !== id))
      onSaved()
    } catch {
      setError('No se pudo eliminar. Revisá tu conexión y reintentá.')
    }
  }

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Motivos de ingreso a depósito</h2>
        <p className="text-xs text-gray-500 mt-1">
          Por qué entra una heladera al taller. Es obligatorio al cargarla. El tipo de operación
          (retiro o cambio) queda fijo por motivo.
        </p>
      </div>

      <div className="space-y-1.5">
        {motivos.map((m) => (
          <div key={m.id} className="flex items-center gap-3 bg-gray-50 border border-[#D3D1C7] rounded-lg px-3 py-2.5">
            <span className={`flex-1 text-sm ${m.activo ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{m.nombre}</span>
            <span className="text-xs text-gray-500 shrink-0">{TIPO_OPERACION_LABELS[m.tipoOperacion]}</span>
            <button
              onClick={() => toggle(m.id, { activo: !m.activo })}
              className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-3 py-1.5 transition-colors shrink-0"
            >
              {m.activo ? 'Desactivar' : 'Activar'}
            </button>
            <button onClick={() => remove(m.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {motivos.length === 0 && <p className="text-gray-400 text-sm">Todavía no cargaste ningún motivo.</p>}
      </div>

      {error && <p className="text-red-500 text-xs">{error}</p>}

      <div className="border-t border-gray-200 pt-4 flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-gray-500 uppercase tracking-wide">Nuevo motivo</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: cambio por motor"
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Tipo</label>
          <select
            value={tipoOperacion}
            onChange={(e) => setTipoOperacion(e.target.value as TipoOperacionIngreso)}
            className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="CAMBIO">Cambio</option>
            <option value="RETIRO">Retiro</option>
          </select>
        </div>
        <button
          onClick={handleAdd}
          disabled={saving || !nombre.trim()}
          className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-opacity"
        >
          Agregar
        </button>
      </div>
    </section>
  )
}

// ── Motivos de reparación ────────────────────────────────────────────────────

function MotivosEditor({ motivos, onSaved }: { motivos: MotivoReparacion[]; onSaved: () => void }) {
  const [nombre, setNombre] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleAdd = async () => {
    if (!nombre.trim()) return
    setSaving(true)
    setError('')
    try {
      const nuevo: MotivoReparacion = { id: nuevoId(nombre), nombre: nombre.trim(), activo: true, requiereChofer: false, urgente: false }
      await saveMotivosReparacion([...motivos, nuevo])
      onSaved()
      setNombre('')
    } catch {
      setError('No se pudo guardar. Revisá tu conexión y reintentá.')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (id: string, patch: Partial<MotivoReparacion>) => {
    setError('')
    try {
      await saveMotivosReparacion(motivos.map((m) => (m.id === id ? { ...m, ...patch } : m)))
      onSaved()
    } catch {
      setError('No se pudo guardar. Revisá tu conexión y reintentá.')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar este motivo de reparación?')) return
    setError('')
    try {
      await saveMotivosReparacion(motivos.filter((m) => m.id !== id))
      onSaved()
    } catch {
      setError('No se pudo eliminar. Revisá tu conexión y reintentá.')
    }
  }

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Motivos de reparación</h2>
        <p className="text-xs text-gray-500 mt-1">
          Qué le pasa a la heladera. Se elige al tomar un service. Marcá "requiere chofer" para los
          motivos que son retiro, cambio o entrega de equipo (van a un chofer, no a un técnico).
        </p>
      </div>

      <div className="space-y-1.5">
        {motivos.map((m) => (
          <div key={m.id} className="flex items-center gap-3 bg-gray-50 border border-[#D3D1C7] rounded-lg px-3 py-2.5">
            <span className={`flex-1 text-sm ${m.activo ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{m.nombre}</span>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
              <input type="checkbox" checked={!!m.requiereChofer} onChange={(e) => toggle(m.id, { requiereChofer: e.target.checked })} />
              Requiere chofer
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
              <input type="checkbox" checked={!!m.urgente} onChange={(e) => toggle(m.id, { urgente: e.target.checked })} />
              Urgente
            </label>
            <button
              onClick={() => toggle(m.id, { activo: !m.activo })}
              className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-3 py-1.5 transition-colors shrink-0"
            >
              {m.activo ? 'Desactivar' : 'Activar'}
            </button>
            <button onClick={() => remove(m.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {motivos.length === 0 && <p className="text-gray-400 text-sm">Todavía no cargaste ningún motivo.</p>}
      </div>

      {error && <p className="text-red-500 text-xs">{error}</p>}

      <div className="border-t border-gray-200 pt-4 flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs text-gray-500 uppercase tracking-wide">Nuevo motivo</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: no enfría, pierde gas, retiro de heladera"
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={saving || !nombre.trim()}
          className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-opacity"
        >
          Agregar
        </button>
      </div>
    </section>
  )
}

// ── Tipos de reparación ──────────────────────────────────────────────────────

function TiposEditor({ tipos, onSaved }: { tipos: TipoReparacion[]; onSaved: () => void }) {
  const [nombre, setNombre] = useState('')
  const [area,   setArea]   = useState<AreaHeladera>(SECTORES_REPARACION[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleAdd = async () => {
    if (!nombre.trim()) return
    setSaving(true)
    setError('')
    try {
      const nuevo: TipoReparacion = { id: nuevoId(nombre), nombre: nombre.trim(), activo: true, area }
      await saveTiposReparacion([...tipos, nuevo])
      onSaved()
      setNombre('')
    } catch {
      setError('No se pudo guardar. Revisá tu conexión y reintentá.')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (id: string, patch: Partial<TipoReparacion>) => {
    setError('')
    try {
      await saveTiposReparacion(tipos.map((t) => (t.id === id ? { ...t, ...patch } : t)))
      onSaved()
    } catch {
      setError('No se pudo guardar. Revisá tu conexión y reintentá.')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar este tipo de reparación?')) return
    setError('')
    try {
      await saveTiposReparacion(tipos.filter((t) => t.id !== id))
      onSaved()
    } catch {
      setError('No se pudo eliminar. Revisá tu conexión y reintentá.')
    }
  }

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Tipos de reparación</h2>
        <p className="text-xs text-gray-500 mt-1">
          Qué trabajo se le hizo al equipo — sectorizado por pintura/lijado/refrigeración. Cada
          técnico y cada integrante de taller solo ve los tipos de su propio sector.
        </p>
      </div>

      <div className="space-y-1.5">
        {tipos.map((t) => (
          <div key={t.id} className="flex items-center gap-3 bg-gray-50 border border-[#D3D1C7] rounded-lg px-3 py-2.5">
            <span className={`flex-1 text-sm ${t.activo ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{t.nombre}</span>
            <select
              value={t.area}
              onChange={(e) => toggle(t.id, { area: e.target.value as AreaHeladera })}
              className="text-xs bg-white border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-accent shrink-0"
            >
              {SECTORES_REPARACION.map((a) => <option key={a} value={a}>{AREA_HELADERA_LABELS[a]}</option>)}
            </select>
            <button
              onClick={() => toggle(t.id, { activo: !t.activo })}
              className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-3 py-1.5 transition-colors shrink-0"
            >
              {t.activo ? 'Desactivar' : 'Activar'}
            </button>
            <button onClick={() => remove(t.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {tipos.length === 0 && <p className="text-gray-400 text-sm">Todavía no cargaste ningún tipo.</p>}
      </div>

      {error && <p className="text-red-500 text-xs">{error}</p>}

      <div className="border-t border-gray-200 pt-4 flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-gray-500 uppercase tracking-wide">Nuevo tipo</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: cambio de termostato, carga de gas"
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Sector</label>
          <select
            value={area}
            onChange={(e) => setArea(e.target.value as AreaHeladera)}
            className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {SECTORES_REPARACION.map((a) => <option key={a} value={a}>{AREA_HELADERA_LABELS[a]}</option>)}
          </select>
        </div>
        <button
          onClick={handleAdd}
          disabled={saving || !nombre.trim()}
          className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-opacity"
        >
          Agregar
        </button>
      </div>
    </section>
  )
}

// ── Pasos de taller (pipeline de fabricación y reacondicionamiento) ─────────

function PasosTallerEditor({ pasos, onSaved }: { pasos: Record<string, PasoTaller>; onSaved: () => void }) {
  const [nombre, setNombre]                       = useState('')
  const [tipoPipeline, setTipoPipeline]           = useState<TipoPipelineHeladera>('fabricacion')
  const [area, setArea]                           = useState<AreaHeladera>('plastico')
  const [requiereAprobacion, setRequiereAprobacion] = useState(false)
  const [saving, setSaving]                       = useState(false)
  const [error, setError]                         = useState('')

  const porTipo = (tipo: TipoPipelineHeladera) =>
    Object.values(pasos).filter((p) => p.tipoPipeline === tipo).sort((a, b) => a.orden - b.orden)

  const handleAdd = async () => {
    if (!nombre.trim()) return
    setSaving(true)
    setError('')
    try {
      const id       = nuevoId(nombre)
      const maxOrden = porTipo(tipoPipeline).reduce((m, p) => Math.max(m, p.orden), 0)
      const nuevo: PasoTaller = {
        id, nombre: nombre.trim(), tipoPipeline, area, orden: maxOrden + 1, activo: true,
        requiereAprobacion, siguientePasoId: null,
      }
      await savePasosTaller({ ...pasos, [id]: nuevo })
      onSaved()
      setNombre('')
      setRequiereAprobacion(false)
    } catch {
      setError('No se pudo guardar. Revisá tu conexión y reintentá.')
    } finally {
      setSaving(false)
    }
  }

  const patch = async (id: string, cambios: Partial<PasoTaller>) => {
    setError('')
    try {
      await savePasosTaller({ ...pasos, [id]: { ...pasos[id], ...cambios } })
      onSaved()
    } catch {
      setError('No se pudo guardar. Revisá tu conexión y reintentá.')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar este paso de taller?')) return
    setError('')
    try {
      const resto = { ...pasos }
      delete resto[id]
      await savePasosTaller(resto)
      onSaved()
    } catch {
      setError('No se pudo eliminar. Revisá tu conexión y reintentá.')
    }
  }

  const mover = async (tipo: TipoPipelineHeladera, id: string, direccion: -1 | 1) => {
    const lista  = porTipo(tipo)
    const idx    = lista.findIndex((p) => p.id === id)
    const vecino = lista[idx + direccion]
    if (!vecino) return
    const actual = lista[idx]
    setError('')
    try {
      await savePasosTaller({
        ...pasos,
        [actual.id]:  { ...actual, orden: vecino.orden },
        [vecino.id]:  { ...vecino, orden: actual.orden },
      })
      onSaved()
    } catch {
      setError('No se pudo guardar el orden. Revisá tu conexión y reintentá.')
    }
  }

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-xl p-5 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Pasos de taller</h2>
        <p className="text-xs text-gray-500 mt-1">
          Los pasos del pipeline de fabricación (heladeras nuevas) y de reacondicionamiento
          (heladeras usadas). El orden define la secuencia; "requiere aprobación" agrega un control
          con aprobar/rechazar (como control de calidad) en vez de una única salida.
        </p>
      </div>

      {(['fabricacion', 'reacondicionamiento'] as const).map((tipo) => {
        const lista = porTipo(tipo)
        return (
          <div key={tipo} className="space-y-1.5">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{TIPO_PIPELINE_LABELS[tipo]}</h3>
            {lista.length === 0 && <p className="text-gray-400 text-sm">Todavía no hay pasos.</p>}
            {lista.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 bg-gray-50 border border-[#D3D1C7] rounded-lg px-3 py-2.5">
                <div className="flex flex-col shrink-0">
                  <button
                    disabled={i === 0}
                    onClick={() => mover(tipo, p.id, -1)}
                    className="text-gray-400 hover:text-gray-900 disabled:opacity-30 disabled:hover:text-gray-400"
                  ><ChevronUp size={14} /></button>
                  <button
                    disabled={i === lista.length - 1}
                    onClick={() => mover(tipo, p.id, 1)}
                    className="text-gray-400 hover:text-gray-900 disabled:opacity-30 disabled:hover:text-gray-400"
                  ><ChevronDown size={14} /></button>
                </div>
                <span className={`flex-1 text-sm ${p.activo ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{p.nombre}</span>
                <span className="text-xs text-gray-500 shrink-0">{AREA_HELADERA_LABELS[p.area]}</span>
                {p.requiereAprobacion && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">requiere aprobación</span>
                )}
                <button
                  onClick={() => patch(p.id, { activo: !p.activo })}
                  className="text-xs text-gray-500 hover:text-gray-900 border border-[#D3D1C7] hover:border-accent rounded-lg px-3 py-1.5 transition-colors shrink-0"
                >
                  {p.activo ? 'Desactivar' : 'Activar'}
                </button>
                <button onClick={() => remove(p.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )
      })}

      {error && <p className="text-red-500 text-xs">{error}</p>}

      <div className="border-t border-gray-200 pt-4 flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-gray-500 uppercase tracking-wide">Nuevo paso</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Ensamble e inyectado"
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Pipeline</label>
          <select
            value={tipoPipeline}
            onChange={(e) => setTipoPipeline(e.target.value as TipoPipelineHeladera)}
            className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="fabricacion">Fabricación</option>
            <option value="reacondicionamiento">Reacondicionamiento</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Sector</label>
          <select
            value={area}
            onChange={(e) => setArea(e.target.value as AreaHeladera)}
            className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {AREAS_HELADERA.map((a) => <option key={a} value={a}>{AREA_HELADERA_LABELS[a]}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 pb-2">
          <input type="checkbox" checked={requiereAprobacion} onChange={(e) => setRequiereAprobacion(e.target.checked)} />
          Requiere aprobación
        </label>
        <button
          onClick={handleAdd}
          disabled={saving || !nombre.trim()}
          className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-opacity"
        >
          Agregar
        </button>
      </div>
    </section>
  )
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function CatalogosServicePage() {
  const { user } = useAuth()
  const { motivos, isLoading: loadingMotivos } = useMotivosReparacion()
  const { tipos, isLoading: loadingTipos }     = useTiposReparacion()
  const { motivos: motivosIngreso, isLoading: loadingMotivosIngreso } = useMotivosIngreso()
  const { pasos, isLoading: loadingPasos }     = usePasosTaller()
  const qc = useQueryClient()

  // Auditoría a nivel de catálogo (no de ítem individual): cada editor ya
  // llama a onSaved() después de cualquier alta/edición/baja — alcanza para
  // el resumen diario, sin tener que instrumentar los 3 handlers de los 4
  // editores por separado.
  const logCatalogo = (coleccion: string, detalle: string) => {
    if (!user) return
    registrarAccionRutina({
      coleccion, docId: coleccion, accion: 'modificado', detalle,
      actor: { uid: user.uid, nombre: user.nombre, rol: user.rol } as ActorAdmin,
    }).catch((err) => reportError(err, { origen: 'CatalogosServicePage', accion: 'no se pudo registrar cambio de catálogo' }))
  }

  if (loadingMotivos || loadingTipos || loadingMotivosIngreso || loadingPasos) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catálogos de service</h1>
          <p className="text-gray-500 text-sm">Pasos de taller, motivos de ingreso, motivos y tipos de reparación</p>
        </div>

        <PasosTallerEditor pasos={pasos} onSaved={() => { qc.invalidateQueries({ queryKey: ['pasosTaller'] }); logCatalogo('pasosTaller', 'Pasos de taller') }} />
        <MotivosIngresoEditor motivos={motivosIngreso} onSaved={() => { qc.invalidateQueries({ queryKey: ['motivosIngreso'] }); logCatalogo('motivosIngreso', 'Motivos de ingreso') }} />
        <MotivosEditor motivos={motivos} onSaved={() => { qc.invalidateQueries({ queryKey: ['motivosReparacion'] }); logCatalogo('motivosReparacion', 'Motivos de reparación') }} />
        <TiposEditor tipos={tipos} onSaved={() => { qc.invalidateQueries({ queryKey: ['tiposReparacion'] }); logCatalogo('tiposReparacion', 'Tipos de reparación') }} />
      </main>
    </div>
  )
}
