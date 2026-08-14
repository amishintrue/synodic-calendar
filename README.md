# ��� Лунный календарь (Synodic Calendar)

Офлайн-приложение для наблюдения за Луной, ведения дневника наблюдений, заметок и напоминаний. Полностью работает без интернета на Android.

---

## ��� Назначение

Приложение создано для астрономов-любителей и всех, кто следит за лунными фазами. Оно позволяет:

- **Отслеживать синодический месяц** — дни от новолуния к новолунию с точностью до дня
- **Вносить наблюдения** — отмечать дни, когда Луна была видна (даже в облачную погоду)
- **Писать заметки к любому дню** — погода, условия видимости, оборудование
- **Ставить напоминания** — разовые или еженедельные, с точным временем
- **Узнавать время восхода/заката** Солнца и Луны для выбранного дня и местоположения
- **Получать уведомления** даже когда приложение закрыто/уничтожено системой

---

## ��� Ключевые особенности

| Функция | Описание |
|---------|----------|
| **Полностью офлайн** | Никаких серверов, API, авторизаций. Вся данные в SQLite на устройстве |
| **Синодический календарь** | Автоматический расчёт дня синодического месяца на основе ваших наблюдений |
| **Нативные уведомления** | Capacitor Local Notifications + AlarmManager — работают без запущенного приложения, после перезагрузки телефона |
| **IME-безопасный ввод** | Никакой потери последнего слова при вводе кириллицы на Android-клавиатурах |
| **Свайп-навигация** | Листайте месяцы пальцем влево/вправо, а не только стрелками |
| **Геолокация для астрономии** | Точные времена восхода/заката Солнца и Луны по GPS (или Иерусалим по умолчанию) |
| **Руководство по батарее** | Встроенная инструкция как отключить оптимизацию батареи для Xiaomi/Samsung/Huawei/OPPO/Vivo/Stock Android |

---

## ��� Технологический стек

| Слой | Технология |
|------|------------|
| **Frontend** | Next.js 16 (React 19), TypeScript, Tailwind CSS 4 |
| **Mobile** | Capacitor 5 (Android) |
| **База данных** | @capacitor-community/sqlite (нативный SQLite) |
| **Уведомления** | @capacitor/local-notifications (AlarmManager, `allowWhileIdle`) |
| **Геолокация** | @capacitor/geolocation |
| **Астрономия** | suncalc (расчёт фаз, восходов, закатов) |
| **Сборка** | Gradle, JDK 21, Android SDK 36 |

---

## ��� Установка и запуск

### Требования
- Node.js 20+
- JDK 21
- Android SDK (cmdline-tools, platform-tools, platforms;android-36, build-tools;36.0.0)

### Разработка (веб)
```bash
npm install
npm run dev
# Откроется на http://localhost:3000
```

### Сборка Android APK
```bash
# 1. Сборка веб-части
npm run build

# 2. Синхронизация с Capacitor
npx cap sync android

# 3. Сборка APK (Windows/Git Bash)
export JAVA_HOME="C:\Program Files\Java\jdk-21.0.12"
export ANDROID_HOME="/c/Users/<USER>/Android/Sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
cd android
./gradlew assembleDebug

# APK появится в:
# android/app/build/outputs/apk/debug/app-debug.apk
```

---

## ��� Структура проекта

```
src/
├── app/
│   ├── layout.tsx       # PWA метаданные, Capacitor init
│   ├── page.tsx         # Точка входа
│   └── globals.css      # Tailwind + кастомные стили
├── components/
│   ├── MoonCalendar.tsx # Главный компонент (календарь, модалки, всё UI)
│   ├── NoteEditor.tsx   # IME-безопасный редактор заметок (uncontrolled)
│   └── BatteryOptimizationGuide.tsx # Экран настройки батареи
├── db/
│   ├── sqlite.ts        # DatabaseService — CRUD над SQLite
│   ├── sqlite-schema.ts # DDL схема таблиц
│   └── init.ts          # Инициализация БД при старте
├── lib/
│   ├── data-service.ts  # Единый API: SQLite (Android) / fetch (web)
│   ├── local-notifications.ts # Планирование уведомлений через ОС
│   ├── moon.ts          # Астрономия: фазы, синодические дни
│   ├── reminders.ts     # Логика напоминаний (due now, weekly)
│   └── sun-moon.ts      # Восход/закат Солнца и Луны (suncalc)
��── android/             # Capacitor Android проект
```

