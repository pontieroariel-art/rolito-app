import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { UserProfile, UserRole } from '../types'

const ADMIN_EMAILS = ['lucasvazquez@redonhielo.com.ar']

interface CreateUserParams {
  email: string
  name: string
  phone: string
}

export const createUserDocument = async (
  uid: string,
  { email, name, phone }: CreateUserParams,
): Promise<UserRole> => {
  const role: UserRole = ADMIN_EMAILS.includes(email) ? 'admin' : 'cliente'
  await setDoc(doc(db, 'users', uid), {
    name,
    email,
    phone: phone || '',
    role,
    address: '',
    createdAt: serverTimestamp(),
  })
  return role
}

export const getUserDocument = async (uid: string): Promise<UserProfile | null> => {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  return { uid, ...snap.data() } as UserProfile
}

export const updateUserDocument = (
  uid: string,
  data: Partial<Omit<UserProfile, 'uid' | 'createdAt'>>,
): Promise<void> => updateDoc(doc(db, 'users', uid), data)
