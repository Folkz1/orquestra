import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { isNativeApp } from './native'

async function fallbackVibrate(pattern = 12) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern)
  }
}

export async function hapticTap() {
  if (!isNativeApp()) {
    await fallbackVibrate(10)
    return
  }

  try {
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    await fallbackVibrate(10)
  }
}

export async function hapticSuccess() {
  if (!isNativeApp()) {
    await fallbackVibrate([12, 20, 18])
    return
  }

  try {
    await Haptics.impact({ style: ImpactStyle.Medium })
  } catch {
    await fallbackVibrate([12, 20, 18])
  }
}
