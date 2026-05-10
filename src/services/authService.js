import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { auth } from './firebase'
import { createUserDocument } from './userService'

export const registerUser = async ({ email, password, name, phone }) => {
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  await createUserDocument(credential.user.uid, { email, name, phone })
  return credential.user
}

export const loginUser = (email, password) =>
  signInWithEmailAndPassword(auth, email, password)

export const logoutUser = () => signOut(auth)

export const resetPassword = (email) =>
  sendPasswordResetEmail(auth, email)
