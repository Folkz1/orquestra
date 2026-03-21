import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.jarbas.orquestra',
  appName: 'Orquestra',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    allowNavigation: ['orquestra-backend.jz9bd8.easypanel.host'],
  },
}

export default config
