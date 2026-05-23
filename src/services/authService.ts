import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  User,
} from 'firebase/auth'
import { auth } from './firebase'
import { createUserDocument } from './userService'
import { getEmailByCuit } from './cuitService'
import { notifyRegistro } from './notificationService'

interface RegisterParams {
  email:          string
  password:       string
  razonSocial:    string
  nombreContacto: string
  cuit:           string
  phone:          string
}

export const registerUser = async ({
  email,
  password,
  razonSocial,
  nombreContacto,
  cuit,
  phone,
}: RegisterParams): Promise<User> => {
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  await createUserDocument(credential.user.uid, { email, razonSocial, nombreContacto, cuit, phone })
  notifyRegistro(email, razonSocial || nombreContacto).catch(console.error)
  return credential.user
}

export const loginUser = async (email: string, password: string) => {
  await auth.authStateReady()
  return signInWithEmailAndPassword(auth, email, password)
}

export const loginWithCuit = async (cuit: string, password: string) => {
  const email = await getEmailByCuit(cuit)
  if (!email) throw new Error('cuit-not-found')
  await auth.authStateReady()
  return signInWithEmailAndPassword(auth, email, password)
}

export const loginChofer = async (username: string, pin: string) => {
  const { getEmailByUsername, padPin } = await import('./choferAuthService')
  const email = await getEmailByUsername(username)
  if (!email) throw new Error('username-not-found')
  await auth.authStateReady()
  return signInWithEmailAndPassword(auth, email, padPin(pin))
}

export const logoutUser = () => signOut(auth)

export const resetPassword = (email: string) =>
  sendPasswordResetEmail(auth, email)

export const resetPasswordByCuit = async (cuit: string): Promise<void> => {
  const email = await getEmailByCuit(cuit)
  if (!email) throw new Error('cuit-not-found')
  await sendPasswordResetEmail(auth, email)
}
