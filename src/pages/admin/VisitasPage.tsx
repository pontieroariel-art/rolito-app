import { useState, useEffect, ChangeEvent } from 'react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useProgramasVisita, useVisitasPuntuales, programasParaFecha, visitasParaFecha } from '../../hooks/useVisitas'
import { useChoferes } from '../../hooks/useChoferes'
import { getAllUsers } from '../../services/userService'
import {
  addPrograma, updatePrograma, deletePrograma,
  addVisitaPuntual, updateVisitaPuntual, deleteVisitaPuntual,
} from '../../services/visitasService'
import { ProgramaVisita, VisitaPuntual, UserProfile, DIAS_SEMANA } from '../../types'
import { Timestamp } from 'firebase/firestore'

// ── Week helpers ──────────────────────────────────────────────────────────────

function thisWeekRange(): [Date, Date] {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return [monday, sunday]
}

function tsToDate(ts: Timestamp | null | undefined): Date {
  if (!ts) return new Date(0)
  return (ts as Timestamp).toDate ? (ts as Timestamp).toDate() : new Date(((ts as any).seconds) * 1000)
}

const FRECUENCIA_LABELS: Record<string, string> = {
  semanal:   'Semanal',
  quincenal: 'Quincenal',
  mensual:   'Mensual',
}

// ── helpers ───────────────────────────────────────────────────────────────────

const DOW_LABELS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

function clientLabel(c: UserProfile) {
  return c.razonSocial || c.nombreContacto || c.nombre || c.email
}

function choferLabel(c: UserProfile) {
  return c.nombreContacto || c.nombre || c.email
}

// ── Formulario de programa recurrente ─────────────────────────────────────────

