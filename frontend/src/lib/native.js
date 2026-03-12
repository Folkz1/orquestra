import { Capacitor } from '@capacitor/core'

export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export function getNativePlatform() {
  try {
    return Capacitor.getPlatform()
  } catch {
    return 'web'
  }
}

export function isStandalonePWA() {
  if (typeof window === 'undefined') return false

  try {
    return (
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator?.standalone === true
    )
  } catch {
    return false
  }
}
