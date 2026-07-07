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
  limit,
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
  // Spread incluye todos los campos de Firestore (subrol, esVisita, dni, etc.)
  // Los overrides aseguran compatibilidad con documentos viejos y valores por defecto
  return {
    ...d,
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
  } as UserProfile
}

export const updateUserDocument = (
  uid: string,
  data: Record<string, any>,
): Promise<void> => updateDoc(doc(db, 'users', uid), data)

import { deleteField, Timestamp } from 'firebase/firestore'

export const proposeCoord = (
  clientId: string,
  lat: number,
  lng: number,
  choferId: string,
  choferNombre: string,
): Promise<void> =>
  updateDoc(doc(db, 'users', clientId), {
    coordPendiente: { lat, lng, choferId, choferNombre, timestamp: Timestamp.now() },
  })

export const approveCoord = (clientId: string, lat: number, lng: number): Promise<void> =>
  updateDoc(doc(db, 'users', clientId), { lat, lng, coordPendiente: deleteField() })

export const rejectCoord = (clientId: string): Promise<void> =>
  updateDoc(doc(db, 'users', clientId), { coordPendiente: deleteField() })

export const savePushSubscription = (uid: string, subscription: PushSubscriptionJSON): Promise<void> =>
  updateDoc(doc(db, 'users', uid), { pushSubscription: subscription })

export const getPushSubscription = async (uid: string): Promise<PushSubscriptionJSON | null> => {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? (snap.data().pushSubscription ?? null) : null
}

export const getPushSubscriptionByEmail = async (email: string): Promise<PushSubscriptionJSON | null> => {
  // Query directo en vez de cargar todos los usuarios para encontrar uno por email
  const q    = query(collection(db, 'users'), where('email', '==', email.toLowerCase()), limit(1))
  const snap = await getDocs(q)
  if (snap.empty) return null
  return snap.docs[0].data().pushSubscription ?? null
}

let _usersCache: UserProfile[] | null = null
let _usersCacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

export const invalidateUsersCache = () => { _usersCache = null }

export const getAllUsers = async (force = false): Promise<UserProfile[]> => {
  if (!force && _usersCache && Date.now() - _usersCacheTime < CACHE_TTL) {
    return _usersCache
  }
  const snap = await getDocs(
    query(collection(db, 'users'), orderBy('fechaCreacion', 'desc'), limit(6000)),
  )
  _usersCache = snap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserProfile))
  _usersCacheTime = Date.now()
  return _usersCache
}

export const getStaffUsers = async (): Promise<UserProfile[]> => {
  const roles: UserRole[] = ['super_admin', 'gerente_comercial', 'comercial', 'logistica', 'facturacion', 'chofer']
  const snap = await getDocs(
    query(collection(db, 'users'), where('rol', 'in', roles)),
  )
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserProfile))
}

export const getClientesActivos = async (): Promise<UserProfile[]> => {
  const snap = await getDocs(
    query(collection(db, 'users'), where('rol', '==', 'cliente'), where('estado', '==', 'activo')),
  )
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserProfile))
}

