import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateUserDocument } from '../services/userService'
import { UserProfile } from '../types'

type ProfileUpdate = Pick<UserProfile, 'name' | 'phone' | 'address'>

export function useProfile() {
  const { user, setUser } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const saveProfile = async (data: ProfileUpdate): Promise<void> => {
    if (!user) return
    setSaving(true)
    setError('')
    try {
      await updateUserDocument(user.uid, data)
      setUser((prev) => (prev ? { ...prev, ...data } : prev))
    } catch {
      setError('Error al guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return { user, saving, error, saveProfile }
}
