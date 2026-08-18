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
    // captureInput: true НЕ включать! С ним CapacitorWebView.onCreateInputConnection()
    // возвращает голый BaseInputConnection(this, false) и НЕ вызывает
    // super.onCreateInputConnection(outAttrs), из-за чего EditorInfo.inputType
    // остаётся TYPE_NULL (0). Клавиатуры вроде «Gboard + Emoji & Font» видят
    // TYPE_NULL и считают поле «не текстовым» — кнопка смены языка (глобус)
    // перестаёт переключать раскладку. Обычный Gboard к этому терпим, поэтому
    // у него всё работает. При значении по умолчанию (false) WebView штатно
    // отдаёт TYPE_CLASS_TEXT и язык переключается.
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
