import { useState, ChangeEvent, KeyboardEvent } from 'react'
import Button from '../ui/Button'
import { useNotificationEmails } from '../../hooks/useNotificationEmails'

type UseNotificationEmailsReturn = ReturnType<typeof useNotificationEmails>

interface NotificationEmailManagerProps {
  notifEmails: UseNotificationEmailsReturn
}

export function NotificationEmailManager({ notifEmails }: NotificationEmailManagerProps) {
  const { emails, addEmail, removeEmail } = notifEmails
  const [open,  setOpen]  = useState(false)
  const [email, setEmail] = useState('')

  const handleAdd = async () => {
    if (!email.trim()) return
    await addEmail(email)
    setEmail('')
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="text-sm"
      >
        Notificaciones ({emails.length}) ▾
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Emails de notificación"
          className="absolute right-0 top-10 bg-surface border border-border rounded-xl p-4 z-50 w-80 shadow-2xl"
        >
          <h3 className="font-semibold mb-1 text-sm">Emails de notificación</h3>
          <p className="text-muted text-xs mb-3">Reciben un email cuando llega un pedido nuevo.</p>

          {emails.length === 0 ? (
            <p className="text-muted text-xs mb-3">Sin emails configurados</p>
          ) : (
            <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
              {emails.map((e) => (
                <div key={e} className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-sm text-muted truncate flex-1">{e}</span>
                  <button
                    onClick={() => removeEmail(e)}
                    aria-label={`Quitar ${e}`}
                    className="text-red-400 text-xs hover:underline ml-2 shrink-0"
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
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleAdd() }}
              placeholder="admin@empresa.com"
              type="email"
              aria-label="Email a agregar"
              className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white flex-1 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button onClick={handleAdd} className="text-xs py-1.5 px-3">+ Agregar</Button>
          </div>
        </div>
      )}
    </div>
  )
}
