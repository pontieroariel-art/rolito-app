const STATUS_STYLES = {
  pendiente:  'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  confirmado: 'bg-accent/20 text-accent border-accent/30',
  en_camino:  'bg-purple-500/20 text-purple-400 border-purple-500/30',
  entregado:  'bg-success/20 text-success border-success/30',
  cancelado:  'bg-red-500/20 text-red-400 border-red-500/30',
}

const STATUS_LABELS = {
  pendiente:  'Pendiente',
  confirmado: 'Confirmado',
  en_camino:  'En camino',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
}

export default function Badge({ status }) {
  return (
    <span
      className={`text-xs px-2 py-1 rounded-full border font-medium whitespace-nowrap
        ${STATUS_STYLES[status] ?? 'bg-muted/20 text-muted border-muted/30'}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}
