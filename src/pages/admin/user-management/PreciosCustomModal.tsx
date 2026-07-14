import { useState, ChangeEvent } from 'react'
import { deleteField, serverTimestamp } from 'firebase/firestore'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { registrarCambiosCustom, CambioCustom } from '../../../services/historialPreciosService'
import { updateUserDocument } from '../../../services/userService'
import { UserProfile, ListaPrecios } from '../../../types'

export function PreciosCustomModal({
  user,
  lista,
  currentUser,
  onClose,
}: {
  user:        UserProfile
  lista:       ListaPrecios
  currentUser: UserProfile | null
  onClose:     () => void
}) {
  const [overrides,     setOverrides]     = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    lista.items.filter((i) => i.activo).forEach((i) => {
      const v = user.preciosCustom?.[i.productoId]
      if (v !== undefined) map[i.productoId] = String(v)
    })
    return map
  })
  const [motivo,        setMotivo]        = useState('')
  const [vigenciaHasta, setVigenciaHasta] = useState(user.vigenciaCustom?.[lista.items[0]?.productoId ?? ''] ?? '')
  const [saving,        setSaving]        = useState(false)

  const activeItems = lista.items.filter((i) => i.activo)

  const handleSave = async () => {
    setSaving(true)

    // Construir nuevo preciosCustom
    const preciosCustom: Record<string, number> = {}
    Object.entries(overrides).forEach(([id, val]) => {
      const n = Number(val)
      if (!isNaN(n) && val !== '') preciosCustom[id] = n
    })

    // Vigencia para todos los productos con precio custom
    const vigenciaCustom: Record<string, string> = {}
    if (vigenciaHasta) {
      Object.keys(preciosCustom).forEach((id) => { vigenciaCustom[id] = vigenciaHasta })
    }

    // Calcular cambios respecto al estado anterior
    const oldCustom = user.preciosCustom ?? {}
    const cambios: CambioCustom[] = []

    for (const [id, newPrice] of Object.entries(preciosCustom)) {
      const oldPrice = oldCustom[id] ?? null
      if (oldPrice !== newPrice) {
        const item = activeItems.find((i) => i.productoId === id)
        cambios.push({
          productoId:     id,
          productoNombre: item?.nombre ?? id,
          precioAnterior: oldPrice,
          precioNuevo:    newPrice,
          accion:         oldPrice === null ? 'agregado' : 'modificado',
          vigenciaHasta:  vigenciaHasta || null,
        })
      }
    }
    for (const id of Object.keys(oldCustom)) {
      if (!(id in preciosCustom)) {
        const item = activeItems.find((i) => i.productoId === id)
        cambios.push({
          productoId:     id,
          productoNombre: item?.nombre ?? id,
          precioAnterior: oldCustom[id],
          precioNuevo:    null,
          accion:         'eliminado',
          vigenciaHasta:  null,
        })
      }
    }

    await updateUserDocument(user.uid, {
      preciosCustom:      Object.keys(preciosCustom).length ? preciosCustom : deleteField(),
      vigenciaCustom:     Object.keys(vigenciaCustom).length ? vigenciaCustom : deleteField(),
      ultimoCambioPrecio: cambios.length > 0 ? serverTimestamp() : (user.ultimoCambioPrecio ?? null),
    })

    if (cambios.length > 0 && currentUser) {
      registrarCambiosCustom({
        clientId:            user.uid,
        clientName:          user.razonSocial || user.nombre || user.email,
        cambios,
        modificadoPor:       currentUser.email,
        modificadoPorNombre: currentUser.nombreContacto || currentUser.nombre || currentUser.email,
        motivo:              motivo || undefined,
      }).catch(console.error)
    }

    setSaving(false)
    onClose()
  }

  const pct = (nuevo: number, viejo: number) => Math.round(((nuevo - viejo) / viejo) * 100)

  return (
    <Modal
      open
      onClose={onClose}
      title={`Precios especiales — ${user.razonSocial || user.nombre}`}
    >
      <p className="text-xs text-gray-500 mb-4">
        Dejá el campo vacío para usar el precio del canal ({lista.nombre}).
        Ingresá un valor para sobreescribir solo ese producto.
      </p>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {activeItems.map((item) => {
          const hasOverride = overrides[item.productoId] !== undefined
          const newNum      = hasOverride ? Number(overrides[item.productoId]) : null
          const oldNum      = user.preciosCustom?.[item.productoId] ?? null
          const changed     = hasOverride && newNum !== null && newNum !== oldNum
          const diff        = changed && oldNum !== null ? pct(newNum!, oldNum) : null
          const bigChange   = diff !== null && Math.abs(diff) > 20

          return (
            <div key={item.productoId} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <span className="text-sm truncate block">{item.nombre}</span>
                {diff !== null && (
                  <span className={`text-xs font-semibold ${bigChange ? 'text-red-400' : diff > 0 ? 'text-orange-400' : 'text-success'}`}>
                    {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}%{bigChange ? ' ⚠' : ''}
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-500 shrink-0 w-16 text-right">
                Canal: ${item.precio.toLocaleString('es-AR')}
              </span>
              <div className="relative w-28 shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                <input
                  type="number"
                  min="0"
                  placeholder={String(item.precio)}
                  value={overrides[item.productoId] ?? ''}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const v = e.target.value
                    setOverrides((p) => {
                      const next = { ...p }
                      if (v === '') delete next[item.productoId]
                      else next[item.productoId] = v
                      return next
                    })
                  }}
                  className={`w-full bg-[#F8F7F2] border rounded-lg pl-6 pr-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent ${
                    hasOverride ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-[#D3D1C7]'
                  }`}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Vigencia y motivo */}
      <div className="mt-4 space-y-3 border-t border-[#D3D1C7]/50 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Válido hasta (opcional)</label>
            <input
              type="date"
              value={vigenciaHasta}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setVigenciaHasta(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Motivo del cambio</label>
            <input
              type="text"
              value={motivo}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setMotivo(e.target.value)}
              placeholder="Acuerdo comercial, ajuste..."
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
        {vigenciaHasta && (
          <p className="text-xs text-accent/70">
            Los precios especiales tendrán vigencia hasta el {new Date(vigenciaHasta + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
        )}
      </div>

      <div className="flex gap-3 mt-4">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1">Guardar</Button>
      </div>
    </Modal>
  )
}
