import { useMemo, useState } from 'react'
import { deleteField } from 'firebase/firestore'
import { Check, ChevronDown, ChevronRight, Info, Minus, Monitor } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { updateUserDocument } from '../../../services/userService'
import { Sistema, UserProfile } from '../../../types'
import { ROLE_HOME, SISTEMA_LABELS, techoSistemasDe } from '../../../utils/sistemas'
import { ROLE_LABELS, tieneRol } from '../../../utils/roles'
import { gruposVisibles, rutaDe, type GrupoMenu, type ItemMenu } from '@/rutas/catalogo'

/**
 * RECORTE DEL MENÚ POR USUARIO (2026-09-12, rediseño).
 *
 * Ordena lo que la persona VE; no da ni quita acceso: eso lo decide su rol en
 * <ProtectedRoute> y en las reglas de Firestore. El modal lo dice en la cara,
 * porque antes se llamaba "Permisos" y se prestaba a creer lo contrario.
 *
 * Se guarda lo que se ESCONDE (`dominiosOcultos`, `pestanasOcultas`). Antes se
 * guardaba lo que se mostraba, y entonces una pantalla nueva de la app no le
 * aparecía nunca a quien tuviera un recorte, hasta que alguien volviera a
 * abrir esto y guardar. Los recortes viejos se leen igual y se convierten al
 * abrir, así el primer guardado los pone al día.
 *
 * Ojo: el recorte viaja con la PERSONA. Para fijar una tablet de mostrador,
 * sin importar quién se loguee, está la marca del aparato (Cobranzas →
 * "Fijar esta tablet", services/expedicionDeviceService).
 */

type Estado = 'todo' | 'parcial' | 'nada'

// Atajos de un clic. Se ofrecen solo si la persona tiene ese rol y la pantalla
// le aparece; el `path` es lo ÚNICO que queda visible.
const ATAJOS: { rol: Parameters<typeof tieneRol>[1]; label: string; path: string }[] = [
  { rol: 'caja',      label: 'Solo ventanilla',       path: '/caja/ventanilla' },
  { rol: 'caja',      label: 'Solo cobranzas',        path: '/caja/cobranzas' },
  { rol: 'caja',      label: 'Solo remitos de carga', path: '/caja/remitos' },
  { rol: 'muelle',    label: 'Solo muelle',           path: '/muelle' },
  { rol: 'seguridad', label: 'Solo seguridad',        path: '/seguridad' },
]

