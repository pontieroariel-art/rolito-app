import { createContext, useContext, useEffect, useState, ReactNode, Dispatch, SetStateAction } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../services/firebase'
import { getUserDocument } from '../services/userService'
import { getChoferes } from '../services/configService'
import { UserProfile, UserRole } from '../types'

interface AuthContextValue {
  user: UserProfile | null
  loading: boolean
  setUser: Dispatch<SetStateAction<UserProfile | null>>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const ADMIN_EMAILS = ['lucasvazquez@redonhielo.com.ar']

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null)
        setLoading(false)
        return
      }
      try {
        const [profile, choferEmails] = await Promise.all([
          getUserDocument(firebaseUser.uid),
          getChoferes(),
        ])

        let role: UserRole = profile?.role ?? 'cliente'
        if (ADMIN_EMAILS.includes(firebaseUser.email ?? '')) role = 'admin'
        else if (choferEmails.includes(firebaseUser.email ?? '')) role = 'chofer'

        setUser(profile ? { ...profile, role } : null)
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

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
