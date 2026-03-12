import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.jarbas.orquestra',
  appName: 'Orquestra',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
}

export default config
