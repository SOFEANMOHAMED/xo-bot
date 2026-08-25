/**
 * Schedule date + time picker: calendar-free counters, no typing.
 * Shared by merchant and official-page content publishing.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

export type SchedulePickerVariant = 'merchant' | 'admin';

type Theme = {
  panel: string;
  label: string;
  muted: string;
  text: string;
  chevron: string;
  value: string;
  neighbor: string;
  summary: string;
};

const THEMES: Record<SchedulePickerVariant, Theme> = {
  merchant: {
    panel:
      'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900',
    label: 'text-gray-500 dark:text-gray-400',
    muted: 'text-gray-400 dark:text-gray-500',
    text: 'text-gray-900 dark:text-white',
    chevron:
      'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent',
    value: 'text-gray-900 dark:text-white',
    neighbor: 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
    summary:
      'text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/70 border-gray-100 dark:border-gray-700',
  },
  admin: {
    panel: 'border-slate-700 bg-slate-900/70',
    label: 'text-slate-400',
    muted: 'text-slate-500',
    text: 'text-white',
    chevron:
      'text-slate-400 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent',
    value: 'text-white',
    neighbor: 'text-slate-500 hover:text-slate-300',
    summary: 'text-slate-300 bg-slate-950/60 border-slate-800',
  },
};

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

const MIN_LEAD_MS = 60_000;
const MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function defaultScheduleValue(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInputValue(d);
}

function parseLocalInputValue(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const fallback = new Date(Date.now() + 60 * 60 * 1000);
  fallback.setSeconds(0, 0);
  return fallback;
}

function minScheduleDate(): Date {
  const d = new Date(Date.now() + MIN_LEAD_MS);
  d.setSeconds(0, 0);
  return d;
}

function maxScheduleDate(): Date {
  return new Date(Date.now() + MAX_LEAD_MS);
}

function clampScheduleDate(date: Date): Date {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  const min = minScheduleDate();
  const max = maxScheduleDate();
  if (copy < min) return min;
  if (copy > max) return max;
  return copy;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

type DatePart = 'year' | 'month' | 'day' | 'hour' | 'minute';

function stepPart(current: Date, part: DatePart, delta: number): Date {
  const next = new Date(current);
  if (part === 'year') {
    next.setFullYear(next.getFullYear() + delta);
  } else if (part === 'month') {
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + delta);
    next.setDate(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())));
  } else if (part === 'day') {
    next.setDate(next.getDate() + delta);
  } else if (part === 'hour') {
    next.setHours(next.getHours() + delta);
  } else {
    next.setMinutes(next.getMinutes() + delta);
  }
  return clampScheduleDate(next);
}

function canStep(current: Date, part: DatePart, delta: number): boolean {
  const next = stepPart(current, part, delta);
  return next.getTime() !== current.getTime();
}

function neighborDate(current: Date, part: DatePart, delta: number): Date | null {
  if (!canStep(current, part, delta)) return null;
  return stepPart(current, part, delta);
}

function formatPart(date: Date, part: DatePart): string {
  if (part === 'year') return String(date.getFullYear());
  if (part === 'month') return MONTHS_AR[date.getMonth()];
  if (part === 'day') return String(date.getDate());
  if (part === 'hour') return pad2(date.getHours());
  return pad2(date.getMinutes());
}

function useHoldRepeat(onTick: () => void, enabled: boolean) {
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  const timerRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!enabled) return;
    tickRef.current();
    const loop = (delay: number) => {
      timerRef.current = window.setTimeout(() => {
        tickRef.current();
        loop(70);
      }, delay);
    };
    loop(380);
  }, [enabled]);

  useEffect(() => stop, [stop]);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
      start();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

function CounterColumn({
  theme,
  caption,
  part,
  current,
  wide,
  onStep,
}: {
  theme: Theme;
  caption: string;
  part: DatePart;
  current: Date;
  wide?: boolean;
  onStep: (part: DatePart, delta: number) => void;
}) {
  const upEnabled = canStep(current, part, 1);
  const downEnabled = canStep(current, part, -1);
  const upHold = useHoldRepeat(() => onStep(part, 1), upEnabled);
  const downHold = useHoldRepeat(() => onStep(part, -1), downEnabled);
  const prev = neighborDate(current, part, -1);
  const next = neighborDate(current, part, 1);

  return (
    <div className={`flex flex-col items-center ${wide ? 'min-w-[6.5rem]' : 'min-w-[3.75rem]'} flex-1`}>
      <span className={`text-[11px] font-medium mb-1.5 ${theme.label}`}>{caption}</span>
      <div className={`w-full rounded-xl border ${theme.panel} px-1 py-1.5 select-none`}>
        <button
          type="button"
          aria-label={`زيادة ${caption}`}
          disabled={!upEnabled}
          className={`w-full flex justify-center rounded-lg py-1 ${theme.chevron}`}
          {...upHold}
        >
          <ChevronUp size={18} />
        </button>
        <button
          type="button"
          disabled={!next}
          onClick={() => onStep(part, 1)}
          className={`w-full py-0.5 text-xs tabular-nums ${next ? theme.neighbor : 'invisible'}`}
        >
          {next ? formatPart(next, part) : '—'}
        </button>
        <div
          className={`w-full py-1.5 text-center text-lg font-bold tabular-nums leading-none ${theme.value}`}
          aria-live="polite"
        >
          {formatPart(current, part)}
        </div>
        <button
          type="button"
          disabled={!prev}
          onClick={() => onStep(part, -1)}
          className={`w-full py-0.5 text-xs tabular-nums ${prev ? theme.neighbor : 'invisible'}`}
        >
          {prev ? formatPart(prev, part) : '—'}
        </button>
        <button
          type="button"
          aria-label={`إنقاص ${caption}`}
          disabled={!downEnabled}
          className={`w-full flex justify-center rounded-lg py-1 ${theme.chevron}`}
          {...downHold}
        >
          <ChevronDown size={18} />
        </button>
      </div>
    </div>
  );
}

export function ScheduleDateTimePicker({
  value,
  onChange,
  variant = 'merchant',
}: {
  value: string;
  onChange: (next: string) => void;
  variant?: SchedulePickerVariant;
}) {
  const theme = THEMES[variant];
  const current = useMemo(() => clampScheduleDate(parseLocalInputValue(value)), [value]);

  const emit = useCallback(
    (date: Date) => {
      onChange(toLocalInputValue(clampScheduleDate(date)));
    },
    [onChange]
  );

  const onStep = useCallback(
    (part: DatePart, delta: number) => {
      emit(stepPart(current, part, delta));
    },
    [current, emit]
  );

  const summary = useMemo(
    () =>
      new Intl.DateTimeFormat('ar', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(current),
    [current]
  );

  const shiftMonth = (delta: number) => onStep('month', delta);

  return (
    <div dir="rtl" className="space-y-3 select-none touch-manipulation">
      <section className={`rounded-2xl border p-3 sm:p-4 ${theme.panel}`}>
        <div className="flex items-center justify-between mb-3">
          <p className={`text-xs font-semibold ${theme.label}`}>التاريخ</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="الشهر السابق"
              disabled={!canStep(current, 'month', -1)}
              onClick={() => shiftMonth(-1)}
              className={`p-1.5 rounded-lg ${theme.chevron}`}
            >
              <ChevronRight size={16} />
            </button>
            <span className={`text-sm font-semibold min-w-[7.5rem] text-center ${theme.text}`}>
              {MONTHS_AR[current.getMonth()]} {current.getFullYear()}
            </span>
            <button
              type="button"
              aria-label="الشهر التالي"
              disabled={!canStep(current, 'month', 1)}
              onClick={() => shiftMonth(1)}
              className={`p-1.5 rounded-lg ${theme.chevron}`}
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <CounterColumn theme={theme} caption="اليوم" part="day" current={current} onStep={onStep} />
          <CounterColumn theme={theme} caption="الشهر" part="month" current={current} onStep={onStep} wide />
          <CounterColumn theme={theme} caption="السنة" part="year" current={current} onStep={onStep} />
        </div>
      </section>

      <section className={`rounded-2xl border p-3 sm:p-4 ${theme.panel}`}>
        <p className={`text-xs font-semibold mb-3 ${theme.label}`}>الوقت</p>
        <div dir="ltr" className="flex gap-3 max-w-xs mx-auto">
          <CounterColumn theme={theme} caption="الساعة" part="hour" current={current} onStep={onStep} />
          <div className={`self-center pt-6 text-xl font-bold ${theme.muted}`} aria-hidden>
            :
          </div>
          <CounterColumn theme={theme} caption="الدقيقة" part="minute" current={current} onStep={onStep} />
        </div>
      </section>

      <p className={`text-center text-xs rounded-xl border px-3 py-2 ${theme.summary}`}>
        سيُنشر {summary}
      </p>
    </div>
  );
}
