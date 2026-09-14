import type { FirebaseStorage } from 'firebase/storage'
import { app } from './firebase'

// Storage se inicializa recién cuando alguien lo pide (auditoría de bundle
// 2026-09-14): antes firebase.ts hacía getStorage(app) al arrancar y metía
// @firebase/storage (25 KB gz) en el chunk inicial de TODOS los logins, cuando
// solo lo usan la foto del catálogo, la foto del ticket de service y el archivo
// de facturas de Tango. El SDK entero entra por import() dinámico, así ni el
// `ref`/`uploadBytes` de los consumidores lo arrastran al arranque.

type SdkStorage = typeof import('firebase/storage')

let promesa: Promise<SdkStorage & { storage: FirebaseStorage }> | null = null

/**
 * Devuelve el SDK de Storage más la instancia ya inicializada (una sola vez
 * por pestaña). Misma condición de emulador que firebase.ts para Firestore y
 * Auth: `npm run dev` apunta al emulador local (puerto 9199) y el build de
 * producción elimina esa rama. En "Ver como" no hay nada especial: Storage no
 * tiene caché persistente por usuario, y las reglas ya rechazan la escritura.
 */
export function obtenerStorage(): Promise<SdkStorage & { storage: FirebaseStorage }> {
  if (!promesa) {
    promesa = import('firebase/storage').then((sdk) => {
      const storage = sdk.getStorage(app)
      if (import.meta.env.DEV) sdk.connectStorageEmulator(storage, 'localhost', 9199)
      return { ...sdk, storage }
    })
  }
  return promesa
}