function ProgramaForm({
  initial,
  choferes,
  clientes,
  onSave,
  onCancel,
}: {
  initial?:  Partial<ProgramaVisita>
  choferes:  UserProfile[]
  clientes:  UserProfile[]
  onSave:    (data: Omit<ProgramaVisita, 'id' | 'createdAt'>) => Promise<void>
  onCancel:  () => void
}) {
  const [clientId,   setClientId]   = useState(initial?.clientId   ?? '')
  const [driverId,   setDriverId]   = useState(initial?.driverId   ?? '')
  const [dias,       setDias]       = useState<number[]>(initial?.diasSemana ?? [])
  const [notas,      setNotas]      = useState(initial?.notas       ?? '')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const toggleDia = (d: number) =>
    setDias((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort())

  const handleSave = async () => {
    const cliente = clientes.find((c) => c.uid === clientId)
    if (!cliente)       { setError('Seleccioná un cliente'); return }
    if (dias.length === 0) { setError('Seleccioná al menos un día'); return }
    setSaving(true)
    await onSave({
      clientId,
      clientName:    clientLabel(cliente),
      clientAddress: cliente.address || '',
      clientPhone:   cliente.telefono || cliente.phone || '',
      diasSemana:    dias,
      driverId:      driverId || null,
      activo:        true,
      notas,
    })
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted mb-1 block">Cliente *</label>
        <select
          value={clientId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setClientId(e.target.value)}
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">— Seleccioná un cliente —</option>
          {clientes.map((c) => (
            <option key={c.uid} value={c.uid}>{clientLabel(c)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs text-muted mb-2 block">Días de visita *</label>
        <div className="flex gap-2 flex-wrap">
          {DOW_LABELS.map((label, i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggleDia(i)}
              className={`w-10 h-10 rounded-full text-sm font-bold border transition-colors ${
                dias.includes(i)
                  ? 'bg-accent text-bg border-accent'
                  : 'bg-bg border-border text-muted hover:border-accent hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-muted mb-1 block">Chofer asignado</label>
        <select
          value={driverId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setDriverId(e.target.value)}
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">— Sin asignar —</option>
          {choferes.map((c) => (
            <option key={c.uid} value={c.email}>{choferLabel(c)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs text-muted mb-1 block">Notas internas</label>
        <textarea
          value={notas}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotas(e.target.value)}
          rows={2}
          placeholder="Horario preferido, instrucciones..."
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 text-sm">Cancelar</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1 text-sm">Guardar</Button>
      </div>
    </div>
  )
}

// ── Formulario de visita puntual ──────────────────────────────────────────────

function VisitaPuntualForm({
  clientes,
  choferes,
  defaultDate,
  onSave,
  onCancel,
}: {
  clientes:    UserProfile[]
  choferes:    UserProfile[]
  defaultDate: string
  onSave:      (data: Omit<VisitaPuntual, 'id' | 'createdAt'>) => Promise<void>
  onCancel:    () => void
}) {
  const [clientId, setClientId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [fecha,    setFecha]    = useState(defaultDate)
  const [notas,    setNotas]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const handleSave = async () => {
    const cliente = clientes.find((c) => c.uid === clientId)
    if (!cliente) { setError('Seleccioná un cliente'); return }
    if (!fecha)   { setError('Seleccioná una fecha'); return }
    setSaving(true)
    await onSave({
      clientId,
      clientName:    clientLabel(cliente),
      clientAddress: cliente.address || '',
      clientPhone:   cliente.telefono || cliente.phone || '',
      fecha:         Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      driverId:      driverId || null,
      status:        'pendiente',
      notas,
    })
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted mb-1 block">Cliente *</label>
        <select
          value={clientId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setClientId(e.target.value)}
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">— Seleccioná un cliente —</option>
          {clientes.map((c) => (
            <option key={c.uid} value={c.uid}>{clientLabel(c)}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted mb-1 block">Fecha *</label>
          <input
            type="date"
            value={fecha}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFecha(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-muted mb-1 block">Chofer</label>
          <select
            value={driverId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setDriverId(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">— Sin asignar —</option>
            {choferes.map((c) => (
              <option key={c.uid} value={c.email}>{choferLabel(c)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-muted mb-1 block">Notas</label>
        <textarea
          value={notas}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotas(e.target.value)}
          rows={2}
          placeholder="Instrucciones especiales..."
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 text-sm">Cancelar</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1 text-sm">Guardar</Button>
      </div>
    </div>
  )
}

// ── Tarjeta de visita en la agenda ─────────────────────────────────────────────

function VisitaCard({
  clientName, clientAddress, clientPhone, driverId,
  notas, status, isRecurrente, choferes, onDelete, onSinContacto,
}: {
  clientName:    string
  clientAddress: string
  clientPhone:   string
  driverId:      string | null
  notas?:        string
  status?:       string       // solo en puntuales
  isRecurrente:  boolean
  choferes:      UserProfile[]
  onDelete?:     () => void
  onSinContacto?: () => void
}) {
  const chofer = choferes.find((c) => c.email === driverId)
  const isVisitado = status === 'visitado'
  const isSinContacto = status === 'sin_contacto'

  return (
    <div className={`bg-surface border rounded-xl p-4 space-y-2 ${
      isVisitado ? 'border-success/30 opacity-70' :
      isSinContacto ? 'border-orange-500/30 opacity-70' :
      'border-border'
    }`}>
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{clientName}</p>
            {isRecurrente && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20">
                recurrente
              </span>
            )}
            {isVisitado && <span className="text-xs text-success font-medium">✓ Visitado</span>}
            {isSinContacto && <span className="text-xs text-orange-400 font-medium">Sin contacto</span>}
          </div>
          <p className="text-muted text-xs mt-0.5 truncate">{clientAddress}</p>
          {clientPhone && <p className="text-xs text-accent mt-0.5">{clientPhone}</p>}
          {notas && <p className="text-xs text-muted/70 italic mt-1">"{notas}"</p>}
          {chofer && (
            <p className="text-xs text-muted mt-1">
              Chofer: <span className="text-white">{choferLabel(chofer)}</span>
            </p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {onSinContacto && !isVisitado && !isSinContacto && (
            <button
              onClick={onSinContacto}
              className="text-xs text-muted hover:text-orange-400 border border-border hover:border-orange-400/50 rounded-lg px-2 py-1 transition-colors"
            >
              Sin contacto
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-xs text-muted hover:text-red-400 border border-border hover:border-red-400/50 rounded-lg px-2 py-1 transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────

export default function VisitasPage() {
  const today = new Date().toISOString().split('T')[0]

  const { programas, loading: loadP } = useProgramasVisita()
  const { visitas,   loading: loadV } = useVisitasPuntuales()
  const { choferes }                  = useChoferes()

  const [tab,            setTab]            = useState<'agenda' | 'programas' | 'seguimiento'>('agenda')
  const [agendaDate,     setAgendaDate]     = useState(today)
  const [addProgramaModal, setAddProgramaModal] = useState(false)
  const [editPrograma,   setEditPrograma]   = useState<ProgramaVisita | null>(null)
  const [addVisitaModal, setAddVisitaModal] = useState(false)
  const [clientes,       setClientes]       = useState<UserProfile[]>([])
  const [loadingClients, setLoadingClients] = useState(false)

  const loadClients = async () => {
    if (clientes.length > 0) return
    setLoadingClients(true)
    try {
      const all = await getAllUsers()
      setClientes(all.filter((u) => u.rol === 'cliente' && u.estado === 'activo'))
    } finally {
      setLoadingClients(false)
    }
  }

  const openAddPrograma = () => { loadClients(); setAddProgramaModal(true) }
  const openAddVisita   = () => { loadClients(); setAddVisitaModal(true) }
  const openEditPrograma = (p: ProgramaVisita) => { loadClients(); setEditPrograma(p) }

  useEffect(() => {
    if (tab === 'seguimiento') loadClients()
  }, [tab])

  // Agenda del día seleccionado
  const fechaAgenda     = new Date(agendaDate + 'T12:00:00')
  const programasHoy    = programasParaFecha(programas, fechaAgenda)
  const visitasPuntuales = visitasParaFecha(visitas, fechaAgenda)

  // Alerta: visitas puntuales pendientes de hoy
  const sinVisitar = visitasParaFecha(visitas, new Date()).filter(
    (v) => v.status === 'pendiente',
  ).length

  if (loadP || loadV) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">

        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Visitas</h1>
            <p className="text-muted text-sm">Recorridos programados y visitas puntuales</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-1">
          {(['agenda', 'programas', 'seguimiento'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-white'
              }`}
            >
              {t === 'agenda' ? (
                <>Agenda {sinVisitar > 0 && tab !== 'agenda' && (
                  <span className="ml-1.5 bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5">{sinVisitar}</span>
                )}</>
              ) : t === 'programas' ? 'Programas recurrentes' : 'Seguimiento'}
            </button>
          ))}
        </div>

        {/* ── TAB AGENDA ─────────────────────────────────────────────────────── */}
        {tab === 'agenda' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <input
                type="date"
                value={agendaDate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setAgendaDate(e.target.value)}
                className="bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <Button onClick={openAddVisita} className="text-sm">+ Visita puntual</Button>
            </div>

            {programasHoy.length === 0 && visitasPuntuales.length === 0 ? (
              <div className="bg-surface border border-border rounded-xl p-8 text-center">
                <p className="text-muted text-sm">No hay visitas programadas para este día</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Recurrentes */}
                {programasHoy.map((p) => (
                  <VisitaCard
                    key={`prog-${p.id}`}
                    clientName={p.clientName}
                    clientAddress={p.clientAddress}
                    clientPhone={p.clientPhone}
                    driverId={p.driverId}
                    notas={p.notas}
                    isRecurrente
                    choferes={choferes}
                  />
                ))}

                {/* Puntuales */}
                {visitasPuntuales.map((v) => (
                  <VisitaCard
                    key={`punt-${v.id}`}
                    clientName={v.clientName}
                    clientAddress={v.clientAddress}
                    clientPhone={v.clientPhone}
                    driverId={v.driverId}
                    notas={v.notas}
                    status={v.status}
                    isRecurrente={false}
                    choferes={choferes}
                    onDelete={() => deleteVisitaPuntual(v.id)}
                    onSinContacto={() => updateVisitaPuntual(v.id, { status: 'sin_contacto' })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB PROGRAMAS ──────────────────────────────────────────────────── */}
        {tab === 'programas' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={openAddPrograma} className="text-sm">+ Nuevo programa</Button>
            </div>

            {programas.length === 0 ? (
              <div className="bg-surface border border-border rounded-xl p-8 text-center">
                <p className="text-4xl mb-3">📅</p>
                <p className="text-muted text-sm">Todavía no configuraste programas de visita</p>
                <p className="text-muted/60 text-xs mt-1">
                  Agregá un programa para que las visitas aparezcan automáticamente cada semana
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {programas.map((p) => {
                  const chofer = choferes.find((c) => c.email === p.driverId)
                  return (
                    <div
                      key={p.id}
                      className={`bg-surface border rounded-xl p-4 flex flex-wrap items-start justify-between gap-3 ${
                        p.activo ? 'border-border' : 'border-border/40 opacity-60'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{p.clientName}</p>
                          {!p.activo && <span className="text-xs text-muted">(inactivo)</span>}
                        </div>
                        <p className="text-muted text-xs truncate mt-0.5">{p.clientAddress}</p>

                        {/* Días */}
                        <div className="flex gap-1 mt-2">
                          {DOW_LABELS.map((label, i) => (
                            <span
                              key={i}
                              className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${
                                p.diasSemana.includes(i)
                                  ? 'bg-accent text-bg'
                                  : 'bg-bg text-muted/30'
                              }`}
                            >
                              {label}
                            </span>
                          ))}
                        </div>

                        {chofer && (
                          <p className="text-xs text-muted mt-1.5">
                            Chofer: <span className="text-white">{choferLabel(chofer)}</span>
                          </p>
                        )}
                        {p.notas && (
                          <p className="text-xs text-muted/70 italic mt-1">"{p.notas}"</p>
                        )}
                      </div>

                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => openEditPrograma(p)}
                          className="text-xs text-muted hover:text-white border border-border hover:border-accent rounded-lg px-3 py-1.5 transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => updatePrograma(p.id, { activo: !p.activo })}
                          className="text-xs text-muted hover:text-white border border-border hover:border-accent rounded-lg px-3 py-1.5 transition-colors"
                        >
                          {p.activo ? 'Pausar' : 'Activar'}
                        </button>
                        <button
                          onClick={() => deletePrograma(p.id)}
                          className="text-xs text-muted hover:text-red-400 border border-border hover:border-red-400/50 rounded-lg px-3 py-1.5 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {/* ── TAB SEGUIMIENTO ────────────────────────────────────────────────── */}
        {tab === 'seguimiento' && (
          <div className="space-y-4">
            {loadingClients ? (
              <LoadingSpinner />
            ) : (() => {
              const visitaClientes = clientes.filter((c) => c.esVisita)
              const [weekStart, weekEnd] = thisWeekRange()

              const isScheduledThisWeek = (clientId: string): boolean => {
                if (programas.some((p) => p.clientId === clientId && p.activo)) return true
                return visitas.some((v) => {
                  if (v.clientId !== clientId) return false
                  const d = tsToDate(v.fecha)
                  return d >= weekStart && d <= weekEnd
                })
              }

              if (visitaClientes.length === 0) {
                return (
                  <div className="bg-surface border border-border rounded-xl p-10 text-center">
                    <p className="text-3xl mb-3">🗺</p>
                    <p className="text-muted text-sm">No hay clientes marcados como visita</p>
                    <p className="text-muted/60 text-xs mt-1">
                      Marcá un cliente como visita desde Usuarios → Ficha del cliente
                    </p>
                  </div>
                )
              }

              const sinProgramar = visitaClientes.filter((c) => !isScheduledThisWeek(c.uid))
              return (
                <>
                  {sinProgramar.length > 0 && (
                    <div className="bg-yellow-500/5 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
                      <span className="text-yellow-400 text-lg shrink-0">⚠</span>
                      <div>
                        <p className="text-sm font-medium text-yellow-400">
                          {sinProgramar.length} cliente{sinProgramar.length !== 1 ? 's' : ''} sin visita esta semana
                        </p>
                        <p className="text-xs text-muted mt-0.5">
                          Revisá si faltan en la planificación o creá una visita puntual
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    {visitaClientes
                      .sort((a, b) => {
                        const aOk = isScheduledThisWeek(a.uid)
                        const bOk = isScheduledThisWeek(b.uid)
                        if (aOk !== bOk) return aOk ? 1 : -1
                        return clientLabel(a).localeCompare(clientLabel(b))
                      })
                      .map((c) => {
                        const scheduled = isScheduledThisWeek(c.uid)
                        const prog = programas.find((p) => p.clientId === c.uid && p.activo)
                        const primaryAddr = c.addresses?.find((a) => a.esPrincipal) ?? c.addresses?.[0]

                        return (
                          <div
                            key={c.uid}
                            className={`bg-surface border rounded-xl p-4 space-y-2 ${
                              scheduled ? 'border-border' : 'border-yellow-500/30'
                            }`}
                          >
                            <div className="flex justify-between items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-semibold text-sm">{clientLabel(c)}</p>
                                  {c.frecuenciaVisita && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20">
                                      {FRECUENCIA_LABELS[c.frecuenciaVisita]}
                                    </span>
                                  )}
                                </div>
                                {primaryAddr?.address && (
                                  <p className="text-xs text-muted mt-0.5 truncate">{primaryAddr.address}</p>
                                )}
                                {prog ? (
                                  <div className="flex gap-1 mt-2">
                                    {DOW_LABELS.map((label, i) => (
                                      <span
                                        key={i}
                                        className={`w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold ${
                                          prog.diasSemana.includes(i) ? 'bg-accent text-bg' : 'bg-bg text-muted/30'
                                        }`}
                                      >
                                        {label}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted mt-1">Sin programa recurrente</p>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                {scheduled ? (
                                  <p className="text-xs text-success font-medium">✓ Esta semana</p>
                                ) : (
                                  <>
                                    <p className="text-xs text-yellow-400 font-medium">⚠ Sin programar</p>
                                    <button
                                      onClick={() => { openAddVisita(); }}
                                      className="mt-1 text-xs text-accent hover:text-white border border-accent/30 hover:border-accent rounded-lg px-2 py-1 transition-colors"
                                    >
                                      + Visita
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </>
              )
            })()}
          </div>
        )}
      </main>

      {/* Modales */}
      <Modal open={addProgramaModal} onClose={() => setAddProgramaModal(false)} title="Nuevo programa de visita">
        {loadingClients ? <LoadingSpinner /> : (
          <ProgramaForm
            choferes={choferes}
            clientes={clientes}
            onSave={async (data) => { await addPrograma(data); setAddProgramaModal(false) }}
            onCancel={() => setAddProgramaModal(false)}
          />
        )}
      </Modal>

      {editPrograma && (
        <Modal open onClose={() => setEditPrograma(null)} title="Editar programa">
          {loadingClients ? <LoadingSpinner /> : (
            <ProgramaForm
              initial={editPrograma}
              choferes={choferes}
              clientes={clientes}
              onSave={async (data) => { await updatePrograma(editPrograma.id, data); setEditPrograma(null) }}
              onCancel={() => setEditPrograma(null)}
            />
          )}
        </Modal>
      )}

      <Modal open={addVisitaModal} onClose={() => setAddVisitaModal(false)} title="Agregar visita puntual">
        {loadingClients ? <LoadingSpinner /> : (
          <VisitaPuntualForm
            clientes={clientes}
            choferes={choferes}
            defaultDate={agendaDate}
            onSave={async (data) => { await addVisitaPuntual(data); setAddVisitaModal(false) }}
            onCancel={() => setAddVisitaModal(false)}
          />
        )}
      </Modal>
    </>
  )
}
