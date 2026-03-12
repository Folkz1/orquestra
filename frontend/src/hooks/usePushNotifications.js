import { useEffect, useState } from 'react'
import { createPushSubscription, deletePushSubscription } from '../api'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

export function usePushNotifications() {
  const [permission, setPermission] = useState(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
    return Notification.permission
  })

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.catch(() => {})
  }, [])

  async function requestPermission() {
    if (!('Notification' in window)) return 'unsupported'
    const nextPermission = await Notification.requestPermission()
    setPermission(nextPermission)

    if (
      nextPermission === 'granted' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      import.meta.env.VITE_VAPID_PUBLIC_KEY
    ) {
      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
        })
        const json = subscription.toJSON()
        await createPushSubscription({
          endpoint: subscription.endpoint,
          p256dh: json.keys?.p256dh || '',
          auth: json.keys?.auth || '',
          user_agent: navigator.userAgent,
        })
      } catch {}
    }

    return nextPermission
  }

  async function removeSubscription() {
    if (!('serviceWorker' in navigator)) return
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) return
      await deletePushSubscription(subscription.endpoint)
      await subscription.unsubscribe()
    } catch {}
  }

  async function notify({ title, body, data }) {
    if (permission !== 'granted') return
    if (!('serviceWorker' in navigator)) return

    try {
      const registration = await navigator.serviceWorker.ready
      if (registration.active) {
        registration.active.postMessage({
          type: 'SHOW_NOTIFICATION',
          title,
          body,
          data,
        })
      } else {
        await registration.showNotification(title, { body, data })
      }
    } catch {}
  }

  return {
    permission,
    requestPermission,
    removeSubscription,
    notify,
  }
}
