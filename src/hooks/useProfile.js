import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateUserDocument } from '../services/userService'

export function useProfile() {
  const { user, setUser } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const saveProfile = async (data) => {
    setSaving(true)
    setError('')
    try {
      await updateUserDocument(user.uid, data)
      // Actualiza el contexto local sin recargar
      setUser((prev) => ({ ...prev, ...data }))
    } catch {
      setError('Error al guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return { user, saving, error, saveProfile }
}
