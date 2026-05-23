import { useState, useCallback } from 'react'

const ICON       = '/icons/icon-192.png'
const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = window.atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !PUBLIC_KEY) return null
  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    if (existing) return existing
    return await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY) as unknown as BufferSource,
    })
  } catch {
    return null
  }
}

export function usePushNotification() {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  )

  const request = useCallback(async (onSubscribed?: (sub: PushSubscriptionJSON) => void) => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') {
      const sub = await subscribeToPush()
      if (sub) onSubscribed?.(sub.toJSON())
    }
  }, [])

  const notify = useCallback((title: string, body: string) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification(title, { body, icon: ICON, badge: ICON })
  }, [])

  return { permission, request, notify }
}
