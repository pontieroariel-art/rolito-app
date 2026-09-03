import { useState, useEffect, ChangeEvent } from 'react'
import { deleteField } from 'firebase/firestore'
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query'
import { Plus, Trash2, Save, ChevronDown, ChevronRight, Tag, Users, Star, ImagePlus } from 'lucide-react'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useAllListasPrecios } from '../../hooks/useListasPrecios'
import {
  createListaPrecios,
  updateListaPrecios,
  deleteListaPrecios,
} from '../../services/listaPreciosService'
import { getCatalogo, saveCatalogo, subirFotoProducto } from '../../services/catalogoService'
import ProductoThumb from '../../components/ventas/ProductoThumb'
import SyncPreciosTangoPanel from '../../components/admin/SyncPreciosTangoPanel'
import ListasTangoPanel from '../../components/admin/ListasTangoPanel'
import { autoEtiqueta } from '../../utils/productoVisual'
import { getAllUsers } from '../../services/userService'
import { updateUserDocument } from '../../services/userService'
import { registrarCambiosLista } from '../../services/historialPreciosService'
import { useAuth } from '../../context/AuthContext'
import { CatalogProducto, ItemListaPrecios, ListaPrecios, UserProfile } from '../../types'
import { reportError } from '@/services/observability'

type Tab = 'tango' | 'listas' | 'catalogo'
const TAB_LABEL: Record<Tab, string> = { tango: 'Listas de Tango', listas: 'Listas de la app', catalogo: 'Catálogo de productos' }

// ── PriceListsPage ────────────────────────────────────────────────────────────

