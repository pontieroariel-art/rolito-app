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
  where,
} from 'firebase/firestore'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { db, firebaseConfig } from './firebase'
import { UserProfile, UserRole, UserStatus } from '../types'

// Los roles de admin se asignan desde el panel /usuarios (por un super_admin existente).
// Para el primer bootstrap, editar el documento users/{uid} directamente en Firebase Console.

interface CreateUserParams {
  email:          string
  razonSocial:    string
  nombreContacto: string
  cuit:           string
  phone:          string
}

export const createUserDocument = async (
  uid: string,
  { email, razonSocial, nombreContacto, cuit, phone }: CreateUserParams,
): Promise<void> => {
  const { setCuitIndex } = await import('./cuitService')
  await setDoc(doc(db, 'users', uid), {
    nombre:         nombreContacto,
    email,
    phone:          phone || '',
    rol:            'cliente',
    estado:         'pendiente',
    address:        '',
    razonSocial:    razonSocial,
    nombreContacto: nombreContacto,
    cuit:           cuit || '',
    telefono:       phone || '',
    addresses:      [],
    fechaCreacion:   serverTimestamp(),
    fechaAprobacion: null,
    aprobadoPor:     null,
  })
  if (cuit) await setCuitIndex(cuit, email)
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
    razonSocial:     d.razonSocial     ?? '',
    nombreContacto:  d.nombreContacto  ?? d.nombre ?? d.name ?? '',
    telefono:        d.telefono        ?? d.phone  ?? '',
    phone:           d.phone           ?? '',
    cuit:            d.cuit            ?? '',
    addresses:       d.addresses       ?? [],
    rol:             d.rol             ?? d.role   ?? 'cliente',
    estado:          d.estado          ?? 'activo',
    address:         d.address         ?? '',
    lat:             d.lat             ?? null,
    lng:             d.lng             ?? null,
    fechaCreacion:   d.fechaCreacion   ?? d.createdAt ?? null,
    fechaAprobacion: d.fechaAprobacion ?? null,
    aprobadoPor:     d.aprobadoPor     ?? null,
    listaPreciosId:  d.listaPreciosId  ?? undefined,
    preciosCustom:   d.preciosCustom   ?? undefined,
    username:        d.username        ?? undefined,
    codigoCliente:   d.codigoCliente   ?? undefined,
  } as UserProfile
}

export const updateUserDocument = (
  uid: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>,
): Promise<void> => updateDoc(doc(db, 'users', uid), data)

export const savePushSubscription = (uid: string, subscription: PushSubscriptionJSON): Promise<void> =>
  updateDoc(doc(db, 'users', uid), { pushSubscription: subscription })

export const getPushSubscription = async (uid: string): Promise<PushSubscriptionJSON | null> => {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? (snap.data().pushSubscription ?? null) : null
}

export const getPushSubscriptionByEmail = async (email: string): Promise<PushSubscriptionJSON | null> => {
  const users = await getAllUsers()
  const user  = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!user) return null
  return getPushSubscription(user.uid)
}

export const getAllUsers = async (): Promise<UserProfile[]> => {
  const snap = await getDocs(
    query(collection(db, 'users'), orderBy('fechaCreacion', 'desc')),
  )
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserProfile))
}

export const getChoferes = async (): Promise<UserProfile[]> => {
  const snap = await getDocs(
    query(collection(db, 'users'), where('rol', '==', 'chofer'), where('estado', '==', 'activo')),
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

export interface CreateStaffParams {
  email:          string
  password:       string
  nombreContacto: string
  rol:            UserRole
}

export interface CreateClientParams {
  email:          string
  password:       string
  razonSocial:    string
  nombreContacto: string
  cuit:           string
  telefono:       string
  estadoInicial?: UserStatus
}

async function createUserViaSecondaryApp(
  email: string,
  password: string,
  firestoreData: Record<string, unknown>,
): Promise<string> {
  const tempApp  = initializeApp(firebaseConfig, `user-create-${Date.now()}`)
  const tempAuth = getAuth(tempApp)
  const tempDb   = getFirestore(tempApp)
  try {
    const credential = await createUserWithEmailAndPassword(tempAuth, email, password)
    await setDoc(doc(tempDb, 'users', credential.user.uid), firestoreData)
    return credential.user.uid
  } finally {
    await tempAuth.signOut()
    await deleteApp(tempApp)
  }
}

export const createStaffUser = async ({ email, password, nombreContacto, rol }: CreateStaffParams): Promise<void> => {
  await createUserViaSecondaryApp(email, password, {
    nombre:          nombreContacto,
    email,
    phone:           '',
    rol,
    estado:          'activo' as UserStatus,
    address:         '',
    razonSocial:     '',
    nombreContacto,
    cuit:            '',
    telefono:        '',
    addresses:       [],
    fechaCreacion:   serverTimestamp(),
    fechaAprobacion: serverTimestamp(),
    aprobadoPor:     'admin',
  })
}

export const createClientUser = async ({ email, password, razonSocial, nombreContacto, cuit, telefono, estadoInicial = 'pendiente' }: CreateClientParams): Promise<void> => {
  const { setCuitIndex } = await import('./cuitService')
  const aprobado = estadoInicial === 'activo'
  await createUserViaSecondaryApp(email, password, {
    nombre:          nombreContacto,
    email,
    phone:           telefono || '',
    rol:             'cliente' as UserRole,
    estado:          estadoInicial,
    address:         '',
    razonSocial,
    nombreContacto,
    cuit:            cuit || '',
    telefono:        telefono || '',
    addresses:       [],
    fechaCreacion:   serverTimestamp(),
    fechaAprobacion: aprobado ? serverTimestamp() : null,
    aprobadoPor:     aprobado ? 'admin' : null,
  })
  if (cuit) await setCuitIndex(cuit, email)
}

export interface CreateChoferParams {
  nombreContacto: string
  username:       string
  pin:            string
  telefono?:      string
}

export const createChoferUser = async ({ nombreContacto, username, pin, telefono }: CreateChoferParams): Promise<void> => {
  const { normalizeUsername, usernameToEmail, setChoferIndex, padPin } = await import('./choferAuthService')
  const key   = normalizeUsername(username)
  const email = usernameToEmail(username)
  await createUserViaSecondaryApp(email, padPin(pin), {
    nombre:          nombreContacto,
    email,
    phone:           telefono || '',
    rol:             'chofer' as UserRole,
    estado:          'activo' as UserStatus,
    address:         '',
    razonSocial:     '',
    nombreContacto,
    cuit:            '',
    telefono:        telefono || '',
    username:        key,
    addresses:       [],
    fechaCreacion:   serverTimestamp(),
    fechaAprobacion: serverTimestamp(),
    aprobadoPor:     'admin',
  })
  await setChoferIndex(key, email)
}

// Repara entradas faltantes en cuitIndex para todos los clientes activos
export const repairCuitIndex = async (): Promise<number> => {
  const { setCuitIndex, getEmailByCuit, normalizeCuit } = await import('./cuitService')
  const users = await getAllUsers()
  const clientes = users.filter((u) => u.rol === 'cliente' && u.cuit)
  let fixed = 0
  for (const u of clientes) {
    const key = normalizeCuit(u.cuit)
    if (key.length !== 11) continue
    const existing = await getEmailByCuit(u.cuit)
    if (!existing) {
      await setCuitIndex(u.cuit, u.email)
      fixed++
    }
  }
  return fixed
}
