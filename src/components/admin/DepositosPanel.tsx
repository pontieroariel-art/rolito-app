import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import Button from '../ui/Button'
import { useDepositosReparto } from '@/hooks/useDepositosReparto'
import { actualizarDepositoTango, sincronizarDepositosTangoAhora } from '@/services/depositosService'
import { getStaffUsers } from '@/services/userService'
import { reportError } from '@/services/observability'
import type { DepositoTango, TipoDeposito, UserProfile } from '@/types'

const TIPOS: { id: TipoDeposito; label: string }[] = [
  { id: 'repartidor', label: 'Repartidor' },
  { id: 'planta',     label: 'Planta' },
  { id: 'interno',    label: 'Interno' },
]

// Depósitos de Tango (expedición por depósito, 2026-09-06): cada repartidor
// —propio, tercerizado o supervisor— es un depósito en tránsito. Acá se define
// qué es cada código (repartidor / planta / interno), si está activo para los
// combos de carga, descarga y liquidación, y qué usuario de la app tiene
// vinculado (chofer o supervisor). El nombre y la habilitación vienen de
// Tango y se refrescan con la sync.
export default function DepositosPanel() {
  const qc = useQueryClient()
  const { depositos, loading } = useDepositosReparto()
  const { data: staff = [] } = useQuery({ queryKey: ['users', 'staff'], queryFn: getStaffUsers, staleTime: 300_000 })
  const [sincronizando, setSincronizando] = useState(false)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'repartidor' | 'sinUsuario'>('todos')

  const candidatos = useMemo(
    () => staff
      .filter((u) => (u.rol === 'chofer' || u.rol === 'supervisor') && u.estado === 'activo' && u.subrol !== 'ayudante')
      .sort((a, b) => (a.nombre || a.nombreContacto || '').localeCompare(b.nombre || b.nombreContacto || '', 'es')),
    [staff],
  )
  const nombreDe = (u: UserProfile) => u.nombre || u.nombreContacto || u.email

  const visibles = useMemo(() => depositos.filter((d) =>
    filtro === 'todos' ? true : filtro === 'repartidor' ? d.tipo === 'repartidor' : d.tipo === 'repartidor' && !d.uid,
  ), [depositos, filtro])

  const guardar = async (d: DepositoTango, cambios: Parameters<typeof actualizarDepositoTango>[1]) => {
    setGuardando(d.codigo)
    setError('')
    try {
      await actualizarDepositoTango(d.codigo, cambios)
    } catch (err) {
      reportError(err, { origen: 'DepositosPanel', codigo: d.codigo })
      setError(`No se pudo guardar el depósito ${d.codigo}.`)
    } finally {
      setGuardando(null)
    }
  }

  const sincronizar = async () => {
    setSincronizando(true)
    setError('')
    try {
      await sincronizarDepositosTangoAhora()
      await qc.invalidateQueries({ queryKey: ['tango-sync-estado'] })
    } catch (err) {
      reportError(err, { origen: 'DepositosPanel', accion: 'sincronizar' })
      setError(err instanceof Error ? err.message : 'No se pudo sincronizar con Tango')
    } finally {
      setSincronizando(false)
    }
  }

  const selectClass = 'bg-white border border-[#D3D1C7] rounded-lg px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const repartidores = depositos.filter((d) => d.tipo === 'repartidor')
  const vinculados = repartidores.filter((d) => d.uid).length

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl">
      <div className="p-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Depósitos de reparto (Tango)</p>
          <p className="text-xs text-gray-500">
            Cada repartidor es un depósito en tránsito de Tango. Carga, descarga y liquidación se hacen por depósito;
            el usuario vinculado es quien vende y cobra con ese depósito.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {depositos.length} depósitos · {repartidores.length} de reparto · {vinculados} con usuario vinculado
          </p>
        </div>
        <Button onClick={sincronizar} disabled={sincronizando} variant="outline" className="shrink-0">
          <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} />
          {sincronizando ? 'Sincronizando…' : 'Sincronizar con Tango'}
        </Button>
      </div>

      <div className="px-4 pb-3 flex gap-2">
        {([['todos', 'Todos'], ['repartidor', 'Solo reparto'], ['sinUsuario', 'Reparto sin usuario']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFiltro(id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filtro === id ? 'bg-accent text-white border-accent' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="px-4 pb-2 text-xs text-red-500">{error}</p>}

      <div className="overflow-x-auto border-t border-gray-100">
        {loading ? (
          <p className="p-4 text-sm text-gray-500">Cargando depósitos…</p>
        ) : depositos.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Todavía no hay depósitos. Sincronizá con Tango para traerlos.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                <th className="text-left px-4 py-2 font-semibold">Código</th>
                <th className="text-left px-2 py-2 font-semibold">Nombre en Tango</th>
                <th className="text-left px-2 py-2 font-semibold">Tipo</th>
                <th className="text-left px-2 py-2 font-semibold">Usuario de la app</th>
                <th className="text-left px-2 py-2 font-semibold">Activo</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((d) => (
                <tr key={d.codigo} className={`border-t border-gray-100 ${guardando === d.codigo ? 'opacity-60' : ''} ${d.inhabilitado ? 'text-gray-400' : ''}`}>
                  <td className="px-4 py-1.5 font-mono font-semibold">{d.codigo}</td>
                  <td className="px-2 py-1.5">
                    {d.nombre}
                    {d.inhabilitado && <span className="ml-2 text-[10px] uppercase text-red-500 font-semibold">inhabilitado en Tango</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={d.tipo} onChange={(e) => guardar(d, { tipo: e.target.value as TipoDeposito })} className={selectClass}>
                      {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    {d.tipo === 'repartidor' ? (
                      <select
                        value={d.uid ?? ''}
                        onChange={(e) => {
                          const u = candidatos.find((c) => c.uid === e.target.value)
                          guardar(d, { usuario: u ? { uid: u.uid, nombre: nombreDe(u), rol: u.rol } : null })
                        }}
                        className={selectClass}
                      >
                        <option value="">— sin usuario —</option>
                        {candidatos.map((u) => (
                          <option key={u.uid} value={u.uid}>{nombreDe(u)} ({u.rol})</option>
                        ))}
                      </select>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={d.activo} onChange={(e) => guardar(d, { activo: e.target.checked })} className="accent-[#1D9E75]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
