"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export type NoteEditorHandle = {
  /** Сохраняет заметку, если есть несохранённые изменения. No-op, если dirty=false. */
  flush: () => Promise<void>;
};

export interface NoteEditorProps {
  dayISO: string;
  initialValue: string;
  onSave: (dayISO: string, comment: string) => Promise<void>;
}

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(
  function NoteEditor({ dayISO, initialValue, onSave }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const valueRef = useRef<string>(initialValue);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [length, setLength] = useState(initialValue.length);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      valueRef.current = e.target.value;
      setDirty(true);
      setLength(e.target.value.length);
    };

    const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      valueRef.current = e.currentTarget.value;
      setDirty(true);
      setLength(e.currentTarget.value.length);
    };

    const handleSave = async () => {
      if (!dirty || saving) return;

      const el = textareaRef.current;
      if (el) {
        // Форсируем коммит активной IME-композиции (кириллица на Android):
        // без снятия фокуса последнее недопечатанное слово может не попасть
        // в value вообще.
        if (document.activeElement === el) {
          el.blur();
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      // Читаем значение из DOM уже после коммита композиции — это надёжнее,
      // чем полагаться на valueRef, обновлённый через onChange.
      const finalValue = el?.value ?? valueRef.current;

      setSaving(true);
      try {
        await onSave(dayISO, finalValue);
        valueRef.current = finalValue;
        setDirty(false);
        setLength(finalValue.length);
      } catch (err) {
        console.error("Failed to save note:", err);
      } finally {
        setSaving(false);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Не перехватываем ввод во время активной IME-композиции (кириллица) —
      // иначе теряется последнее слово.
      if ((e.nativeEvent as any).isComposing || e.keyCode === 229) return;

      // Ctrl+Enter / Cmd+Enter — сохранить (десктоп). Обычный Enter —
      // это просто перенос строки, нативное поведение textarea.
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    };

    const handleBlur = () => {
      // Доп. страховка: если пользователь просто тапнул мимо поля,
      // несохранённое не потеряется.
      if (dirty) handleSave();
    };

    useImperativeHandle(ref, () => ({
      flush: async () => {
        if (dirty) await handleSave();
      },
    }));

    return (
      <div className="mb-4">
        <label className="mb-1 block text-xs font-bold uppercase text-slate-400">
          Заметка к этому дню (необязательно)
        </label>
        <textarea
          ref={textareaRef}
          defaultValue={initialValue}
          onChange={handleChange}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="Например: было облачно, плохая видимость…"
          rows={3}
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck={false}
          enterKeyHint="done"
          inputMode="text"
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            {saving ? "Сохранение…" : "💾 Сохранить заметку"}
          </button>
          <span
            className={`text-[11px] ${dirty ? "text-amber-400" : "text-slate-500"}`}
          >
            {saving ? "" : dirty ? `● не сохранено · ${length} симв.` : "✓ сохранено"}
          </span>
        </div>
      </div>
    );
  }
);

export default NoteEditor;