---

## ��� Схема базы данных (SQLite)

| Таблица | Назначение |
|---------|------------|
| `observations` | Даты наблюдений Луны (id, date, created_at) |
| `notes` | Заметки к дням (date PK, comment, updated_at) |
| `reminders` | Напоминания (id, title, kind[date/weekly], date, weekday, time, last_notified_date) |
| `settings` | Настройки (weekStart, appTimezone, lastMoonAlertDate) |
| `push_subscriptions` | Совместимость с веб-пушем (не используется в Android) |

---

## ��� Как работают уведомления

1. **При создании/редактировании напоминания** — вызывается `scheduleReminderNotification()`:
   - `kind='date'` → `schedule.at` (точный UTC-момент)
   - `kind='weekly'` → `schedule.at` на **ближайшее** срабатывание; после срабатывания перепланируется на следующую неделю
   - `allowWhileIdle: true` — пробуждает устройство в Doze mode

2. **При старте приложения** — `rescheduleAllReminders()` перестраивает все будильники из БД (страховка после обновления/перезагрузки)

3. **После перезагрузки телефона** — плагин сам получает `BOOT_COMPLETED` и восстанавливает будильники

4. **Android 12+** — требуется разрешение `SCHEDULE_EXACT_ALARM` (проверяется при старте, открывается системный экран если выключено)

---

## ��� Восход/закат Солнца и Луны

- Используется библиотека **suncalc**
- Геолокация запрашивается через `@capacitor/geolocation` (один раз при старте)
- Если геолокация недоступна — используются координаты **Иерусалима** (широта 31.7683, долгота 35.2137)
- Расчёт делается для **полудня выбранного дня** в часовом поясе приложения (`Asia/Yekaterinburg`)
- Показывается в модалке дня в секции "Восход и закат"

---

## ������ Решение проблем с IME (Android-клавиатура)

**Проблема:** На Android при вводе кириллицы (Gboard, SwiftKey) активная *композиция* (IME) сбрасывается при каждом `value={state}` рендере — теряется последнее слово.

**Решения в проекте:**
1. **Поле "Новое напоминание"** — `defaultValue` вместо `value` + ручная очистка через `ref.current.value = ""`
2. **NoteEditor.tsx** — полностью uncontrolled (`defaultValue`), сохранение по `Ctrl+Enter` / потерю фокуса / кнопке; `forceRerender` только для счётчика символов
3. **Все однострочные input** — проверка `e.nativeEvent.isComposing || e.keyCode === 229` перед `preventDefault()`, действие откладывается через `requestAnimationFrame`

---

## ��� Оптимизация батареи (важно для уведомлений)

Android агрессивно убивает фоновые процессы. Приложение включает:
- `FOREGROUND_SERVICE` в манифесте
- `WAKE_LOCK`, `VIBRATE` пермишены
- Экран **BatteryOptimizationGuide** с инструкциями для:
  - Xiaomi / MIUI / HyperOS
  - Samsung (One UI)
  - Huawei / Honor (EMUI)
  - OPPO / Realme / OnePlus (ColorOS)
  - Vivo (Funtouch OS)
  - Stock Android (Pixel, Nokia, Motorola)

---

## ��� Скриншоты

*(добавьте сюда скриншоты при желании)*

---

## ��� Лицензия

MIT — свободное использование, модификация, распространение.

---

## ��� Участие в разработке

1. Форкните репозиторий
2. Создайте ветку: `git checkout -b feature/amazing-feature`
3. Закоммитьте: `git commit -m 'Add amazing feature'`
4. Запушьте: `git push origin feature/amazing-feature`
5. Откройте Pull Request

---

## ��� Контакты / Issues

- Баг-репорты и идеи: [GitHub Issues](https://github.com/amishintrue/synodic-calendar/issues)
- Репозиторий: https://github.com/amishintrue/synodic-calendar

---

> **Совет:** После установки APK обязательно зайдите в настройки батареи телефона и добавьте приложение в исключения (см. экран "Настройка батареи" в меню приложения). Без этого уведомления могут не приходить, когда телефон спит.