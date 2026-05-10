import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore'
import { db } from './firebase'
import { UserProfile, UserRole, UserStatus } from '../types'

const BOOTSTRAP_ROLES: Record<string, { rol: UserRole; estado: UserStatus }> = {
  'pontieroariel@gmail.com':        { rol: 'super_admin', estado: 'activo' },
  'lucasvazquez@redonhielo.com.ar': { rol: 'logistica',   estado: 'activo' },
}

interface CreateUserParams {
  email: string
  nombre: string
  phone: string
}

export const createUserDocument = async (
  uid: string,
  { email, nombre, phone }: CreateUserParams,
): Promise<void> => {
  const bootstrap = BOOTSTRAP_ROLES[email.toLowerCase()]
  await setDoc(doc(db, 'users', uid), {
    nombre,
    email,
    phone: phone || '',
    rol:    bootstrap?.rol    ?? 'cliente',
    estado: bootstrap?.estado ?? 'pendiente',
    address: '',
    fechaCreacion:   serverTimestamp(),
    fechaAprobacion: null,
    aprobadoPor:     null,
  })
}

export const getUserDocument = async (uid: string): Promise<UserProfile | null> => {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  const d = snap.data()
  // Compatibilidad con documentos creados antes de la migración a campos en español
  return {
    uid,
    email:           d.email           ?? '',
    nombre:          d.nombre          ?? d.name   ?? '',
    phone:           d.phone           ?? '',
    rol:             d.rol             ?? d.role   ?? 'cliente',
    estado:          d.estado          ?? 'activo',   // usuarios previos = activos
    address:         d.address         ?? '',
    fechaCreacion:   d.fechaCreacion   ?? d.createdAt ?? null,
    fechaAprobacion: d.fechaAprobacion ?? null,
    aprobadoPor:     d.aprobadoPor     ?? null,
  } as UserProfile
}

export const updateUserDocument = (
  uid: string,
  data: Partial<Omit<UserProfile, 'uid' | 'fechaCreacion'>>,
): Promise<void> => updateDoc(doc(db, 'users', uid), data)

export const getAllUsers = async (): Promise<UserProfile[]> => {
  const snap = await getDocs(
    query(collection(db, 'users'), orderBy('fechaCreacion', 'desc')),
  )
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserProfile))
}

export const updateUserRole = (uid: string, rol: UserRole): Promise<void> =>
  updateDoc(doc(db, 'users', uid), { rol })

export const updateUserStatus = (uid: string, estado: UserStatus): Promise<void> =>
  updateDoc(doc(db, 'users', uid), { estado })

export const approveUser = (uid: string, approvedByUid: string): Promise<void> =>
  updateDoc(doc(db, 'users', uid), {
    estado: 'activo' as UserStatus,
    fechaAprobacion: serverTimestamp(),
    aprobadoPor: approvedByUid,
  })
