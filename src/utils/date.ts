const MONTH_NAMES = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
];

const MONTH_EN = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function parseDate(iso: string): Date {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function formatTime(iso: string): string {
  const d = parseDate(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDateShort(iso: string): string {
  const d = parseDate(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function formatDateLong(iso: string): string {
  const d = parseDate(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${WEEKDAYS[d.getDay()]}`;
}

export function formatDayTitle(iso: string): string {
  const d = parseDate(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatMonthLabel(month: number): string {
  return MONTH_NAMES[month];
}

export function formatMonthEn(month: number): string {
  return MONTH_EN[month];
}

export function formatYearCN(year: number): string {
  return String(year)
    .split('')
    .map((c) => CN_DIGITS[Number(c)] ?? c)
    .join('');
}

export function monthKey(iso: string): string {
  const d = parseDate(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function yearOf(iso: string): number {
  return parseDate(iso).getFullYear();
}

/** Fuzzy text used by search, including useful date spellings. */
export function searchText(iso: string): string {
  const d = parseDate(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    y,
    `${y}年`,
    `${m}月`,
    `${m}月${day}日`,
    `${y}-${pad(m)}`,
    `${y}/${pad(m)}`,
    `${y}.${pad(m)}`,
    `${y}-${pad(m)}-${pad(day)}`,
    `${y}年${m}月${day}日`,
    MONTH_NAMES[d.getMonth()],
    MONTH_EN[d.getMonth()],
  ].join(' ');
}

export function toDateTimeLocalValue(iso: string): string {
  const d = parseDate(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export function isoFromDateTimeLocal(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
