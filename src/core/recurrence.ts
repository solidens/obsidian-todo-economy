/**
 * Повторяющиеся задачи. Чистые функции — проверяются без Obsidian.
 *
 * Закрытая повторяющаяся задача НЕ открывается сразу. Она остаётся закрытой
 * до конца суток и всплывает заново на смене дня: иначе галочка отскакивала бы
 * обратно в ту же секунду, и человек не видел бы, что сегодня уже сделал.
 *
 * Отсчёт идёт от дня выполнения, а не от прежнего срока. Для привычек это
 * единственный осмысленный вариант: пропустил три дня — следующая через день
 * после того, как вернулся, а не три просроченные разом.
 */

import { t as L } from './i18n';
import { addDays, daysBetween } from './time';
import type { Task } from './types';

export const MAX_REPEAT = 365;

/** Нормализовать интервал, пришедший от человека или от модели. */
export function saneRepeat(days: unknown): number | undefined {
	const n = typeof days === 'number' ? days : Number(days);
	if (!Number.isFinite(n)) return undefined;
	const r = Math.round(n);
	return r >= 1 && r <= MAX_REPEAT ? r : undefined;
}

/** Пора ли снова открыть закрытую повторяющуюся задачу. */
export function shouldReopen(t: Task, today: string): boolean {
	if (!t.done || !t.repeat || !t.doneOn) return false;
	return daysBetween(t.doneOn, today) >= t.repeat;
}

/** Следующий срок: день выполнения плюс интервал. */
export function nextDue(t: Task, doneOn: string): string {
	return addDays(doneOn, t.repeat ?? 1);
}

/**
 * Открыть заново всё, чему пришёл срок. Возвращает изменённые задачи —
 * вызывающий сам решает, как их записать.
 */
export function rollRecurring<T extends Task>(tasks: T[], today: string): T[] {
	const changed: T[] = [];
	for (const t of tasks) {
		if (!shouldReopen(t, today)) continue;
		const from = t.doneOn as string;
		t.done = false;
		t.due = nextDue(t, from);
		delete t.doneOn;
		changed.push(t);
	}
	return changed;
}

/** Ключи начислений, которые надо отпустить: занятие закрыто, эпизод прожит. */
export const grantKeysFor = (tasks: Task[]): string[] => tasks.map((t) => t.id);

/**
 * Регулярность, вычитанная из самой фразы. Нужна как страховка: бесплатные
 * модели сплошь и рядом теряют repeat, и «читать каждый день по 30 минут»
 * заводится разовой задачей, которая после первой галочки уже не вернётся.
 *
 * Порядок правил важен: «через день» проверяется раньше «день», иначе
 * ежедневное правило съест интервальную фразу.
 */
const REPEAT_RULES: Array<[RegExp, number]> = [
	[/через\s+день/, 2],
	[/каждые?\s+два\s+дня/, 2],
	[/каждые?\s+три\s+дня/, 3],
	[/через\s+два\s+дня/, 3],
	[/раз\s+в\s+две\s+недели/, 14],
	[/раз\s+в\s+недел[юия]/, 7],
	[/еженедельно/, 7],
	[/каждую\s+недел[юи]/, 7],
	[/раз\s+в\s+месяц/, 30],
	[/ежемесячно/, 30],
	[/ежедневно/, 1],
	[/каждый\s+день/, 1],
	[/каждый\s+раз/, 1],
	[/по\s+утрам/, 1],
	[/каждое\s+утро/, 1],
	[/каждый\s+вечер/, 1],
	[/по\s+вечерам/, 1],

	// Английские правила живут в том же списке, а не за переключателем языка:
	// они не пересекаются с русскими, а человек с английским интерфейсом всё
	// равно порой пишет задачи по-русски, и наоборот.
	[/every\s+other\s+day/, 2],
	[/every\s+second\s+day/, 2],
	[/(?:every\s+two|every\s+2)\s+weeks?/, 14],
	[/(?:bi-?weekly|fortnightly)/, 14],
	[/every\s+week/, 7],
	[/once\s+a\s+week/, 7],
	[/weekly/, 7],
	[/every\s+month/, 30],
	[/once\s+a\s+month/, 30],
	[/monthly/, 30],
	[/every\s+day/, 1],
	[/each\s+day/, 1],
	[/daily/, 1],
	[/every\s+morning/, 1],
	[/every\s+evening/, 1],
	[/every\s+night/, 1],
];

const NUMERIC_RULES: Array<[RegExp, (n: number) => number]> = [
	// \b о кириллицу не спотыкается только потому, что её здесь нет: границу
	// слова приходится изображать явным «дальше не буква».
	[/раз\s+в\s+(\d{1,3})\s*(?:дн(?:я|ей|ь)|д)(?![а-я])/, (n) => n],
	[/кажды[ех]\s+(\d{1,3})\s*(?:дн(?:я|ей|ь)|д)(?![а-я])/, (n) => n],
	[/раз\s+в\s+(\d{1,2})\s*недел/, (n) => n * 7],
	[/(\d{1,3})\s*раза?\s+в\s+недел/, (n) => Math.max(1, Math.round(7 / n))],
	[/every\s+(\d{1,3})\s*days?\b/, (n) => n],
	[/once\s+(?:in\s+)?(?:every\s+)?(\d{1,3})\s*days?\b/, (n) => n],
	[/every\s+(\d{1,2})\s*weeks?\b/, (n) => n * 7],
	[/(\d{1,3})\s*times?\s+a\s+week\b/, (n) => Math.max(1, Math.round(7 / n))],
];

export function detectRepeat(text: unknown): number | undefined {
	if (typeof text !== 'string') return undefined;
	const s = text.toLowerCase().replace(/ё/g, 'е');
	for (const [re, mul] of NUMERIC_RULES) {
		const m = re.exec(s);
		if (m) return saneRepeat(mul(Number(m[1])));
	}
	for (const [re, days] of REPEAT_RULES) {
		if (re.test(s)) return days;
	}
	return undefined;
}

export function describeRepeat(days: number | undefined): string {
	if (!days) return '';
	if (days === 1) return L().repEveryDay;
	if (days === 2) return L().repEveryOther;
	if (days === 7) return L().repWeekly;
	if (days === 14) return L().repBiweekly;
	if (days % 7 === 0) return L().repWeeks(days / 7);
	return L().repDays(days);
}

/** Короткая пометка для строки в панели. */
export function repeatBadge(days: number | undefined): string {
	if (!days) return '';
	if (days === 1) return L().badgeDaily;
	if (days % 7 === 0) return L().badgeWeeks(days / 7);
	return L().badgeDays(days);
}
