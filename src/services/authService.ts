import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  User,
} from 'firebase/auth'
import { auth } from './firebase'
import { createUserDocument } from './userService'
import { notifyRegistro } from './notificationService'

interface RegisterParams {
  email: string
  password: string
  nombre: string
  phone: string
}

export const registerUser = async ({
  email,
  password,
  nombre,
  phone,
}: RegisterParams): Promise<User> => {
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  await createUserDocument(credential.user.uid, { email, nombre, phone })
  notifyRegistro(email, nombre).catch(console.error)
  return credential.user
}

export const loginUser = async (email: string, password: string) => {
  await auth.authStateReady()
  return signInWithEmailAndPassword(auth, email, password)
}

export const logoutUser = () => signOut(auth)

export const resetPassword = (email: string) =>
  sendPasswordResetEmail(auth, email)
