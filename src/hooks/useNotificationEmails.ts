import { useCallback, useEffect, useState } from 'react'
import {
  getNotificationEmails,
  addNotificationEmail,
  removeNotificationEmail,
} from '../services/configService'
import type { TipoAviso } from '@/utils/avisosMail'

/**
 * Lista de destinatarios de un aviso interno (`tipo`) o la general (sin
 * `tipo`). Un aviso sin lista propia usa la general: eso lo resuelve el
 * server (functions/src/email.ts → destinatariosAviso), acá se edita cada
 * lista tal cual está guardada.
 */
export function useNotificationEmails(tipo?: TipoAviso) {
  const [emails,  setEmails]  = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const data = await getNotificationEmails(tipo)
    setEmails(data)
    setLoading(false)
  }, [tipo])

  useEffect(() => { load() }, [load])

  const addEmail = async (email: string): Promise<void> => {
    if (!email?.trim()) return
    await addNotificationEmail(email.trim().toLowerCase(), tipo)
    await load()
  }

  const removeEmail = async (email: string): Promise<void> => {
    await removeNotificationEmail(email, tipo)
    await load()
  }

  return { emails, loading, addEmail, removeEmail, tipo }
}
