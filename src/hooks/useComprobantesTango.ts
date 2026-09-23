import { useCallback, useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { reportError } from '@/services/observability'

/**
 * El estado en Tango de un puñado de comprobantes puntuales (2026-09-20).
 *
 * Lo usan los bloques "anulados en la app que hay que anular en Tango" para
 * mostrar en cada fila qué dice Tango HOY. Se leen los docs por comprobante
 * (`tangoComprobanteDetalle/{empresa}_{tipo}_{numero}`) y NO el índice del
 * cliente: el recibo de FERRANTE estaba anulado hacía cuatro días pero Tango
 * lo tenía con el código de cliente `000000`, así que por la ficha del cliente
 * no aparecía nunca. El número es el mismo mire quien mire.
 *
 * Son diez filas, así que van con `getDoc` por clave (consulta puntual) y no
 * con suscripciones: el dato lo refresca el lector, no cambia mientras alguien
 * mira la pantalla. `recargar` es para después de pedirle al bridge que lea
 * Tango ahora mismo.
 */
export function useComprobantesTango(claves: string[]): {
  estados: Map<string, string>
  cargando: boolean
  recargar: () => void
} {
  const [estados, setEstados] = useState<Map<string, string>>(new Map())
  const [cargando, setCargando] = useState(false)
  const [tick, setTick] = useState(0)
  // Las claves se recalculan en cada render; lo que importa es el conjunto.
  const firma = [...new Set(claves)].sort().join('|')

  useEffect(() => {
    const lista = firma ? firma.split('|') : []
    if (lista.length === 0) { setEstados(new Map()); return }
    let vivo = true
    setCargando(true)
    // Cada getDoc atrapa su propio error abajo, así que el Promise.all no rechaza.
    void Promise.all(lista.map(async (clave) => {
      try {
        const snap = await getDoc(doc(db, 'tangoComprobanteDetalle', clave))
        return [clave, snap.exists() ? String(snap.data()?.estado ?? '') : ''] as const
      } catch (err) {
        reportError(err, { hook: 'useComprobantesTango', clave })
        return [clave, ''] as const
      }
    })).then((pares) => {
      if (!vivo) return
      setEstados(new Map(pares.filter(([, v]) => v !== '')))
      setCargando(false)
    })
    return () => { vivo = false }
  }, [firma, tick])

  const recargar = useCallback(() => setTick((t) => t + 1), [])
  return { estados, cargando, recargar }
}
