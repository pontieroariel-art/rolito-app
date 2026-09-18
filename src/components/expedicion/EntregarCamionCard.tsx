import { useMemo, useState } from 'react'
import { FileText, Minus, Plus } from 'lucide-react'
import Badge from '@/components/common/Badge'
import Button from '@/components/ui/Button'
import RacksInput from '@/components/expedicion/RacksInput'
import { describirEnvases, envasesDeRemito } from '@/utils/envases'
import type { BorradorCarga, EnvasesCarga, RemitoCargaItem } from '@/types'

/**
 * Un camión listo para salir, visto desde la tablet del muelle (2026-09-18).
 *
 * Lo que se ve acá es el BORRADOR que armó caja, no un remito: el remito todavía
 * no existe. Muelle corrige lo que realmente subió al camión y toca UNA sola
 * acción —"Confeccionar el remito"— que es la que hace nacer el papel con su
 * número, su remito R y el COT de este momento. Ese papel es contra el que se
 * carga; la entrega se marca después, con la mercadería ya arriba del camión.
 *
 * Los renglones son editables porque el plan se arma antes (a veces la tarde
 * anterior) y lo que sube al camión es lo que hay en cámara a las 4 de la mañana.
 * Si el muellero no corrige nada, sale exactamente lo planificado.
 *
 * Los ENVASES los declara muelle acá y no caja en el borrador (corrección de
 * Ariel, 18/09): caja no sabe con qué tipo de pallet va a salir la carga ni qué
 * racks se van a usar. Eso lo sabe quien la arma físicamente.
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
  onEntregar: (items: RemitoCargaItem[], envases: EnvasesCarga) => void
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

  // Envases que salen: los cuenta muelle al armar la carga. Arranca en cero,
  // sin sugerir nada: el sugerido por la mercadería es un cálculo de la app y
  // acá lo que vale es lo que el muellero está poniendo arriba del camión.
  const [tarimasMadera, setTarimasMadera] = useState(0)
  const [palletsMetal, setPalletsMetal] = useState(0)
  const [racks, setRacks] = useState<number[]>([])
  const envases: EnvasesCarga = { tarimasMadera, palletsMetal, racks }
  // Los puntales, aros y sombreros no se cuentan: salen implícitos de los
  // pallets y las tarimas (ver envasesDeRemito en utils/envases.ts).
  const envasesTexto = describirEnvases(envasesDeRemito({
    palletsCarga: tarimasMadera + palletsMetal,
    envases,
  }))
  const sinEnvases = tarimasMadera + palletsMetal === 0 && racks.length === 0

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

      <p className="text-base text-secundario tabular-nums">{totalBolsas} bolsas</p>

      {/* Envases que salen. Los declara muelle, que es quien los pone arriba del
          camión: caja no sabe con qué tipo de pallet va a salir la carga ni qué
          racks se van a usar. Van directo al remito. */}
      <div className="rounded-lg border border-[#E7E5DC] bg-[#FAF9F5] p-2.5 space-y-2">
        <p className="text-sm font-semibold text-gray-900">Envases que salen</p>
        <div className="grid grid-cols-2 gap-2">
          <ContadorEnvase etiqueta="Pallets de madera" valor={tarimasMadera} onChange={setTarimasMadera} disabled={entregando} btn={btn} />
          <ContadorEnvase etiqueta="Pallets de metal" valor={palletsMetal} onChange={setPalletsMetal} disabled={entregando} btn={btn} />
        </div>
        <div>
          <p className="text-sm text-secundario mb-1">Racks de agua (números)</p>
          <RacksInput value={racks} onChange={setRacks} disabled={entregando} />
        </div>
        {envasesTexto && <p className="text-sm text-secundario">{envasesTexto}</p>}
      </div>

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
        onClick={() => onEntregar(items, envases)}
        loading={entregando}
        disabled={bloqueado || items.length === 0 || sinEnvases}
        className="w-full h-14 text-base"
      >
        <FileText size={18} /> Confeccionar el remito
      </Button>
      <p className="text-sm text-secundario">
        {sinEnvases
          ? 'Contá los envases que van a salir antes de confeccionar el remito.'
          : 'Sale el número, el remito R y el COT de ahora. Después se carga el camión y se marca la entrega.'}
      </p>
    </div>
  )
}

/** Un contador de envases con ± grandes: se toca con guantes. */
function ContadorEnvase({ etiqueta, valor, onChange, disabled, btn }: {
  etiqueta: string
  valor:    number
  onChange: (v: number) => void
  disabled: boolean
  btn:      string
}) {
  const set = (v: number) => onChange(Math.max(0, Math.min(999, v)))
  return (
    <div>
      <p className="text-sm text-secundario mb-1">{etiqueta}</p>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label={`Menos ${etiqueta}`} className={btn} onClick={() => set(valor - 1)} disabled={disabled}>
          <Minus size={18} />
        </button>
        <input
          value={valor}
          onChange={(e) => set(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
          inputMode="numeric"
          disabled={disabled}
          aria-label={etiqueta}
          className="w-16 h-11 text-center text-lg font-semibold tabular-nums bg-white border border-[#D3D1C7] rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
        />
        <button type="button" aria-label={`Más ${etiqueta}`} className={btn} onClick={() => set(valor + 1)} disabled={disabled}>
          <Plus size={18} />
        </button>
      </div>
    </div>
  )
}
