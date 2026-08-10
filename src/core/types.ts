/**
 * Типы ядра. Ничего из Obsidian здесь не используется — этот слой
 * тестируется обычным `node --test` без запуска приложения.
 */

import type { LangPref } from './i18n';

export type RewardKind = 'normal' | 'restore' | 'harmful';

/** Задача. Живёт строкой в одном markdown-файле, см. tasks-file.ts. */
export interface Task {
	id: string;
	title: string;
	/** Оценка в минутах. */
	min: number;
	/** Сложность, 0.5…2.0. */
	diff: number;
	/** Приоритет, 0.5…2.0. */
	prio: number;
	done: boolean;
	/** Дата закрытия, YYYY-MM-DD. */
	doneOn?: string;
	/** Срок, YYYY-MM-DD. */
	due?: string;
	/**
	 * Повтор раз в N дней: 1 — ежедневная, 2 — через день, 7 — раз в неделю.
	 * Закрытая повторяющаяся задача остаётся закрытой до конца суток и
	 * открывается заново на смене дня — чтобы сегодняшнее «сделано» было видно.
	 */
	repeat?: number;
	/** Отступ строки в файле — чтобы сохранять вложенность списков. */
	indent: string;
	/** Токены, которых плагин не знает: переживают запись без потерь. */
	extra: string[];
	/** Номер строки в файле. Не сериализуется, живёт только в памяти. */
	line: number;
}

export interface Reward {
	id: string;
	title: string;
	/** Ценность для тебя, 0.2…5.0. */
	value: number;
	/** Множитель вреда: 0.7 восстановительное, 1.0 нейтральное, до 3.0 вредное. */
	harm: number;
	/** Желаемая частота в месяц — вход для замыкания бюджета. */
	freq: number;
	kind: RewardKind;
	/** Жёсткий лимит покупок в неделю. Обязателен для вредного. */
	weeklyCap?: number;
}

export interface EconomyConst {
	/** Единственный свободный коэффициент: решается из бюджета. */
	k: number;
	/** Оценка месячного прихода баллов, на которой решался k. */
	monthlyIncome: number;
	/** Потолок начислений за день. */
	dayCap: number;
	/** Порог, выше которого излишек начинает сгорать. */
	softCap: number;
	/**
	 * Ручная поправка к решённой цене, 0.5…2.0. Нужна, когда человек говорит
	 * «дорого» или «слишком легко», а истории ещё мало, чтобы пересчитать
	 * приход по факту. Хранится отдельно от k, чтобы всегда было видно,
	 * насколько далеко от решения систему увели руками.
	 */
	tune: number;
}

export type LedgerKind = 'earn' | 'undo' | 'spend' | 'penalty' | 'decay';

export interface LedgerEntry {
	at: number;
	kind: LedgerKind;
	amount: number;
	note: string;
}

export interface ChatMsg {
	role: 'user' | 'assistant' | 'system';
	text: string;
	at: number;
}

/** Что онбординг собрал про человека, прежде чем решить экономику. */
export interface Profile {
	/** Рабочих дней в неделю. */
	workdays: number;
	/** Типичные повторяющиеся дела: из них считается месячный приход. */
	routine: Array<{ title: string; min: number; diff: number; prio: number; perWeek: number }>;
}

/** Шаги чатового онбординга — того же, что был в вебе. */
export type OnboardStep = 'key' | 'workday' | 'routine' | 'rewards' | 'harmful' | 'confirm' | 'done';

export interface State {
	version: number;
	onboarded: boolean;
	onboardStep: OnboardStep;
	/** Путь к markdown-файлу с задачами. Один файл на всё. */
	tasksFile: string;
	economy: EconomyConst;
	rewards: Reward[];
	balance: number;
	/**
	 * Сколько реально начислено за каждую закрытую задачу — с учётом серии
	 * и дневного потолка, которые действовали в момент закрытия. Снятие
	 * галочки откатывает ровно эту сумму, а не пересчитанную заново.
	 */
	granted: Record<string, { amount: number; on: string }>;
	streak: { days: number; lastDone: string | null };
	day: { key: string; earned: number };
	week: { key: string; harm: Record<string, number> };
	/** День, за который уже посчитано сгорание излишка. */
	decayedOn: string | null;
	history: LedgerEntry[];
	chat: ChatMsg[];
	profile: Profile | null;
	/** Строгий режим: восстановительное тоже требует закрытой задачи. */
	strictRestore: boolean;
	lastModel: string | null;
	/** Пустая строка — брать моноширинный шрифт из настроек Obsidian. */
	panelFont: string;
	/** Псевдографика: авто выбирает по замерам шрифта. */
	glyphMode: 'auto' | 'unicode' | 'ascii';
	/** Язык интерфейса: авто следует за локалью Obsidian. */
	langPref: LangPref;
}

export const DEFAULT_STATE: State = {
	version: 1,
	onboarded: false,
	onboardStep: 'key',
	// пусто — имя берётся из локали при первом обращении
	tasksFile: '',
	economy: { k: 0, monthlyIncome: 0, dayCap: 200, softCap: 900, tune: 1 },
	rewards: [],
	balance: 0,
	granted: {},
	streak: { days: 0, lastDone: null },
	day: { key: '', earned: 0 },
	week: { key: '', harm: {} },
	decayedOn: null,
	history: [],
	chat: [],
	profile: null,
	strictRestore: false,
	lastModel: null,
	panelFont: '',
	glyphMode: 'auto',
	langPref: 'auto',
};
