import { useState, useEffect, ChangeEvent } from 'react'
import { deleteField } from 'firebase/firestore'
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query'
import { Plus, Trash2, Save, ChevronDown, ChevronRight, Tag, Users, Star, ImagePlus } from 'lucide-react'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useCatalogo } from '../../hooks/useCatalogo'
import { getCatalogo, saveCatalogo, subirFotoProducto } from '../../services/catalogoService'
import ProductoThumb from '../../components/ventas/ProductoThumb'
import SyncPreciosTangoPanel from '../../components/admin/SyncPreciosTangoPanel'
import ListasTangoPanel from '../../components/admin/ListasTangoPanel'
import { autoEtiqueta } from '../../utils/productoVisual'
import { getAllUsers } from '../../services/userService'
import { updateUserDocument } from '../../services/userService'
import { useAuth } from '../../context/AuthContext'
import { CatalogProducto } from '../../types'
import { reportError } from '@/services/observability'

// Las listas propias de la app se eliminaron el 2026-09-03: los precios son
// los de Tango (pestaña "Listas de Tango", solo lectura). Acá queda además el
// catálogo de productos (nombres, fotos, unidades), que sigue siendo de la app.
type Tab = 'tango' | 'catalogo'
const TAB_LABEL: Record<Tab, string> = { tango: 'Listas de Tango', catalogo: 'Catálogo de productos' }

// ── PriceListsPage ────────────────────────────────────────────────────────────

export default function PriceListsPage() {
  const [tab, setTab]  = useState<Tab>('tango')
  const qc             = useQueryClient()
  const { catalogo }   = useCatalogo()

  return (
    <div className="min-h-screen min-h-dvh bg-[#F1EFE8] text-gray-900">
      <main className="max-w-5xl mx-auto p-4 pb-10 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Precios</h1>
          <p className="text-gray-500 text-sm mt-1 break-words">Listas y precios de Tango (solo lectura) y catálogo de productos de la app</p>
        </div>

        <SyncPreciosTangoPanel solo="precios" />

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-[#D3D1C7] rounded-xl p-1 w-full sm:w-fit overflow-x-auto">
          {(['tango', 'catalogo'] as Tab[]).map((t) => (
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
        El catálogo define los productos disponibles en el sistema (nombre, unidad, foto, badge).
        El precio de cada producto viene de Tango: el producto se vende cuando está mapeado a un
        artículo de Tango (config/tango.articulos) y la lista del cliente tiene precio cargado.
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
