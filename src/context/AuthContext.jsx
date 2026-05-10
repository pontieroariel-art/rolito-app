import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../services/firebase'
import { getUserDocument } from '../services/userService'
import { getChoferes } from '../services/configService'

const AuthContext = createContext(null)

const ADMIN_EMAILS = ['lucasvazquez@redonhielo.com.ar']

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null)
        setLoading(false)
        return
      }
      try {
        // Resuelve perfil y lista de choferes en paralelo para evitar flash de rol
        const [profile, choferEmails] = await Promise.all([
          getUserDocument(firebaseUser.uid),
          getChoferes(),
        ])

        // Prioridad: admin hardcoded > chofer configurable > rol del doc de Firestore
        let role = profile?.role ?? 'cliente'
        if (ADMIN_EMAILS.includes(firebaseUser.email)) role = 'admin'
        else if (choferEmails.includes(firebaseUser.email)) role = 'chofer'

        setUser({ ...profile, role })
      } catch {
        setUser(null)
      } finally {
        setLoading(false)
      }
    })
    return unsub
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
