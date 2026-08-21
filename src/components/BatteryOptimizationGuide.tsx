'use client';

import { useState } from 'react';
import {
  openAutostartScreen,
  openOemSettingsScreen,
  type BatteryOptimizationInfo,
} from '@/lib/local-notifications';

interface BatteryOptimizationGuideProps {
  batteryInfo: BatteryOptimizationInfo;
  /** Пользователь нажал «Готово, настроено» — прячем совсем (сохраняется в settings). */
  onDismiss: () => void;
  /** Пользователь просто закрыл модалку (крестик/фон) — покажем снова в другой раз. */
  onClose: () => void;
}

/**
 * Раньше это был баннер, который постоянно висел в календаре. Теперь —
 * модалка, открывается по клику на колокольчик в шапке (см. MoonCalendar),
 * когда checkNotificationHealth() решит, что нужна настройка батареи/автозапуска.
 *
 * Для известных производителей показывает кнопку-диплинк, открывающую нужный
 * экран настроек прошивки напрямую. Если Intent не сработал (прошивка изменила
 * путь), пользователь остаётся с текстовой инструкцией как fallback.
 */
export default function BatteryOptimizationGuide({
  batteryInfo,
  onDismiss,
  onClose,
}: BatteryOptimizationGuideProps) {
  const [batteryFailed, setBatteryFailed] = useState(false);

  const handleOpen = async (
    _intentSpec: string | undefined,
    onFail: () => void,
    action?: () => Promise<boolean>
  ) => {
    const ok = action ? await action() : false;
    if (!ok) onFail();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-amber-500/40 bg-slate-900 p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="text-base font-bold text-amber-200">
            ⚠️ Настройте фоновые уведомления
          </h3>
          <button onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800">
            ✕
          </button>
        </div>

        <p className="mb-3 text-sm text-amber-200/80">
          На устройствах {batteryInfo.manufacturer} система по умолчанию убивает
          фоновые напоминания. Настройте автозапуск и батарею:
        </p>

        <div className="rounded-lg bg-black/30 p-3">
          <pre className="whitespace-pre-wrap text-xs text-amber-100/90">
            {batteryInfo.instructions}
          </pre>
          <p className="mt-3 text-[11px] text-amber-200/50">
            Путь в настройках: {batteryInfo.settingsPath.join(' → ')}
          </p>
        </div>

        {/* Кнопка прямого перехода в настройки батареи — после инструкции */}
        {batteryInfo.batteryIntent && !batteryFailed && (
          <button
            onClick={() =>
              handleOpen(
                undefined,
                () => setBatteryFailed(true),
                () => openOemSettingsScreen(batteryInfo.batteryIntent)
              )
            }
            className="mt-3 w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500"
          >
            🔋 Открыть настройки батареи
          </button>
        )}

        {batteryFailed && (
          <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            Не удалось открыть экран настроек автоматически — воспользуйтесь
            инструкцией выше для вашей версии прошивки.
          </p>
        )}

        <p className="mt-3 text-[11px] text-slate-500">
          Мы не можем проверить настройку автоматически (Android не даёт API
          для этих переключателей прошивки) — «Готово» просто скроет
          напоминание, чтобы не мешало.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onDismiss}
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            ✅ Готово, настроил(а)
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Позже
          </button>
        </div>
      </div>
    </div>
  );
}
