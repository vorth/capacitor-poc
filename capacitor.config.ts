import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.vorthmann.checkrspot',
  appName: 'CheckrSpot',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      // Hidden from src/main.ts once the saved readings have been drawn.
      launchAutoHide: false,
    },
  },
};

export default config;
