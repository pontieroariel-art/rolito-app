import { useCallback, useEffect, useState } from 'react'

/**
 * MODO PRIVACIDAD (2026-09-13): esconde los importes de las pantallas de
 * CONSULTA del supervisor cuando hay terceros mirando el teléfono en el
 * mostrador. Tocar un importe tapado lo revela unos segundos.
 *
 * Lo que NO tapa, a propósito: la pantalla de cobro. Ahí el supervisor tiene que
 * ver lo que imputa y lo que recibe; esconder números mientras se mueve plata es
 * pedir un error.
 *
 * Es una preferencia del DISPOSITIVO, no del usuario (como `sidebarColapsado`
 * del escritorio): vive en localStorage y no viaja a Firestore. Se comparte
 * entre pantallas con un evento propio, porque `storage` solo avisa a las otras
 * pestañas, no a la que escribió.
 */

const CLAVE = 'supervisorPrivacidad'
const EVENTO = 'privacidad-cambiada'

const leer = (): boolean => {
  try { return localStorage.getItem(CLAVE) === '1' } catch { return false }
}

export function usePrivacidad() {
  const [privado, setPrivado] = useState(leer)

  useEffect(() => {
    const sincronizar = () => setPrivado(leer())
    window.addEventListener(EVENTO, sincronizar)
    window.addEventListener('storage', sincronizar)
    return () => {
      window.removeEventListener(EVENTO, sincronizar)
      window.removeEventListener('storage', sincronizar)
    }
  }, [])

  const alternar = useCallback(() => {
    const nuevo = !leer()
    try { localStorage.setItem(CLAVE, nuevo ? '1' : '0') } catch { /* modo privado del navegador: vale para esta pantalla igual */ }
    setPrivado(nuevo)
    window.dispatchEvent(new Event(EVENTO))
  }, [])

  return { privado, alternar }
}
