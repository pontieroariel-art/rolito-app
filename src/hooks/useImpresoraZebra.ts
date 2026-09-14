import { useCallback, useEffect, useState } from 'react'
import {
  conectarImpresora, imprimirZpl, reconectarImpresoraGuardada, suscribirImpresora,
  type InfoImpresora,
} from '@/services/zebraBleService'
import { armarZplPrueba } from '@/utils/zplPallet'
import { reportError } from '@/services/observability'

// Estado de la Zebra por Bluetooth para la tablet de planta (2026-09-14).
// Al montar intenta volver a la impresora ya elegida sin abrir el selector;
// `conectar` abre el selector de Chrome (necesita un toque) y `probar`
// imprime la etiqueta de calibración.
export function useImpresoraZebra() {
  const [info, setInfo] = useState<InfoImpresora>({ estado: 'desconectada', nombre: null })
  const [error, setError] = useState('')

  useEffect(() => {
    const off = suscribirImpresora(setInfo)
    reconectarImpresoraGuardada().catch(() => {})
    return off
  }, [])

  const conectar = useCallback(async () => {
    setError('')
    try {
      await conectarImpresora()
    } catch (err) {
      // El operario cerró el selector sin elegir: no es un error.
      if (err instanceof DOMException && err.name === 'NotFoundError') return
      reportError(err, { origen: 'impresoraZebra.conectar' })
      setError('No se pudo conectar la impresora. Fijate que esté prendida y cerca de la tablet.')
    }
  }, [])

  const probar = useCallback(async () => {
    setError('')
    try {
      await imprimirZpl(armarZplPrueba())
    } catch (err) {
      reportError(err, { origen: 'impresoraZebra.probar' })
      setError('No salió la etiqueta de prueba. Volvé a conectar la impresora.')
    }
  }, [])

  return { ...info, error, conectar, probar }
}
