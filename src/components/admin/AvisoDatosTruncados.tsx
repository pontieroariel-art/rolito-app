import { AlertTriangle } from 'lucide-react'

// Aviso para los tableros que leen el stream de 30 días (useAllOrders) cuando
// alcanza su tope (MAX_ALL_ORDERS): hay pedidos que no se están contando, así
// que los totales de esa vista pueden quedar cortos. Evita el bug que marcó la
// auditoría (H5): mostrar números incompletos sin avisar. Los KPIs por rollup y
// los reportes por rango (getOrdersInRange) no truncan y no muestran esto.
export function AvisoDatosTruncados({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800 ${className}`}>
      <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-none" />
      <p>
        Hay más pedidos de los que entran en esta vista (últimos 30 días, tope alcanzado).
        Los totales de acá pueden quedar cortos — para números completos usá los reportes por rango.
      </p>
    </div>
  )
}
