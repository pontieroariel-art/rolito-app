import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const apiKey            = import.meta.env.VITE_FIREBASE_API_KEY
const authDomain        = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
const projectId         = import.meta.env.VITE_FIREBASE_PROJECT_ID
const storageBucket     = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET
const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
const appId             = import.meta.env.VITE_FIREBASE_APP_ID

if (!apiKey || !authDomain || !projectId) {
  throw new Error(
    'Firebase: faltan variables de entorno. ' +
    'Verificá que .env.local tenga VITE_FIREBASE_API_KEY, ' +
    'VITE_FIREBASE_AUTH_DOMAIN y VITE_FIREBASE_PROJECT_ID.'
  )
}

const app = initializeApp({ apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId })

export const auth = getAuth(app)
export const db   = getFirestore(app)
