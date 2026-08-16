import { useMemo, useState } from 'react'
import { Search, Star } from 'lucide-react'
import { TipoReparacion } from '../../types'

interface TipoReparacionChecklistProps {
  tipos:              TipoReparacion[]   // ya filtrados por sector por quien lo usa
  seleccionados:      string[]
  onToggle:           (id: string) => void
  showSearch?:        boolean
  favoritos?:         string[]
  onToggleFavorito?:  (id: string) => void
}

function Fila({
  tipo, marcado, onToggle, esFavorito, onToggleFavorito,
}: {
  tipo:             TipoReparacion
  marcado:          boolean
  onToggle:         () => void
  esFavorito?:      boolean
  onToggleFavorito?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border text-left transition-colors ${
        marcado ? 'bg-accent/10 border-accent/40' : 'bg-white border-[#D3D1C7] hover:border-accent/40'
      }`}
    >
      <span
        className={`w-5 h-5 rounded shrink-0 border flex items-center justify-center ${
          marcado ? 'bg-accent border-accent text-white' : 'border-gray-300'
        }`}
      >
        {marcado && (
          <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
            <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="flex-1 text-sm text-gray-900">{tipo.nombre}</span>
      {onToggleFavorito && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onToggleFavorito() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onToggleFavorito() } }}
          className={`shrink-0 p-1 -m-1 ${esFavorito ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
          aria-label={esFavorito ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        >
          <Star size={18} fill={esFavorito ? 'currentColor' : 'none'} />
        </span>
      )}
    </button>
  )
}

// Listado con casillas (multi-select) de tipos de reparación — reemplaza el
// <select> de un solo tipo que había antes en Soltar/Aprobar paso (taller) y
// Registrar trabajo (técnico de calle). Pensado para tocar con el dedo desde
// tablet o celular: filas grandes, todo el ancho clickeable.
export default function TipoReparacionChecklist({
  tipos, seleccionados, onToggle, showSearch, favoritos, onToggleFavorito,
}: TipoReparacionChecklistProps) {
  const [busqueda, setBusqueda] = useState('')

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return tipos
    return tipos.filter((t) => t.nombre.toLowerCase().includes(q))
  }, [tipos, busqueda])

  const favoritosVisibles = useMemo(
    () => (favoritos ? visibles.filter((t) => favoritos.includes(t.id)) : []),
    [visibles, favoritos],
  )
  const restantes = useMemo(
    () => (favoritos ? visibles.filter((t) => !favoritos.includes(t.id)) : visibles),
    [visibles, favoritos],
  )

  if (tipos.length === 0) {
    return <p className="text-gray-400 text-sm">Todavía no hay tipos cargados para tu sector.</p>
  }

  return (
    <div className="space-y-3">
      {showSearch && (
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar…"
            className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="text-gray-400 text-sm">Sin resultados para "{busqueda}".</p>
      ) : (
        <>
          {favoritosVisibles.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Favoritos</p>
              {favoritosVisibles.map((t) => (
                <Fila
                  key={t.id} tipo={t} marcado={seleccionados.includes(t.id)} onToggle={() => onToggle(t.id)}
                  esFavorito onToggleFavorito={onToggleFavorito ? () => onToggleFavorito(t.id) : undefined}
                />
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            {favoritosVisibles.length > 0 && (
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Todos</p>
            )}
            {restantes.map((t) => (
              <Fila
                key={t.id} tipo={t} marcado={seleccionados.includes(t.id)} onToggle={() => onToggle(t.id)}
                esFavorito={false} onToggleFavorito={onToggleFavorito ? () => onToggleFavorito(t.id) : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
