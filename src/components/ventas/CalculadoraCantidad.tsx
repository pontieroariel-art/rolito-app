import { useEffect, useState } from 'react'
import { Delete } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { CatalogProducto } from '../../types'

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

interface Props {
  open:           boolean
  onClose:        () => void
  /** Solo nombre y unidad: también sirve para un renglón de pedido que no está en el catálogo. */
  producto:       Pick<CatalogProducto, 'nombre' | 'unidad'>
  precioUnitario: number
  /** false: sin importes (venta en cuenta corriente del chofer). */
  mostrarPrecio?: boolean
  cantidadActual: number
  onConfirm:      (cantidad: number) => void
  /** Línea de ayuda arriba del número (ej. "Pedido: 100"). */
  ayuda?:         string
}

/** Teclado numérico para cargar la cantidad de un producto en la venta. Se abre
 *  al tocar la tarjeta en la botonera. Muestra precio unitario y total en vivo.
 *  Desde el 2026-09-26 también se abre al tocar la cantidad en Entregar pedido
 *  (pedido de los choferes: bajar de 100 a 50 eran 50 toques del −). */
export default function CalculadoraCantidad({
  open, onClose, producto, precioUnitario, cantidadActual, onConfirm, mostrarPrecio = true, ayuda,
}: Props) {
  const [buf, setBuf] = useState('')
  // La cantidad actual se muestra, pero el primer número tipeado la REEMPLAZA
  // (como un texto seleccionado): abrir en 100 y tocar 5, 0 deja 50, no 10050.
  // Borrar (⌫) en cambio corrige la cantidad actual cifra por cifra.
  const [reemplazar, setReemplazar] = useState(true)

  // Al abrir, arranca con la cantidad actual (para corregir) o vacío.
  useEffect(() => {
    if (open) { setBuf(cantidadActual ? String(cantidadActual) : ''); setReemplazar(true) }
  }, [open, cantidadActual])

  const n = parseInt(buf || '0', 10) || 0

  const push  = (d: string) => { setBuf((b) => ((reemplazar ? '' : b) + d).replace(/^0+/, '').slice(0, 5)); setReemplazar(false) }
  const back  = () => { setBuf((b) => b.slice(0, -1)); setReemplazar(false) }
  const clear = () => { setBuf(''); setReemplazar(false) }
  const listo = () => { onConfirm(n); onClose() }

  return (
    <Modal open={open} onClose={onClose} title={producto.nombre} variant="light">
      <div className="space-y-4">
        <p className={`text-sm text-secundario ${ayuda ? '' : '-mt-2'}`}>{ayuda &&<b className="text-base text-gray-900">{ayuda} · </b>}{mostrarPrecio ? `${money(precioUnitario)} / ${producto.unidad}` : `Cantidad en ${producto.unidad}`}</p>

        <div className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-xl px-4 py-3 text-right">
          <span className={`text-4xl font-black tabular-nums ${reemplazar && buf ? 'text-secundario' : 'text-gray-900'}`}>{buf || '0'}</span>
        </div>
        <div className="text-right text-sm font-bold text-accent tabular-nums min-h-[20px]">
          {n > 0 && (mostrarPrecio ? <>{n} × {money(precioUnitario)} = {money(n * precioUnitario)}</> : <>{n} {producto.unidad}</>)}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => (
            <button key={k} onClick={() => push(String(k))}
              className="h-14 rounded-xl border border-[#D3D1C7] bg-white text-2xl font-bold text-gray-900 active:scale-95 active:bg-[#F8F7F2] transition-transform">
              {k}
            </button>
          ))}
          <button onClick={clear}
            className="h-14 rounded-xl border border-[#D3D1C7] bg-white text-lg font-semibold text-secundario active:scale-95 transition-transform">
            C
          </button>
          <button onClick={() => push('0')}
            className="h-14 rounded-xl border border-[#D3D1C7] bg-white text-2xl font-bold text-gray-900 active:scale-95 active:bg-[#F8F7F2] transition-transform">
            0
          </button>
          <button onClick={back} aria-label="Borrar"
            className="h-14 rounded-xl border border-[#D3D1C7] bg-white text-secundario flex items-center justify-center active:scale-95 transition-transform">
            <Delete size={22} />
          </button>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={listo} className="flex-1">Listo</Button>
        </div>
      </div>
    </Modal>
  )
}
