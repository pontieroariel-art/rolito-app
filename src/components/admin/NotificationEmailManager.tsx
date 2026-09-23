import { useState, ChangeEvent, KeyboardEvent } from 'react'
import Button from '../ui/Button'
import { useNotificationEmails } from '../../hooks/useNotificationEmails'
import { reportError } from '@/services/observability'
import { AVISOS } from '@/utils/avisosMail'

type UseNotificationEmailsReturn = ReturnType<typeof useNotificationEmails>

/** Lista editable de mails (agregar / quitar) de UNA lista de avisos. */
export function ListaEmails({ lista, placeholder = 'nombre@empresa.com' }: { lista: UseNotificationEmailsReturn; placeholder?: string }) {
  const { emails, addEmail, removeEmail } = lista
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  // Agregar y quitar escriben config: si el servidor lo rechaza, la lista
  // siguió igual y hay que decirlo en vez de dejar el campo vaciado.
  const handleAdd = async () => {
    if (!email.trim()) return
    setError('')
    try {
      await addEmail(email)
      setEmail('')
    } catch (err) {
      reportError(err, { origen: 'NotificationEmailManager', accion: 'agregar mail' })
      setError('No se pudo guardar el mail. Revisá la conexión e intentá de nuevo.')
    }
  }
  const handleRemove = (e: string) => {
    setError('')
    void removeEmail(e).catch((err) => {
      reportError(err, { origen: 'NotificationEmailManager', accion: 'quitar mail' })
      setError('No se pudo quitar el mail. Revisá la conexión e intentá de nuevo.')
    })
  }

  return (
    <div>
      {emails.length === 0 ? (
        <p className="text-secundario text-xs mb-3">Sin emails configurados</p>
      ) : (
        <div className="space-y-1 mb-3">
          {emails.map((e) => (
            <div key={e} className="flex justify-between items-center py-1.5 border-b border-[#E7E5DC] last:border-0">
              <span className="text-sm text-secundario truncate flex-1" title={e}>{e}</span>
              <button
                onClick={() => handleRemove(e)}
                aria-label={`Quitar ${e}`}
                className="text-red-600 text-xs hover:underline ml-2 shrink-0"
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void handleAdd() }}
          placeholder={placeholder}
          type="email"
          aria-label="Email a agregar"
          className="bg-white border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <Button onClick={() => { void handleAdd() }} className="text-xs py-1.5 px-3">+ Agregar</Button>
      </div>
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
    </div>
  )
}

interface NotificationEmailManagerProps {
  /** Lista del aviso "Nuevo pedido" (`useNotificationEmails('nuevoPedido')`). */
  notifEmails: UseNotificationEmailsReturn
}

/** Botón con popover en Resumen de logística: quién recibe el aviso de pedido nuevo. */
export function NotificationEmailManager({ notifEmails }: NotificationEmailManagerProps) {
  const [open, setOpen] = useState(false)
  const aviso = AVISOS[notifEmails.tipo ?? 'nuevoPedido']

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="text-sm"
      >
        Avisos de pedidos ({notifEmails.emails.length}) ▾
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label={`Emails del aviso ${aviso.titulo}`}
          className="absolute right-0 top-10 bg-white border border-[#D3D1C7] rounded-xl p-4 z-50 w-80 shadow-2xl"
        >
          <h3 className="font-semibold mb-1 text-sm">{aviso.titulo}</h3>
          <p className="text-secundario text-xs mb-3">
            {aviso.descripcion} Sin lista propia, va a la general de Ajustes generales.
          </p>
          <ListaEmails lista={notifEmails} />
        </div>
      )}
    </div>
  )
}
