import { useMemo, useState } from 'react'
import { Minus, Plus, Truck } from 'lucide-react'
import Badge from '@/components/common/Badge'
import Button from '@/components/ui/Button'
import { describirEnvases, envasesDeRemito } from '@/utils/envases'
import type { BorradorCarga, RemitoCargaItem } from '@/types'

/**
 * Un camión listo para salir, visto desde la tablet del muelle (2026-09-18).
 *
 * Lo que se ve acá es el BORRADOR que armó caja, no un remito: el remito todavía
 * no existe. Muelle corrige lo que realmente subió al camión y toca UNA sola
 * acción —"Entregar el camión"— que es la que hace nacer el remito con su número,
 * su remito R y el COT con la hora real de salida.
 *
 * Los renglones son editables porque el plan se arma antes (a veces la tarde
 * anterior) y lo que sube al camión es lo que hay en cámara a las 4 de la mañana.
 * Si el muellero no corrige nada, sale exactamente lo planificado.
 */
export default function EntregarCamionCard({
  borrador, entregando, bloqueado, darsena, onDarsena, darsenas, onEntregar,
}: {
  borrador:   BorradorCarga
  entregando: boolean
  /** Otra tarjeta está emitiendo: no se tocan dos camiones a la vez. */
  bloqueado:  boolean
  darsena?:   number
  onDarsena:  (n: number) => void
  darsenas:   number[]
  onEntregar: (items: RemitoCargaItem[]) => void
}) {
  // Lo corregido, por producto. Vacío = sale el plan tal cual.
  const [corregidas, setCorregidas] = useState<Record<string, number>>({})
  const cantidad = (i: RemitoCargaItem) => corregidas[i.productoId] ?? i.cantidad
  const set = (i: RemitoCargaItem, v: number) =>
    setCorregidas((prev) => ({ ...prev, [i.productoId]: Math.max(0, Math.min(99999, v)) }))

  const items = useMemo(
    () => borrador.items
      .map((i) => ({ ...i, cantidad: corregidas[i.productoId] ?? i.cantidad }))
      .filter((i) => i.cantidad > 0),
    [borrador.items, corregidas],
  )
  const hayCorrecciones = borrador.items.some((i) => cantidad(i) !== i.cantidad)
  const totalBolsas = items.reduce((s, i) => s + i.cantidad, 0)
  // Los puntales, aros y sombreros no se declaran: salen implícitos de los
  // pallets y las tarimas (ver envasesDeRemito en utils/envases.ts).
  const envases = describirEnvases(envasesDeRemito({
    palletsCarga: borrador.envases.tarimasMadera + borrador.envases.palletsMetal,
    envases:      borrador.envases,
  }))

  const btn = 'w-11 h-11 rounded-lg border border-[#D3D1C7] bg-white text-gray-900 flex items-center justify-center active:scale-95 disabled:opacity-40'

  return (
    <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold text-gray-900 truncate" title={borrador.camionLabel}>
            {borrador.camionLabel || 'Sin camión'}
          </p>
          <p className="text-base text-secundario truncate" title={borrador.choferNombre}>{borrador.choferNombre}</p>
        </div>
        <div className="shrink-0">
          {hayCorrecciones
            ? <Badge tono="aviso">Corregido</Badge>
            : <Badge tono="neutro">Como lo planificó caja</Badge>}
        </div>
      </div>

      <div className="space-y-1.5">
        {borrador.items.map((i) => (
          <div key={i.productoId} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate text-base text-gray-900" title={i.nombre}>{i.nombre}</span>
            <button type="button" aria-label={`Menos ${i.nombre}`} className={btn} onClick={() => set(i, cantidad(i) - 1)} disabled={entregando}>
              <Minus size={18} />
            </button>
            <input
              value={cantidad(i)}
              onChange={(e) => set(i, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
              inputMode="numeric"
              disabled={entregando}
              aria-label={`Cantidad de ${i.nombre}`}
              className="w-20 h-11 text-center text-lg font-semibold tabular-nums bg-white border border-[#D3D1C7] rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
            />
            <button type="button" aria-label={`Más ${i.nombre}`} className={btn} onClick={() => set(i, cantidad(i) + 1)} disabled={entregando}>
              <Plus size={18} />
            </button>
            {cantidad(i) !== i.cantidad && (
              <span className="w-24 shrink-0 text-sm text-[#8A5203] tabular-nums">plan {i.cantidad}</span>
            )}
          </div>
        ))}
      </div>

      <p className="text-base text-secundario tabular-nums">
        {totalBolsas} bolsas{envases && ` · ${envases}`}
      </p>

      {/* Dársena de carga: se guarda en el BORRADOR, no en el remito, porque
          cuando el camión entra a la boca el remito todavía no existe (nace
          recién cuando muelle lo entrega). El TV del muelle la lee de ahí
          mientras la carga está en curso. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-base text-secundario shrink-0">Dársena</span>
        {darsenas.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onDarsena(n)}
            className={`w-11 h-11 rounded-lg border text-base font-bold tabular-nums transition-colors ${
              darsena === n ? 'bg-accent text-white border-accent' : 'bg-white text-gray-600 border-[#D3D1C7]'
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <Button
        onClick={() => onEntregar(items)}
        loading={entregando}
        disabled={bloqueado || items.length === 0}
        className="w-full h-14 text-base"
      >
        <Truck size={18} /> Entregar el camión
      </Button>
      <p className="text-sm text-secundario">
        Al tocar sale el remito con su número y, si hace falta, el COT con la hora de ahora.
      </p>
    </div>
  )
}
