import { useState } from 'react'
import { UserProfile, OrderProduct, getPrimaryAddress, DIAS_SEMANA } from '../../types'
import { useRecurrente } from '../../hooks/useRecurrente'
import { useCatalogo } from '../../hooks/useCatalogo'
import { summarizeProducts } from '../../utils/helpers'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

interface RecurrenteCardProps {
  user: UserProfile | null
}

export function RecurrenteCard({ user }: RecurrenteCardProps) {
  const { recurrente, save } = useRecurrente(user?.uid)
  const { catalogo }         = useCatalogo()
  const [modal,      setModal]      = useState(false)
  const [diasSel,    setDiasSel]    = useState<number[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [saving,     setSaving]     = useState(false)

  const primaryAddr = user ? getPrimaryAddress(user) : null

  const openModal = () => {
    setDiasSel(recurrente?.diasSemana ?? [])
    const q: Record<string, number> = {}
    recurrente?.products.forEach((p) => { if (p.productoId) q[p.productoId] = p.quantity })
    setQuantities(q)
    setModal(true)
  }

  const handleSave = async (activo: boolean) => {
    if (!user) return
    const products: OrderProduct[] = catalogo
      .filter((p) => (quantities[p.id] ?? 0) > 0)
      .map((p) => ({ name: p.nombre, quantity: quantities[p.id], productoId: p.id }))

    setSaving(true)
    await save({
      clientId:      user.uid,
      clientEmail:   user.email,
      clientName:    user.razonSocial || user.nombre || '',
      clientAddress: primaryAddr?.address || user.address || '',
      clientPhone:   user.telefono || user.phone || '',
      diasSemana:    diasSel,
      products,
      activo,
    })
    setSaving(false)
    setModal(false)
  }

  if (recurrente === undefined) return null

  const diasLabels = DIAS_SEMANA.filter((_, i) => recurrente?.diasSemana?.includes(i))

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold text-gray-900">Pedido automático</p>
              {recurrente && (
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                  recurrente.activo
                    ? 'bg-[#E8F5F0] text-[#0F6E56] border-[#B3DDD3]'
                    : 'bg-gray-100 text-gray-500 border-gray-200'
                }`}>
                  {recurrente.activo ? 'Activo' : 'Pausado'}
                </span>
              )}
            </div>
            {recurrente ? (
              <>
                <p className="text-xs text-gray-500">{diasLabels.join(' · ')}</p>
                <p className="text-xs text-gray-700 mt-0.5 truncate">{summarizeProducts(recurrente.products)}</p>
              </>
            ) : (
              <p className="text-xs text-gray-500">Recibí tus productos los mismos días sin tener que pedir cada vez</p>
            )}
          </div>
          <button onClick={openModal} className="shrink-0 text-xs text-accent hover:underline font-medium">
            {recurrente ? 'Editar' : 'Configurar →'}
          </button>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Pedido automático">
        <div className="space-y-5">
          <div>
            <p className="text-xs text-gray-500 mb-2">Días de entrega</p>
            <div className="flex gap-2 flex-wrap">
              {DIAS_SEMANA.map((dia, i) => (
                <button
                  key={dia}
                  onClick={() => setDiasSel((d) =>
                    d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()
                  )}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    diasSel.includes(i)
                      ? 'bg-accent/15 border-accent text-accent'
                      : 'border-gray-200 text-gray-500 hover:border-accent/50'
                  }`}
                >
                  {dia}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-muted mb-2">Productos</p>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {catalogo.map((p) => {
                const qty = quantities[p.id] ?? 0
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 bg-bg border border-border rounded-xl px-3 py-2">
                    <p className="text-sm flex-1 truncate">{p.nombre}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setQuantities((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 0) - 1) }))}
                        disabled={qty === 0}
                        aria-label={`Reducir ${p.nombre}`}
                        className="w-7 h-7 rounded-full border border-border hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center text-sm"
                      >−</button>
                      <span className="w-7 text-center font-bold text-sm" aria-live="polite">{qty || '0'}</span>
                      <button
                        onClick={() => setQuantities((q) => ({ ...q, [p.id]: (q[p.id] ?? 0) + 1 }))}
                        aria-label={`Agregar ${p.nombre}`}
                        className="w-7 h-7 rounded-full border border-border hover:border-accent transition-colors flex items-center justify-center text-sm"
                      >+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          {recurrente?.activo && (
            <Button variant="outline" onClick={() => handleSave(false)} loading={saving} className="text-sm">
              Pausar
            </Button>
          )}
          <Button
            onClick={() => handleSave(true)}
            loading={saving}
            disabled={diasSel.length === 0 || !catalogo.some((p) => (quantities[p.id] ?? 0) > 0)}
            className="flex-1 text-sm"
          >
            Guardar
          </Button>
        </div>
      </Modal>
    </>
  )
}