// Todos los clientes sin filtrar por estado — mismo conjunto que UserManagement
export const getTodosLosClientes = async (): Promise<UserProfile[]> => {
  const snap = await getDocs(
    query(collection(db, 'users'), where('rol', '==', 'cliente')),
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
  dni:            string
  password:       string
  nombreContacto: string
  rol:            UserRole
}

export interface CreateClientParams {
  email:           string
  password:        string
  razonSocial:     string
  nombreContacto?: string
  cuit:            string
  telefono:        string
  estadoInicial?:  UserStatus
}

async function createUserViaSecondaryApp(
  email: string,
  password: string,
  firestoreData: Record<string, unknown>,
  // Para roles privilegiados (staff/chofer) el documento lo escribe el admin
  // desde su sesión primaria. Así las reglas de Firestore pueden prohibir que
  // un usuario se autoasigne un rol ≠ 'cliente' al crearse su propio doc.
  writeWithPrimaryDb = false,
): Promise<string> {
  const tempApp  = initializeApp(firebaseConfig, `user-create-${Date.now()}`)
  const tempAuth = getAuth(tempApp)
  const tempDb   = getFirestore(tempApp)
  try {
    const credential = await createUserWithEmailAndPassword(tempAuth, email, password)
    await setDoc(doc(writeWithPrimaryDb ? db : tempDb, 'users', credential.user.uid), firestoreData)
    return credential.user.uid
  } finally {
    await tempAuth.signOut()
    await deleteApp(tempApp)
  }
}

export const createStaffUser = async ({ dni, password, nombreContacto, rol }: CreateStaffParams): Promise<void> => {
  const { dniToStaffEmail, setStaffDniIndex } = await import('./staffAuthService')
  const normalizedDni = dni.replace(/\D/g, '')
  const email = dniToStaffEmail(normalizedDni)
  await createUserViaSecondaryApp(email, password, {
    nombre:          nombreContacto,
    email,
    dni:             normalizedDni,
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
  }, true)   // rol privilegiado → el doc lo escribe el super_admin
  await setStaffDniIndex(normalizedDni, email)
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

export interface CreateClienteImportadoParams {
  email:          string   // siempre cuit@rolito.app (Auth interno)
  password:       string
  razonSocial:    string
  cuit:           string
  telefono:       string
  notasContacto:  string
  emailContacto:  string   // email real del Excel, solo como dato de contacto
  codigoCliente:  string
  fechaAlta:      Date | null
  addresses:      import('../types').DeliveryAddress[]
}

export const createClienteImportado = async (params: CreateClienteImportadoParams): Promise<void> => {
  const { setCuitIndex } = await import('./cuitService')
  const { email, password, razonSocial, cuit, telefono, notasContacto, emailContacto, codigoCliente, fechaAlta, addresses } = params
  const firestoreData: Record<string, unknown> = {
    nombre:          razonSocial,
    email:           emailContacto || email,   // visible en admin: email real si existe
    emailAuth:       email,                    // email de Firebase Auth (interno)
    phone:           telefono,
    rol:             'cliente' as import('../types').UserRole,
    estado:          'activo' as import('../types').UserStatus,
    address:         addresses[0]?.address ?? '',
    razonSocial,
    nombreContacto:  razonSocial,
    cuit,
    telefono,
    notasContacto,
    codigoCliente,
    addresses,
    fechaCreacion:   serverTimestamp(),
    fechaAprobacion: serverTimestamp(),
    aprobadoPor:     'importacion',
  }
  if (fechaAlta) firestoreData.fechaAlta = fechaAlta
  await createUserViaSecondaryApp(email, password, firestoreData)
  if (cuit) await setCuitIndex(cuit, email)
}

export interface CreateChoferParams {
  nombreContacto: string
  cuit:           string
  pin:            string
  telefono?:      string
}

export const createChoferUser = async ({ nombreContacto, cuit, pin, telefono }: CreateChoferParams): Promise<void> => {
  const { setDniIndex, padPin, dniFromCuit } = await import('./choferAuthService')
  const normalizedCuit = cuit.replace(/\D/g, '')
  const email = `${normalizedCuit}@rolito.app`
  const dni   = dniFromCuit(normalizedCuit)
  await createUserViaSecondaryApp(email, padPin(pin), {
    nombre:          nombreContacto,
    email,
    phone:           telefono || '',
    rol:             'chofer' as UserRole,
    estado:          'activo' as UserStatus,
    address:         '',
    razonSocial:     '',
    nombreContacto,
    cuit:            normalizedCuit,
    dni,
    telefono:        telefono || '',
    addresses:       [],
    fechaCreacion:   serverTimestamp(),
    fechaAprobacion: serverTimestamp(),
    aprobadoPor:     'admin',
  }, true)   // rol 'chofer' → el doc lo escribe el operador
  await setDniIndex(normalizedCuit, email)
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
