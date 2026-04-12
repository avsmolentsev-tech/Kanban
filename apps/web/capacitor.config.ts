import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.myaipro.pis',
  appName: 'PIS',
  webDir: 'dist',
  server: {
    // Use the live server URL — app loads from your server
    url: 'https://kanban.myaipro.ru',
    cleartext: false,
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: 'PIS',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a',
    },
    App: {
      // Deep links
      url: 'https://kanban.myaipro.ru',
    },
  },
};

export default config;
