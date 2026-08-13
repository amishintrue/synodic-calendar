import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lunarcalendar.app',
  appName: 'Лунный календарь',
  webDir: 'out',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    SQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: false,
      androidBiometric: {
        biometricAuth: false,
        biometricTitle: 'Биометрическая аутентификация',
        biometricSubtitle: 'Войдите в приложение',
        biometricHint: 'Используйте отпечаток пальца или Face ID'
      },
      electronIsEncryption: false
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#488AFF',
      sound: 'beep.wav'
    },
    Preferences: {
      group: 'LunarCalendar'
    }
  }
};

export default config;
