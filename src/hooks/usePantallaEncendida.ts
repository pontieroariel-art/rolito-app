import { useEffect } from 'react'

type Sentinela = { release: () => Promise<void>; addEventListener: (t: 'release', cb: () => void) => void }
type NavegadorConWakeLock = Navigator & { wakeLock?: { request: (tipo: 'screen') => Promise<Sentinela> } }

/**
 * Mantiene la pantalla prendida mientras el componente está montado
 * (2026-09-25, tablet de producción: que se apague y haya que desbloquearla
 * con guantes es una traba). El navegador suelta el bloqueo cuando la
 * pestaña pasa a segundo plano, así que se pide de nuevo al volver.
 * Sin soporte (navegador viejo) no hace nada.
 */
export function usePantallaEncendida(activo = true): void {
  useEffect(() => {
    const nav = navigator as NavegadorConWakeLock
    if (!activo || !nav.wakeLock) return
    let sentinela: Sentinela | null = null
    let vivo = true

    const pedir = () => {
      if (!vivo || document.visibilityState !== 'visible' || sentinela) return
      nav.wakeLock!.request('screen')
        .then((s) => {
          if (!vivo) { void s.release(); return }
          sentinela = s
          s.addEventListener('release', () => { sentinela = null })
        })
        .catch(() => { /* sin permiso o batería baja: la pantalla se apaga como siempre */ })
    }

    pedir()
    document.addEventListener('visibilitychange', pedir)
    return () => {
      vivo = false
      document.removeEventListener('visibilitychange', pedir)
      if (sentinela) void sentinela.release()
    }
  }, [activo])
}
