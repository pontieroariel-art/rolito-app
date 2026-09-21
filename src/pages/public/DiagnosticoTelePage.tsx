import { useEffect, useState } from 'react'
import { getApps, initializeApp } from 'firebase/app'
import { doc, getDoc, initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore'
import { app, auth, db, ES_TELE } from '@/services/firebase'

/**
 * Diagnóstico para el televisor del muelle (2026-09-21). Pública y sin datos
 * sensibles: se abre desde el navegador de la tele (que no tiene consola) y
 * dice en letras grandes qué versión de la app corre, si la detectó como tele,
 * y si llega a la base de datos por el SDK (canal en vivo) y por HTTPS pelado.
 * Con eso se sabe si el problema es la versión guardada, el canal de Firestore
 * o la red de la tele, sin adivinar. El doc que lee es el índice del DNI de la
 * tele (lectura pública por regla, solo trae un mail interno).
 */
type Prueba = { nombre: string; estado: 'probando' | 'ok' | 'error'; detalle: string; ms?: number }

const DNI_TELE = '00000000'

export default function DiagnosticoTelePage() {
  const [pruebas, setPruebas] = useState<Prueba[]>([
    { nombre: 'SDK como está configurada la app', estado: 'probando', detalle: '' },
    { nombre: 'SDK variante B: long polling SIN fetch streams', estado: 'probando', detalle: '' },
    { nombre: 'SDK variante C: long polling CON fetch streams', estado: 'probando', detalle: '' },
    { nombre: 'SDK variante D: canal normal (WebChannel)', estado: 'probando', detalle: '' },
    { nombre: 'Base de datos por HTTPS directo (REST)', estado: 'probando', detalle: '' },
    { nombre: 'Login de Firebase (config del proyecto)', estado: 'probando', detalle: '' },
  ])
  const poner = (i: number, p: Partial<Prueba>) => setPruebas((prev) => prev.map((x, j) => (j === i ? { ...x, ...p } : x)))

  useEffect(() => {
    const conTope = <T,>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`sin respuesta en ${ms / 1000} s`)), ms))])
    const probarSdk = (i: number, base: Firestore) => {
      const t = Date.now()
      conTope(getDoc(doc(base, 'staffDniIndex', DNI_TELE)), 20000)
        .then((s) => poner(i, { estado: 'ok', detalle: s.exists() ? 'leyó el documento' : 'respondió (documento vacío)', ms: Date.now() - t }))
        .catch((e: unknown) => poner(i, { estado: 'error', detalle: describir(e), ms: Date.now() - t }))
    }

    // Cada variante en una app de Firebase aparte: la configuración de Firestore
    // se fija una sola vez por app. `useFetchStreams` no está en los tipos
    // públicos pero el SDK lo lee (Object.assign({useFetchStreams: true}, settings)).
    const variante = (nombre: string, ajustes: Record<string, unknown>): Firestore => {
      const existente = getApps().find((a) => a.name === nombre)
      const otra = existente ?? initializeApp(app.options, nombre)
      return initializeFirestore(otra, { localCache: memoryLocalCache(), ...ajustes })
    }
    probarSdk(0, db)
    try { probarSdk(1, variante('diag-b', { experimentalForceLongPolling: true, useFetchStreams: false })) } catch (e) { poner(1, { estado: 'error', detalle: describir(e) }) }
    try { probarSdk(2, variante('diag-c', { experimentalForceLongPolling: true, useFetchStreams: true })) } catch (e) { poner(2, { estado: 'error', detalle: describir(e) }) }
    try { probarSdk(3, variante('diag-d', { experimentalAutoDetectLongPolling: false, useFetchStreams: false })) } catch (e) { poner(3, { estado: 'error', detalle: describir(e) }) }

    const projectId = app.options.projectId
    const t1 = Date.now()
    conTope(fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/staffDniIndex/${DNI_TELE}`), 15000)
      .then(async (r) => poner(4, { estado: r.ok ? 'ok' : 'error', detalle: `HTTP ${r.status}${r.ok ? '' : ` · ${(await r.text()).slice(0, 160)}`}`, ms: Date.now() - t1 }))
      .catch((e: unknown) => poner(4, { estado: 'error', detalle: describir(e), ms: Date.now() - t1 }))

    const t2 = Date.now()
    conTope(fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${app.options.apiKey}`), 15000)
      .then((r) => poner(5, { estado: r.ok ? 'ok' : 'error', detalle: `HTTP ${r.status}`, ms: Date.now() - t2 }))
      .catch((e: unknown) => poner(5, { estado: 'error', detalle: describir(e), ms: Date.now() - t2 }))
  }, [])

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const color = (e: Prueba['estado']) => (e === 'ok' ? '#16a34a' : e === 'error' ? '#dc2626' : '#a16207')

  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', color: '#fff', padding: 40, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 28, lineHeight: 1.4 }}>
      <h1 style={{ fontSize: 44, margin: '0 0 24px', fontWeight: 800 }}>Diagnóstico de la tele</h1>
      <p style={{ margin: '0 0 8px' }}><b>Versión de la app:</b> {__APP_RELEASE__}</p>
      <p style={{ margin: '0 0 8px' }}><b>Modo tele:</b> {ES_TELE ? 'SÍ (canal lento y caché en memoria)' : 'NO (esta app no lo detectó como tele)'}</p>
      <p style={{ margin: '0 0 8px' }}><b>Sesión:</b> {auth.currentUser ? `entrada como ${auth.currentUser.email ?? auth.currentUser.uid}` : 'sin sesión'}</p>
      <p style={{ margin: '0 0 8px' }}><b>Hora de la tele:</b> {new Date().toLocaleString('es-AR')}</p>
      <p style={{ margin: '0 0 8px' }}><b>Conexión:</b> {typeof navigator !== 'undefined' && navigator.onLine ? 'con red' : 'SIN RED'}</p>
      <p style={{ margin: '0 0 28px', fontSize: 20, color: '#9ca3af', wordBreak: 'break-all' }}><b>Navegador:</b> {ua}</p>
      {pruebas.map((p) => (
        <div key={p.nombre} style={{ border: `4px solid ${color(p.estado)}`, borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>{p.nombre}</div>
          <div style={{ color: color(p.estado), fontWeight: 800, fontSize: 32 }}>
            {p.estado === 'probando' ? 'PROBANDO…' : p.estado === 'ok' ? 'OK' : 'ERROR'}{p.ms != null ? <span style={{ fontSize: 22, color: '#9ca3af', fontWeight: 500 }}> · {(p.ms / 1000).toFixed(1)} s</span> : null}
          </div>
          {p.detalle && <div style={{ fontSize: 22, color: '#d1d5db', wordBreak: 'break-word' }}>{p.detalle}</div>}
        </div>
      ))}
      <p style={{ fontSize: 20, color: '#9ca3af', marginTop: 24 }}>Sacale una foto a esta pantalla y mandala. Si "Versión de la app" no cambia después de borrar los datos del navegador, la tele sigue con la versión guardada.</p>
    </div>
  )
}

function describir(e: unknown): string {
  if (e && typeof e === 'object') {
    const x = e as { code?: string; message?: string; name?: string }
    return [x.code, x.name && x.name !== 'Error' ? x.name : null, x.message].filter(Boolean).join(' · ').slice(0, 300)
  }
  return String(e)
}
