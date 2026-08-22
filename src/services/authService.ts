import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  User,
} from 'firebase/auth'
import { deleteDoc, doc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { createUserDocument } from './userService'
import { getEmailByCuit } from './cuitService'

// El CUIT ya está tomado por otra cuenta — ya sea porque el chequeo previo lo
// detectó, o porque se destapó recién al intentar fijar el índice (carrera:
// dos registros con el mismo CUIT casi al mismo tiempo).
export class CuitTakenError extends Error {}

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
  // Chequeo previo para el caso común (dos registros normales con el mismo
  // CUIT, o un reintento tras un typo) — no elimina la carrera por completo,
  // pero la limpieza de abajo cubre el caso residual (dos registros casi
  // simultáneos) sin dejar una cuenta "zombie".
  if (cuit && await getEmailByCuit(cuit)) {
    throw new CuitTakenError('Ya existe una cuenta registrada con ese CUIT.')
  }

  const credential = await createUserWithEmailAndPassword(auth, email, password)
  try {
    await createUserDocument(credential.user.uid, { email, razonSocial, nombreContacto, cuit, phone })
  } catch (err) {
    // El índice de CUIT se lo ganó otra cuenta entre el chequeo de arriba y
    // este punto — deshacer el alta en vez de dejar una cuenta de Auth +
    // perfil "pendiente" huérfana que nunca va a poder loguearse por CUIT.
    await deleteDoc(doc(db, 'users', credential.user.uid)).catch(() => {})
    await credential.user.delete().catch(() => {})
    throw new CuitTakenError('Ya existe una cuenta registrada con ese CUIT.')
  }
  // El email de "registro pendiente" lo envía el trigger onUserRegistered.
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

export const loginChofer = async (dni: string, pin: string) => {
  const { getEmailByDni, padPin } = await import('./choferAuthService')
  const email = await getEmailByDni(dni)
  if (!email) throw new Error('dni-not-found')
  await auth.authStateReady()
  return signInWithEmailAndPassword(auth, email, padPin(pin))
}

export const loginTecnico = async (dni: string, pin: string) => {
  const { getEmailByTecnicoDni, padPinTecnico } = await import('./tecnicoAuthService')
  const email = await getEmailByTecnicoDni(dni)
  if (!email) throw new Error('dni-not-found')
  await auth.authStateReady()
  return signInWithEmailAndPassword(auth, email, padPinTecnico(pin))
}

export const loginProduccion = async (dni: string, pin: string) => {
  const { getEmailByProduccionDni, padPinProduccion } = await import('./produccionAuthService')
  const email = await getEmailByProduccionDni(dni)
  if (!email) throw new Error('dni-not-found')
  await auth.authStateReady()
  return signInWithEmailAndPassword(auth, email, padPinProduccion(pin))
}

export const loginWithStaffDni = async (dni: string, password: string) => {
  const { getEmailByStaffDni } = await import('./staffAuthService')
  // Fallback por email directo (para el admin)
  if (dni.includes('@')) {
    await auth.authStateReady()
    return signInWithEmailAndPassword(auth, dni, password)
  }
  const email = await getEmailByStaffDni(dni)
  if (!email) throw new Error('dni-not-found')
  await auth.authStateReady()
  return signInWithEmailAndPassword(auth, email, password)
}

export const logoutUser = () => signOut(auth)

export const resetPassword = (email: string) =>
  sendPasswordResetEmail(auth, email)

export const resetPasswordByCuit = async (cuit: string): Promise<void> => {
  const email = await getEmailByCuit(cuit)
  if (!email) throw new Error('cuit-not-found')
  await sendPasswordResetEmail(auth, email)
  // Limpiar la sesión anónima temporal — el usuario no va a hacer login ahora
  if (auth.currentUser?.isAnonymous) signOut(auth).catch(console.error)
}
