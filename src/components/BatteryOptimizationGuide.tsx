'use client';

import type { BatteryOptimizationInfo } from '@/lib/local-notifications';

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
 */
export default function BatteryOptimizationGuide({
  batteryInfo,
  onDismiss,
  onClose,
}: BatteryOptimizationGuideProps) {
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
          фоновые напоминания. Чтобы они приходили, даже когда приложение
          закрыто, один раз настройте автозапуск и батарею вручную:
        </p>

        <div className="rounded-lg bg-black/30 p-3">
          <pre className="whitespace-pre-wrap text-xs text-amber-100/90">
            {batteryInfo.instructions}
          </pre>
          <p className="mt-3 text-[11px] text-amber-200/50">
            Путь в настройках: {batteryInfo.settingsPath.join(' → ')}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="https://dontkillmyapp.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-amber-600/20 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-600/30"
          >
            📱 Инструкции для других устройств
          </a>
        </div>

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
        <p className="mt-2 text-[11px] text-slate-500">
          Мы не можем проверить это автоматически (Android не даёт API для
          этой конкретной настройки прошивки) — «Готово» просто скроет
          напоминание, чтобы не мешало.
        </p>
      </div>
    </div>
  );
}
