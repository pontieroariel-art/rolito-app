import { useEffect, useState } from 'react'
import {
  getNotificationEmails,
  addNotificationEmail,
  removeNotificationEmail,
} from '../services/configService'

export function useNotificationEmails() {
  const [emails,  setEmails]  = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const data = await getNotificationEmails()
    setEmails(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const addEmail = async (email: string): Promise<void> => {
    if (!email?.trim()) return
    await addNotificationEmail(email.trim().toLowerCase())
    await load()
  }

  const removeEmail = async (email: string): Promise<void> => {
    await removeNotificationEmail(email)
    await load()
  }

  return { emails, loading, addEmail, removeEmail }
}
