import { useNotificationEmails } from '@/hooks/useNotificationEmails'
import { AVISOS, TIPOS_AVISO, type TipoAviso } from '@/utils/avisosMail'
import { ListaEmails } from './NotificationEmailManager'

// Quién recibe cada aviso interno por mail (2026-09-17). Una lista por tipo
// de aviso más la general, que es el respaldo de los tipos sin lista propia.
// Los mails al CLIENTE (pedido recibido, confirmado, en camino, comprobantes)
// no pasan por acá: van a la casilla de su ficha.

function BloqueAviso({ tipo }: { tipo: TipoAviso }) {
  const lista = useNotificationEmails(tipo)
  const info = AVISOS[tipo]
  return (
    <div className="rounded-xl border border-[#E7E5DC] p-4">
      <h3 className="text-sm font-semibold text-gray-900">{info.titulo}</h3>
      <p className="text-xs text-secundario mb-3">{info.descripcion}</p>
      <ListaEmails lista={lista} />
      {lista.emails.length === 0 && !lista.loading && (
        <p className="text-xs text-secundario mt-2">Sin lista propia: este aviso va a la lista general.</p>
      )}
    </div>
  )
}

export default function AvisosMailPanel() {
  const general = useNotificationEmails()
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Avisos por mail a la oficina</h2>
        <p className="text-sm text-secundario">
          A quién le llega cada aviso interno. Los mails al cliente (pedido recibido, confirmado, en camino y
          comprobantes) no se configuran acá: van a la casilla de su ficha.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {TIPOS_AVISO.map((t) => <BloqueAviso key={t} tipo={t} />)}
      </div>
      <div className="rounded-xl border border-[#E7E5DC] p-4">
        <h3 className="text-sm font-semibold text-gray-900">Lista general (respaldo)</h3>
        <p className="text-xs text-secundario mb-3">Recibe los avisos que no tienen lista propia.</p>
        <ListaEmails lista={general} />
      </div>
    </section>
  )
}