export default function PriceListsPage() {
  const [tab, setTab]             = useState<Tab>('tango')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const qc                        = useQueryClient()
  const { listas, isLoading }     = useAllListasPrecios()
  const { catalogo }              = useCatalogo()
  const { data: users = [] }      = useQuery({ queryKey: ['users'], queryFn: () => getAllUsers() })

  const selectedLista = listas.find((l) => l.id === selectedId) ?? null

  // Auto-select first list when loaded
  useEffect(() => {
    if (!selectedId && listas.length > 0) setSelectedId(listas[0].id)
  }, [listas, selectedId])

  const createMutation = useMutation({
    mutationFn: ({ nombre, items }: { nombre: string; items: ItemListaPrecios[] }) =>
      createListaPrecios(nombre, items),
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['listas-precios'] })
      setSelectedId(id)
    },
  })

  const handleNuevaLista = () => {
    const nombre = prompt('Nombre del canal / lista:')
    if (!nombre?.trim()) return
    const items: ItemListaPrecios[] = catalogo.map((p) => ({
      productoId: p.id,
      nombre:     p.nombre,
      unidad:     p.unidad,
      precio:     0,
      activo:     false,
    }))
    createMutation.mutate({ nombre: nombre.trim(), items })
  }

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <main className="max-w-5xl mx-auto p-4 pb-10 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Precios</h1>
          <p className="text-gray-500 text-sm mt-1 break-words">Catálogo de productos y listas de precios por canal</p>
        </div>

        <SyncPreciosTangoPanel />

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-[#D3D1C7] rounded-xl p-1 w-full sm:w-fit overflow-x-auto">
          {(['tango', 'listas', 'catalogo'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-1 sm:flex-none ${
                tab === t ? 'bg-accent text-white' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {tab === 'tango' ? (
          <ListasTangoPanel />
        ) : tab === 'listas' ? (
          isLoading ? <LoadingSpinner /> : (
            <div className="grid md:grid-cols-[220px_1fr] gap-4">
              {/* Sidebar */}
              <div className="space-y-1">
                {listas.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setSelectedId(l.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${
                      selectedId === l.id
                        ? 'bg-accent/10 text-accent border border-accent/30'
                        : 'bg-white border border-[#D3D1C7] text-gray-900 hover:border-accent/50'
                    }`}
                  >
                    <span className="font-medium">{l.nombre}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      {l.items.filter((i) => i.activo).length} productos activos
                    </span>
                  </button>
                ))}
                <button
                  onClick={handleNuevaLista}
                  disabled={createMutation.isPending}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:text-accent border border-dashed border-[#D3D1C7] hover:border-accent/50 transition-colors"
                >
                  <Plus size={14} /> Nueva lista
                </button>
              </div>

              {/* Editor */}
              {selectedLista ? (
                <ListaEditor
                  key={selectedLista.id}
                  lista={selectedLista}
                  catalogo={catalogo}
                  users={users}
                  onSaved={() => qc.invalidateQueries({ queryKey: ['listas-precios'] })}
                  onDeleted={() => {
                    qc.invalidateQueries({ queryKey: ['listas-precios'] })
                    setSelectedId(null)
                  }}
                />
              ) : (
                <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center text-gray-500 text-sm">
                  Seleccioná una lista o creá una nueva
                </div>
              )}
            </div>
          )
        ) : (
          <CatalogoEditor
            catalogo={catalogo}
            onSaved={() => qc.invalidateQueries({ queryKey: ['catalogo'] })}
          />
        )}
      </main>
    </div>
  )
}

// ── ListaEditor ───────────────────────────────────────────────────────────────

function ListaEditor({
  lista,
  catalogo,
  users,
  onSaved,
  onDeleted,
}: {
  lista:    ListaPrecios
  catalogo: CatalogProducto[]
  users:    UserProfile[]
  onSaved:  () => void
  onDeleted: () => void
}) {
  // Merge catalog into items (new catalog products appear as inactive with price 0)
  const buildItems = (): ItemListaPrecios[] => {
    const existing = new Map(lista.items.map((i) => [i.productoId, i]))
    return catalogo.map((p) => existing.get(p.id) ?? {
      productoId: p.id,
      nombre:     p.nombre,
      unidad:     p.unidad,
      precio:     0,
      activo:     false,
    })
  }

  const { user: currentUser } = useAuth()
  const [nombre, setNombre]   = useState(lista.nombre)
  const [items,  setItems]    = useState<ItemListaPrecios[]>(buildItems)
  const [saving, setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Clients assigned to this list
  const clientsInList = users.filter(
    (u) => u.listaPreciosId === lista.id && u.rol === 'cliente',
  )

  // Clients with a custom price override for a given product
  const overridesFor = (productoId: string) =>
    clientsInList.filter((u) => u.preciosCustom?.[productoId] !== undefined)

  const setItem = (productoId: string, patch: Partial<ItemListaPrecios>) =>
    setItems((prev) => prev.map((i) => i.productoId === productoId ? { ...i, ...patch } : i))

  const handleSave = async () => {
    setSaving(true)
    try {
      // Cambios de precio de productos ya activos, respecto a como estaba la
      // lista antes de abrir el editor — antes esta edición no dejaba ningún
      // rastro en el historial (solo se registraban cambios de lista
      // asignada a un cliente puntual, o overrides individuales).
      const originalByProductId = new Map(lista.items.map((i) => [i.productoId, i]))
      const cambios = items.flatMap((i) => {
        const original = originalByProductId.get(i.productoId)
        if (!original || !original.activo || !i.activo || original.precio === i.precio) return []
        return [{
          productoId:     i.productoId,
          productoNombre: i.nombre,
          precioAnterior: original.precio,
          precioNuevo:    i.precio,
        }]
      })

      await updateListaPrecios(lista.id, { nombre, items })

      if (cambios.length > 0 && currentUser) {
        registrarCambiosLista({
          listaId:             lista.id,
          listaNombre:         nombre,
          cambios,
          modificadoPor:       currentUser.email,
          modificadoPorNombre: currentUser.nombreContacto || currentUser.nombre || currentUser.email,
        }).catch((err) => reportError(err, { origen: 'PriceListsPage' }))
      }

      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar la lista "${lista.nombre}"? Esta acción no se puede deshacer.`)) return
    setDeleting(true)
    try {
      await deleteListaPrecios(lista.id)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  const qc = useQueryClient()
  const handleRemoveOverride = async (user: UserProfile, productoId: string) => {
    const newCustom = { ...(user.preciosCustom ?? {}) }
    delete newCustom[productoId]
    await updateUserDocument(user.uid, { preciosCustom: Object.keys(newCustom).length ? newCustom : deleteField() })
    qc.invalidateQueries({ queryKey: ['users'] })
  }

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <label className="text-xs text-gray-500 uppercase tracking-wide">Nombre del canal</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="mt-1 bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} loading={saving} className="text-sm py-2 px-4">
            <Save size={14} className="mr-1.5" />Guardar
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting} className="text-sm py-2 px-3">
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {/* Clients summary */}
      {clientsInList.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Users size={13} />
          {clientsInList.length} cliente{clientsInList.length !== 1 ? 's' : ''} en este canal
        </div>
      )}

      {/* Products table */}
      <div className="space-y-1">
        <div className="grid grid-cols-[24px_1fr_110px_auto] gap-3 px-2 pb-1 text-xs text-gray-500 uppercase tracking-wide">
          <span></span>
          <span>Producto</span>
          <span>Precio</span>
          <span>Dif.</span>
        </div>

        {items.map((item) => {
          const overrides = overridesFor(item.productoId)
          const isExpanded = expanded[item.productoId]

          return (
            <div key={item.productoId}>
              <div
                className={`grid grid-cols-[24px_1fr_110px_auto] gap-3 items-center px-2 py-2 rounded-lg transition-colors ${
                  item.activo ? 'bg-gray-50' : 'opacity-50'
                }`}
              >
                {/* Toggle activo */}
                <button
                  onClick={() => setItem(item.productoId, { activo: !item.activo })}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                    item.activo
                      ? 'bg-accent border-accent'
                      : 'border-[#D3D1C7] hover:border-accent/50'
                  }`}
                >
                  {item.activo && <span className="text-white text-xs font-bold">✓</span>}
                </button>

                {/* Nombre */}
                <span className="text-sm truncate min-w-0" title={item.nombre}>
                  {item.nombre}
                  <span className="text-gray-500 text-xs ml-1.5">{item.unidad}</span>
                </span>

                {/* Precio */}
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                  <input
                    type="number"
                    min="0"
                    value={item.precio || ''}
                    placeholder="0"
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setItem(item.productoId, { precio: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-6 pr-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                {/* Override count */}
                <button
                  onClick={() => overrides.length > 0 && setExpanded((p) => ({ ...p, [item.productoId]: !isExpanded }))}
                  className={`flex items-center gap-1 text-xs whitespace-nowrap ${
                    overrides.length > 0
                      ? 'text-amber-600 hover:text-amber-700 cursor-pointer'
                      : 'text-gray-300 cursor-default'
                  }`}
                >
                  {overrides.length > 0 ? (
                    <>
                      <Tag size={11} />
                      {overrides.length}
                      {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </>
                  ) : '—'}
                </button>
              </div>

              {/* Expanded: clients with overrides */}
              {isExpanded && overrides.length > 0 && (
                <div className="ml-8 mb-1 space-y-0.5">
                  {overrides.map((u) => (
                    <div
                      key={u.uid}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg"
                    >
                      <span className="text-xs text-gray-900 truncate flex-1">
                        {u.razonSocial || u.nombre}
                      </span>
                      <span className="text-xs font-bold text-amber-600 shrink-0">
                        ${u.preciosCustom![item.productoId].toLocaleString('es-AR')}
                      </span>
                      <button
                        onClick={() => handleRemoveOverride(u, item.productoId)}
                        className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                        title="Quitar precio especial"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── CatalogoEditor ────────────────────────────────────────────────────────────

function CatalogoEditor({
  catalogo,
  onSaved,
}: {
  catalogo: CatalogProducto[]
  onSaved:  () => void
}) {
  const [nombre,  setNombre]  = useState('')
  const [unidad,  setUnidad]  = useState('unidad')
  const [saving,  setSaving]  = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  const handleFoto = async (p: CatalogProducto, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permitir re-subir la misma imagen
    if (!file) return
    setUploadingId(p.id)
    try {
      const fotoUrl = await subirFotoProducto(p.id, file)
      await saveCatalogo(catalogo.map((x) => (x.id === p.id ? { ...x, fotoUrl } : x)))
      onSaved()
    } catch {
      alert('No se pudo subir la foto. Probá con otra imagen.')
    } finally {
      setUploadingId(null)
    }
  }

  const handleToggleDestacado = async (p: CatalogProducto) => {
    await saveCatalogo(catalogo.map((x) => (x.id === p.id ? { ...x, destacado: !x.destacado } : x)))
    onSaved()
  }

  const handleAdd = async () => {
    if (!nombre.trim()) return
    const id   = nombre.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const newP: CatalogProducto = { id: `${id}_${Date.now()}`, nombre: nombre.trim(), unidad }
    setSaving(true)
    try {
      await saveCatalogo([...catalogo, newP])
      onSaved()
      setNombre('')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (id: string) => {
    if (!confirm('¿Eliminar este producto del catálogo?')) return
    await saveCatalogo(catalogo.filter((p) => p.id !== id))
    onSaved()
  }

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-5 space-y-4">
      <p className="text-sm text-gray-500">
        El catálogo define los productos disponibles en el sistema. Agregar un producto aquí lo
        hace disponible para activar en cualquier lista de precios.
      </p>

      <div className="space-y-1.5">
        {catalogo.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 bg-gray-50 border border-[#D3D1C7] rounded-lg px-3 py-2.5"
          >
            {/* Foto: la miniatura es el control para subir/cambiar */}
            <label className="relative cursor-pointer group shrink-0" title="Subir o cambiar foto">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingId === p.id}
                onChange={(e) => handleFoto(p, e)}
              />
              <ProductoThumb producto={p} size={44} />
              <span
                className={`absolute inset-0 rounded-lg bg-black/30 flex items-center justify-center text-white transition-opacity ${
                  uploadingId === p.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {uploadingId === p.id ? <span className="text-[11px] font-semibold">…</span> : <ImagePlus size={16} />}
              </span>
            </label>

            <div className="flex-1 min-w-0">
              <span className="text-sm text-gray-900">{p.nombre}</span>
              <span className="text-xs text-gray-500 ml-2">{p.unidad}</span>
            </div>

            {/* Frecuente: aparece arriba en la botonera de venta */}
            <button
              onClick={() => handleToggleDestacado(p)}
              title={p.destacado ? 'Frecuente (aparece arriba en la venta)' : 'Marcar como frecuente'}
              className={`p-1.5 rounded-lg transition-colors shrink-0 ${p.destacado ? 'text-amber-500' : 'text-gray-300 hover:text-gray-500'}`}
            >
              <Star size={16} fill={p.destacado ? 'currentColor' : 'none'} />
            </button>

            {/* Texto del badge de la tarjeta (vacío = automático desde el nombre) */}
            <input
              type="text"
              defaultValue={p.etiqueta ?? ''}
              placeholder={autoEtiqueta(p.nombre) || 'badge'}
              title="Texto del badge en la botonera (ej: 10 kg, Picado). Vacío = automático."
              onBlur={async (e) => {
                const val = e.target.value.trim()
                if (val === (p.etiqueta ?? '')) return
                const updated = catalogo.map((x) => {
                  if (x.id !== p.id) return x
                  const copy = { ...x }
                  if (val) copy.etiqueta = val
                  else delete copy.etiqueta
                  return copy
                })
                await saveCatalogo(updated)
                onSaved()
              }}
              className="w-20 bg-white border border-[#D3D1C7] rounded px-2 py-1 text-xs text-gray-900 text-center focus:outline-none focus:ring-1 focus:ring-accent placeholder-gray-300 shrink-0"
            />

            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number"
                min={1}
                placeholder="u/pallet"
                defaultValue={p.unidadesPorPallet ?? ''}
                title="Unidades por pallet"
                onBlur={async (e) => {
                  const val = e.target.value ? parseInt(e.target.value) : undefined
                  if (val === p.unidadesPorPallet) return
                  const updated = catalogo.map((x) =>
                    x.id === p.id ? { ...x, unidadesPorPallet: val } : x,
                  )
                  await saveCatalogo(updated)
                  onSaved()
                }}
                className="w-24 bg-white border border-[#D3D1C7] rounded px-2 py-1 text-xs text-gray-900 text-right focus:outline-none focus:ring-1 focus:ring-accent placeholder-gray-300"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">u/pallet</span>
            </div>
            <button
              onClick={() => handleRemove(p.id)}
              className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Agregar producto */}
      <div className="border-t border-gray-200 pt-4 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-gray-500 uppercase tracking-wide">Nombre</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Ej: Hielo granizado 5kg"
            className="mt-1 w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="w-28">
          <label className="text-xs text-gray-500 uppercase tracking-wide">Unidad</label>
          <select
            value={unidad}
            onChange={(e) => setUnidad(e.target.value)}
            className="mt-1 w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {['bolsa', 'barra', 'unidad', 'kg', 'litro', 'bidón', 'caja'].map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <Button onClick={handleAdd} loading={saving} className="py-2 px-4 text-sm">
          <Plus size={14} className="mr-1.5" />Agregar
        </Button>
      </div>
    </div>
  )
}
