import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateUserDocument } from '../services/userService'
import { UserProfile } from '../types'

type ProfileUpdate = Pick<UserProfile, 'nombre' | 'phone' | 'address' | 'lat' | 'lng'>

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
      // setUser recibe valor directo (no updater funcional)
      setUser({ ...user, ...data })
    } catch {
      setError('Error al guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return { user, saving, error, saveProfile }
}
