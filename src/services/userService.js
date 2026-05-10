import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

const ADMIN_EMAILS = ['lucasvazquez@redonhielo.com.ar']

export const createUserDocument = async (uid, { email, name, phone }) => {
  const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'cliente'
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

export const getUserDocument = async (uid) => {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? { uid, ...snap.data() } : null
}

export const updateUserDocument = async (uid, data) =>
  updateDoc(doc(db, 'users', uid), data)