export function PermisosUsuarioModal({
  user, onClose, onSaved,
}: {
  user:    UserProfile
  onClose: () => void
  onSaved: () => void
}) {
  const techo = useMemo(() => techoSistemasDe(user), [user])
  const grupos = useMemo(
    () => Object.fromEntries(techo.map((s) => [s, gruposVisibles(user, s)])) as Record<Sistema, GrupoMenu[]>,
    [user, techo],
  )
  const itemsDe = (s: Sistema): ItemMenu[] => (grupos[s] ?? []).flatMap((g) => g.items)
  const todasLasPantallas = useMemo(() => {
    const m = new Map<string, ItemMenu>()
    for (const s of techo) for (const i of itemsDe(s)) m.set(i.to, i)
    return [...m.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, techo])

  // Estado inicial: el recorte nuevo, o el viejo convertido a "lo escondido".
  const [dominiosOcultos, setDominiosOcultos] = useState<Set<Sistema>>(() => {
    if (user.dominiosOcultos) return new Set(user.dominiosOcultos)
    if (user.sistemasPermitidos) return new Set(techo.filter((s) => !user.sistemasPermitidos!.includes(s)))
    return new Set()
  })
  const [pestanasOcultas, setPestanasOcultas] = useState<Set<string>>(() => {
    if (user.pestanasOcultas) return new Set(user.pestanasOcultas)
    if (user.pestanasPermitidas) {
      const vistas = new Set<string>()
      for (const s of techo) for (const g of gruposVisibles(user, s)) for (const i of g.items) {
        if (!user.pestanasPermitidas.includes(i.to)) vistas.add(i.to)
      }
      return vistas
    }
    return new Set()
  })

  const [abiertos, setAbiertos] = useState<Set<Sistema>>(() => new Set(techo.slice(0, 1)))
  const [vistaPrevia, setVistaPrevia] = useState<Sistema | null>(null)
  const [guardando, setGuardando] = useState(false)

  const eraViejo = !!(user.sistemasPermitidos || user.pestanasPermitidas) && !user.dominiosOcultos && !user.pestanasOcultas

  // ── Estado de cada dominio ────────────────────────────────────────────────
  const estadoDe = (s: Sistema): Estado => {
    if (dominiosOcultos.has(s)) return 'nada'
    const items = itemsDe(s)
    const visibles = items.filter((i) => !pestanasOcultas.has(i.to)).length
    if (visibles === 0) return 'nada'
    return visibles === items.length ? 'todo' : 'parcial'
  }

  const alternarDominio = (s: Sistema) => {
    const apagado = estadoDe(s) === 'nada'
    setDominiosOcultos((prev) => { const n = new Set(prev); if (apagado) n.delete(s); else n.add(s); return n })
    // Prenderlo devuelve también sus pantallas: si no, quedaría prendido y vacío.
    if (apagado) setPestanasOcultas((prev) => { const n = new Set(prev); itemsDe(s).forEach((i) => n.delete(i.to)); return n })
  }

  const alternarPantalla = (to: string) =>
    setPestanasOcultas((prev) => { const n = new Set(prev); if (n.has(to)) n.delete(to); else n.add(to); return n })

  const aplicarAtajo = (path: string) => {
    const dominioDelAtajo = techo.find((s) => itemsDe(s).some((i) => i.to === path))
    setDominiosOcultos(new Set(techo.filter((s) => s !== dominioDelAtajo)))
    setPestanasOcultas(new Set(todasLasPantallas.filter((i) => i.to !== path).map((i) => i.to)))
    if (dominioDelAtajo) { setAbiertos(new Set([dominioDelAtajo])); setVistaPrevia(dominioDelAtajo) }
  }

  const verTodo = () => { setDominiosOcultos(new Set()); setPestanasOcultas(new Set()) }

  // ── Lo que va a ver ───────────────────────────────────────────────────────
  const dominiosVisibles = techo.filter((s) => estadoDe(s) !== 'nada')
  const pantallasVisibles = todasLasPantallas.filter((i) => !pestanasOcultas.has(i.to)
    && techo.some((s) => !dominiosOcultos.has(s) && itemsDe(s).some((x) => x.to === i.to)))
  const dominioPrevia = vistaPrevia && dominiosVisibles.includes(vistaPrevia) ? vistaPrevia : dominiosVisibles[0]

  const entrada = useMemo(() => {
    if (dominiosVisibles.length === 0) return 'ninguna pantalla: no le va a quedar menú'
    const home = ROLE_HOME[user.rol]
    if (home === '/sistema') return 'el selector de dominios'
    const enMenu = pantallasVisibles.find((i) => i.to === home)
    if (enMenu) return enMenu.label
    // Su home puede ser un redirect que no está en ningún menú (/caja manda a
    // la primera pantalla del puesto): aterriza en la primera que le quede.
    return pantallasVisibles[0]?.label ?? 'ninguna pantalla'
  }, [dominiosVisibles.length, pantallasVisibles, user.rol])

  const guardar = async () => {
    setGuardando(true)
    try {
      await updateUserDocument(user.uid, {
        dominiosOcultos: [...dominiosOcultos],
        pestanasOcultas: [...pestanasOcultas],
        // El modelo viejo se limpia al guardar.
        sistemasPermitidos: deleteField(),
        pestanasPermitidas: deleteField(),
      })
      onSaved()
    } finally { setGuardando(false) }
  }

  const quitarRecorte = async () => {
    setGuardando(true)
    try {
      await updateUserDocument(user.uid, {
        dominiosOcultos: deleteField(), pestanasOcultas: deleteField(),
        sistemasPermitidos: deleteField(), pestanasPermitidas: deleteField(),
      })
      onSaved()
    } finally { setGuardando(false) }
  }

  const atajos = ATAJOS.filter((a) => tieneRol(user, a.rol) && todasLasPantallas.some((i) => i.to === a.path))

  // Los roles de calle y de planta (chofer, técnico, supervisor, muelle,
  // seguridad, operario, cliente) no tienen menú de escritorio: su app son sus
  // propias pantallas. Recortar acá no les cambiaría nada, y un modal vacío
  // haría pensar lo contrario.
  if (techo.length === 0) {
    return (
      <Modal open onClose={onClose} title={`Qué ve ${user.nombreContacto || user.nombre} en el menú`}>
        <div className="space-y-4">
          <div className="flex gap-2.5 rounded-xl border border-[#D3D1C7] bg-[#F8F7F2] px-3.5 py-3">
            <Info size={16} className="text-accent shrink-0 mt-0.5" />
            <p className="text-xs text-gray-600">
              El rol <strong className="text-gray-900">{ROLE_LABELS[user.rol]}</strong> no usa el menú de escritorio: su app es la de su puesto,
              con sus propias pantallas. Acá no hay nada para recortar. Lo que puede abrir lo decide su rol.
            </p>
          </div>
          <Button onClick={onClose} className="w-full text-sm">Entendido</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title={`Qué ve ${user.nombreContacto || user.nombre} en el menú`} extraAncho>
      <div className="space-y-4">
        {/* Rol vs menú: la aclaración que evita malentendidos. */}
        <div className="flex gap-2.5 rounded-xl border border-[#D3D1C7] bg-[#F8F7F2] px-3.5 py-3">
          <Info size={16} className="text-accent shrink-0 mt-0.5" />
          <div className="text-xs text-gray-600 space-y-1">
            <p>
              Esto <strong className="text-gray-900">ordena el menú</strong> de {user.nombre?.split(' ')[0]}, no le da ni le quita acceso.
              Lo que puede abrir lo decide su rol, <strong className="text-gray-900">{ROLE_LABELS[user.rol]}</strong>: una pantalla escondida acá
              sigue abriéndose si alguien le pasa el link. Para cerrarle el acceso de verdad hay que cambiarle el rol.
            </p>
            <p>Apagar un dominio le saca esa pestaña de arriba. Apagar una pantalla la saca de la barra lateral.</p>
          </div>
        </div>

        {/* Atajos de un clic. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Atajos</span>
          <button type="button" onClick={verTodo}
            className="text-xs rounded-lg border border-[#D3D1C7] px-2.5 py-1.5 text-gray-700 hover:border-accent hover:text-accent transition-colors">
            Todo lo de su rol
          </button>
          {atajos.map((a) => (
            <button key={a.path} type="button" onClick={() => aplicarAtajo(a.path)}
              className="text-xs rounded-lg border border-[#D3D1C7] px-2.5 py-1.5 text-gray-700 hover:border-accent hover:text-accent transition-colors">
              {a.label}
            </button>
          ))}
        </div>

        {eraViejo && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Este recorte es del modelo viejo, que guardaba lo que se mostraba: hasta ahora, las pantallas nuevas de la app no le
            aparecían. Al guardar queda al día y las nuevas le van a aparecer solas.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          {/* ── Controles ── */}
          <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
            {techo.map((s) => {
              const items = itemsDe(s)
              const visibles = dominiosOcultos.has(s) ? 0 : items.filter((i) => !pestanasOcultas.has(i.to)).length
              const estado = estadoDe(s)
              const abierto = abiertos.has(s)
              return (
                // Mismo aspecto que el componente Plegable; acá el encabezado no
                // puede ser un botón solo, porque lleva el interruptor adentro.
                <section key={s} className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <Interruptor estado={estado} etiqueta={`Mostrar ${SISTEMA_LABELS[s]}`} onClick={() => alternarDominio(s)} />
                    <button type="button" onClick={() => setAbiertos((p) => { const n = new Set(p); if (n.has(s)) n.delete(s); else n.add(s); return n })}
                      className="flex-1 flex items-center justify-between gap-2 text-left">
                      <span className={`text-sm font-semibold ${estado === 'nada' ? 'text-gray-400' : 'text-gray-900'}`}>{SISTEMA_LABELS[s]}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`text-[11px] rounded-full px-2 py-0.5 border ${
                          estado === 'todo' ? 'bg-[#E8F5F0] text-[#0F6B4E] border-[#B3DDD3]'
                          : estado === 'parcial' ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-gray-100 text-gray-500 border-gray-200'
                        }`}>
                          {estado === 'nada' ? 'oculto' : `${visibles} de ${items.length}`}
                        </span>
                        {abierto ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                      </span>
                    </button>
                  </div>

                  {abierto && (
                    <div className={`px-3 pb-3 space-y-3 ${estado === 'nada' ? 'opacity-50' : ''}`}>
                      {(grupos[s] ?? []).map((g) => (
                        <div key={g.id}>
                          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">{g.label}</p>
                          <div className="grid sm:grid-cols-2 gap-1">
                            {g.items.map((item) => {
                              const oculta = dominiosOcultos.has(s) || pestanasOcultas.has(item.to)
                              return (
                                <button key={item.to} type="button" role="switch" aria-checked={!oculta}
                                  disabled={dominiosOcultos.has(s)}
                                  onClick={() => alternarPantalla(item.to)}
                                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                                    oculta ? 'text-gray-400' : 'text-gray-700 hover:bg-[#F8F7F2]'
                                  } disabled:cursor-not-allowed`}
                                >
                                  <Caja marcada={!oculta} />
                                  <item.icon size={14} className="shrink-0" />
                                  <span className="truncate">{item.label}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>

          {/* ── Vista previa ── */}
          <aside className="rounded-2xl border border-[#D3D1C7] bg-[#F8F7F2] p-3 lg:sticky lg:top-0">
            <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2 flex items-center gap-1.5">
              <Monitor size={13} /> Así lo va a ver
            </p>
            {dominiosVisibles.length === 0 ? (
              <p className="text-xs text-gray-500 py-6 text-center">Sin dominios: no le va a quedar menú.</p>
            ) : (
              <div className="rounded-xl border border-[#D3D1C7] bg-white overflow-hidden">
                <div className="flex flex-wrap gap-1 p-2 border-b border-[#D3D1C7] bg-[#F8F7F2]">
                  {dominiosVisibles.map((s) => (
                    <button key={s} type="button" onClick={() => setVistaPrevia(s)}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${s === dominioPrevia ? 'bg-white text-accent shadow-sm' : 'text-gray-500'}`}>
                      {SISTEMA_LABELS[s]}
                    </button>
                  ))}
                </div>
                <div className="p-2 space-y-2 max-h-[38vh] overflow-y-auto">
                  {dominioPrevia && (grupos[dominioPrevia] ?? [])
                    .map((g) => ({ ...g, items: g.items.filter((i) => !pestanasOcultas.has(i.to)) }))
                    .filter((g) => g.items.length > 0)
                    .map((g) => (
                      <div key={g.id}>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-1.5 mb-0.5">{g.label}</p>
                        {g.items.map((i) => (
                          <p key={i.to} className="flex items-center gap-2 px-1.5 py-1 text-xs text-gray-700">
                            <i.icon size={14} className="text-gray-400 shrink-0" /> <span className="truncate">{i.label}</span>
                          </p>
                        ))}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* ── Resumen y acciones ── */}
        <div className="border-t border-gray-100 pt-3 space-y-3">
          <p className="text-xs text-gray-600">
            <strong className="text-gray-900">{dominiosVisibles.length}</strong> {dominiosVisibles.length === 1 ? 'dominio' : 'dominios'}
            {' · '}<strong className="text-gray-900">{pantallasVisibles.length}</strong> {pantallasVisibles.length === 1 ? 'pantalla' : 'pantallas'}
            {' · entra en '}<strong className="text-gray-900">{entrada}</strong>
          </p>
          <p className="text-[11px] text-gray-400">
            ¿Querés fijar una tablet para cualquiera que se loguee ahí? Eso se marca en el aparato, desde Cobranzas.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={quitarRecorte} loading={guardando} className="flex-1 text-sm">
              Quitar el recorte
            </Button>
            <Button onClick={guardar} loading={guardando} className="flex-1 text-sm">
              Guardar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Interruptor de tres estados: todo, parcial o nada. */
function Interruptor({ estado, etiqueta, onClick }: { estado: Estado; etiqueta: string; onClick: () => void }) {
  const encendido = estado !== 'nada'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={estado === 'parcial' ? 'mixed' : encendido}
      aria-label={etiqueta}
      onClick={onClick}
      className={`relative w-10 h-6 rounded-full shrink-0 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40 ${
        estado === 'todo' ? 'bg-accent' : estado === 'parcial' ? 'bg-amber-400' : 'bg-gray-300'
      }`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow flex items-center justify-center transition-all ${
        encendido ? 'left-[1.125rem]' : 'left-0.5'
      }`}>
        {estado === 'todo' && <Check size={12} className="text-accent" />}
        {estado === 'parcial' && <Minus size={12} className="text-amber-500" />}
      </span>
    </button>
  )
}

/** Casilla de una pantalla (el botón que la contiene ya es el control). */
function Caja({ marcada }: { marcada: boolean }) {
  return (
    <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
      marcada ? 'bg-accent border-accent' : 'bg-white border-gray-300'
    }`}>
      {marcada && <Check size={11} className="text-white" />}
    </span>
  )
}
