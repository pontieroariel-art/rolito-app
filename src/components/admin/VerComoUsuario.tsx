import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Eye, Search } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { getStaffUsers } from '@/services/userService'
import { useClientesIndexTodos } from '@/hooks/useClientesIndex'
import { abrirVistaComo } from '@/services/impersonacionService'
import { reportError } from '@/services/observability'
import { coincideBusqueda } from '@/utils/busqueda'
import { ROLE_LABELS } from '@/utils/roles'
import type { UserRole } from '@/types'

// Lanzador de "Ver como usuario" en el panel de control (2026-09-10): un
// buscador de personas (staff, choferes y clientes) y un botón por resultado
// que abre la app en otra pestaña con la sesión de esa persona, en solo
// lectura (ver services/impersonacionService.ts). La misma acción está en
// cada fila de Usuarios; acá está a mano sin entrar a la lista.
//
// Datos (2026-09-22): el staff sale de una consulta por rol (unas decenas de
// fichas) y los clientes del índice liviano, que trae lo que la lista muestra
// (razón social, CUIT, código, estado); antes bajaba las 2.000+ fichas con
// precios de getAllUsers.

const MAX_RESULTADOS = 8

interface Persona {
  uid:            string
  nombre:         string
  rol:            UserRole
  estado:         string
  dni?:           string
  cuit?:          string
  razonSocial?:   string
  email?:         string
  codigoCliente?: string
}

export default function VerComoUsuario() {
  const { user: yo } = useAuth()
  const [q, setQ] = useState('')
  const [staff, setStaff] = useState<Persona[] | null>(null)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ uid: string; texto: string; link?: string } | null>(null)

  // Se cargan recién cuando se empieza a escribir.
  const buscando = q.trim().length >= 2
  const { clientes, loading: cargandoClientes } = useClientesIndexTodos({ enabled: buscando })
  useEffect(() => {
    if (!buscando || staff) return
    let activo = true
    getStaffUsers()
      .then((xs) => {
        if (!activo) return
        setStaff(xs.map((u) => ({ uid: u.uid, nombre: u.nombre, rol: u.rol, estado: u.estado, dni: u.dni, cuit: u.cuit, razonSocial: u.razonSocial, email: u.email })))
      })
      .catch((err) => { reportError(err, { origen: 'VerComoUsuario', accion: 'cargar staff' }); if (activo) setStaff([]) })
    return () => { activo = false }
  }, [buscando, staff])

  const personas = useMemo<Persona[] | null>(() => {
    if (!staff || cargandoClientes) return null
    return [
      ...staff,
      ...clientes.map((c): Persona => ({ uid: c.uid, nombre: c.razonSocial, rol: 'cliente', estado: c.estado, cuit: c.cuit, razonSocial: c.razonSocial, email: c.email, codigoCliente: c.codigoCliente })),
    ]
  }, [staff, clientes, cargandoClientes])

  const resultados = useMemo(() => {
    const t = q.trim()
    if (t.length < 2 || !personas) return []
    return personas
      .filter((u) => u.uid !== yo?.uid && u.rol !== 'super_admin')
      .filter((u) => coincideBusqueda(t, u.nombre, u.razonSocial, u.email, u.dni, u.cuit, u.codigoCliente))
      .slice(0, MAX_RESULTADOS)
  }, [q, personas, yo?.uid])

  const verComo = async (u: Persona) => {
    setAbriendo(u.uid)
    setAviso(null)
    try {
      const r = await abrirVistaComo(u.uid)
      if (!r.abierta) setAviso({ uid: u.uid, texto: 'El navegador bloqueó la pestaña nueva.', link: r.url })
    } catch (err) {
      reportError(err, { origen: 'VerComoUsuario', accion: 'abrir Ver como', uid: u.uid })
      setAviso({ uid: u.uid, texto: (err as { message?: string })?.message ?? 'No se pudo abrir la vista' })
    } finally {
      setAbriendo(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-secundario">
        Abre la app en otra pestaña con la sesión de esa persona, en <b>solo lectura</b>, para ver exactamente lo que ve.
        Cada entrada queda registrada en la auditoría.
      </p>
      <label className="relative block">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-inerte" />
        <input
          value={q}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          placeholder="Buscar por nombre, DNI, CUIT, razón social o código..."
          className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
      {buscando && (
        <ul className="divide-y divide-[#E7E5DC] rounded-xl border border-[#D3D1C7] bg-white">
          {personas === null && <li className="px-3 py-2 text-sm text-secundario">Cargando usuarios…</li>}
          {personas !== null && resultados.length === 0 && <li className="px-3 py-2 text-sm text-secundario">Sin resultados.</li>}
          {resultados.map((u) => (
            <li key={u.uid} className="px-3 py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{u.razonSocial || u.nombre || u.email}</p>
                <p className="text-xs text-secundario truncate">
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
