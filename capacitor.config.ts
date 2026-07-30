import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'xylonic.beangreen247xyz.musicplayer',
  appName: 'Xylonic',
  webDir: 'dist',
  server: {
    // Use https scheme so the WebView can load both HTTPS and (with network config) HTTP servers
    androidScheme: 'https',
  },
  android: {
    // Allow audio to continue playing when the app moves to background
    allowMixedContent: true,
  },
  ios: {
    scheme: 'Xylonic',
    contentInset: 'always',
  },
  plugins: {
    // Capacitor Preferences - used by the color-config bridge
    Preferences: {
      group: 'xylonic',
    },
    // Route all fetch/XHR through native OkHttp (Android) / URLSession (iOS)
    // so the WebView's CORS policy never blocks requests to the Subsonic server.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
