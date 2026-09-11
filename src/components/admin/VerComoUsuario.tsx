import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Eye, Search } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { getAllUsers } from '@/services/userService'
import { abrirVistaComo } from '@/services/impersonacionService'
import { coincideBusqueda } from '@/utils/busqueda'
import { ROLE_LABELS } from '@/utils/roles'
import type { UserProfile } from '@/types'

// Lanzador de "Ver como usuario" en el panel de control (2026-09-10): un
// buscador de personas (staff, choferes y clientes) y un botón por resultado
// que abre la app en otra pestaña con la sesión de esa persona, en solo
// lectura (ver services/impersonacionService.ts). La misma acción está en
// cada fila de Usuarios; acá está a mano sin entrar a la lista.

const MAX_RESULTADOS = 8

export default function VerComoUsuario() {
  const { user: yo } = useAuth()
  const [q, setQ] = useState('')
  const [usuarios, setUsuarios] = useState<UserProfile[] | null>(null)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ uid: string; texto: string; link?: string } | null>(null)

  // Se cargan recién cuando se empieza a escribir (misma caché de 5 min que Usuarios).
  useEffect(() => {
    if (q.trim().length < 2 || usuarios) return
    let activo = true
    getAllUsers().then((xs) => { if (activo) setUsuarios(xs) }).catch(() => { if (activo) setUsuarios([]) })
    return () => { activo = false }
  }, [q, usuarios])

  const resultados = useMemo(() => {
    const t = q.trim()
    if (t.length < 2 || !usuarios) return []
    return usuarios
      .filter((u) => u.uid !== yo?.uid && u.rol !== 'super_admin')
      .filter((u) => coincideBusqueda(t, u.nombre, u.razonSocial, u.email, u.dni, u.cuit, u.codigoCliente))
      .slice(0, MAX_RESULTADOS)
  }, [q, usuarios, yo?.uid])

  const verComo = async (u: UserProfile) => {
    setAbriendo(u.uid)
    setAviso(null)
    try {
      const r = await abrirVistaComo(u.uid)
      if (!r.abierta) setAviso({ uid: u.uid, texto: 'El navegador bloqueó la pestaña nueva.', link: r.url })
    } catch (err) {
      setAviso({ uid: u.uid, texto: (err as { message?: string })?.message ?? 'No se pudo abrir la vista' })
    } finally {
      setAbriendo(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Abre la app en otra pestaña con la sesión de esa persona, en <b>solo lectura</b>, para ver exactamente lo que ve.
        Cada entrada queda registrada en la auditoría.
      </p>
      <label className="relative block">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          placeholder="Buscar por nombre, DNI, CUIT, razón social o código..."
          className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
      {q.trim().length >= 2 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-[#D3D1C7] bg-white">
          {usuarios === null && <li className="px-3 py-2 text-sm text-gray-400">Cargando usuarios…</li>}
          {usuarios !== null && resultados.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">Sin resultados.</li>}
          {resultados.map((u) => (
            <li key={u.uid} className="px-3 py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{u.razonSocial || u.nombre || u.email}</p>
                <p className="text-xs text-gray-500 truncate">
                  {ROLE_LABELS[u.rol] ?? u.rol}
                  {u.dni ? ` · DNI ${u.dni}` : u.cuit ? ` · CUIT ${u.cuit}` : ''}
                  {u.estado !== 'activo' ? ` · ${u.estado}` : ''}
                </p>
                {aviso?.uid === u.uid && (
                  <p className="text-xs text-amber-700 mt-0.5">
                    {aviso.texto}{' '}
                    {aviso.link && <a href={aviso.link} target="_blank" rel="noreferrer" className="underline text-accent">Abrir igual</a>}
                  </p>
                )}
              </div>
              <button
                onClick={() => verComo(u)}
                disabled={abriendo !== null}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 text-xs font-medium px-2.5 py-1.5 hover:bg-violet-100 disabled:opacity-50 transition-colors"
              >
                <Eye size={13} /> {abriendo === u.uid ? 'Abriendo…' : 'Ver como'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
