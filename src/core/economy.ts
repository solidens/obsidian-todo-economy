/**
 * Ядро экономики. Чистые функции, никаких побочных эффектов.
 *
 *   Начисление   P = clamp(мин, 10, 120) · clamp(сложность · приоритет, 0.6, 2.8)
 *   Цена         price = round5( k · ценность · вред )
 *   Замыкание    k = 0.85 · месячный_приход · 0.75 / Σ( частота · ценность · вред )
 *
 * Третья строка — суть. Единственный свободный коэффициент k подбирается так,
 * чтобы желаемое потребление наград ровно исчерпало бюджет. Поэтому вечер
 * сериала стоит примерно столько, сколько времени уйдёт, чтобы его заслужить.
 */

import type { EconomyConst, LedgerEntry, Profile, Reward, Task } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round5 = (v: number) => Math.round(v / 5) * 5;

/** Границы, за которые не пускаем ни человека, ни модель. */
export const LIMITS = {
	min: [5, 480] as const,
	diff: [0.5, 2.0] as const,
	prio: [0.5, 2.0] as const,
	value: [0.2, 5.0] as const,
	harm: [0.7, 3.0] as const,
	freq: [0.5, 60] as const,
};

const lim = (v: number, r: readonly [number, number]) =>
	Number.isFinite(v) ? clamp(v, r[0], r[1]) : r[0];

export const sane = {
	min: (v: number) => Math.round(lim(v, LIMITS.min)),
	diff: (v: number) => lim(v, LIMITS.diff),
	prio: (v: number) => lim(v, LIMITS.prio),
	value: (v: number) => lim(v, LIMITS.value),
	harm: (v: number) => lim(v, LIMITS.harm),
	freq: (v: number) => lim(v, LIMITS.freq),
};

/** Базовое начисление за задачу, без серии и потолка. */
export function award(t: Pick<Task, 'min' | 'diff' | 'prio'>): number {
	return Math.round(clamp(t.min, 10, 120) * clamp(t.diff * t.prio, 0.6, 2.8));
}

/** Множитель за серию: до ×1.3 на седьмой день подряд. */
export function streakMult(days: number): number {
	return clamp(1 + days * 0.043, 1, 1.3);
}

export function price(r: Pick<Reward, 'value' | 'harm'>, k: number): number {
	return Math.max(5, round5(k * r.value * r.harm));
}

/**
 * Замыкание бюджета. 0.85 — поправка на то, что часть задач не закроется;
 * 0.75 — доля прихода, которую вообще имеет смысл тратить на награды,
 * остальное копится и сгорает, иначе система вырождается в «купи всё сразу».
 */
export function solveK(monthlyIncome: number, rewards: Reward[]): number {
	const denom = rewards.reduce((s, r) => s + r.freq * r.value * r.harm, 0);
	if (denom <= 0 || monthlyIncome <= 0) return 0;
	return (0.85 * monthlyIncome * 0.75) / denom;
}

/** Месячный приход по описанию типичной недели. 52/12 недель в месяце. */
export function estimateMonthlyIncome(p: Profile): number {
	const weekly = p.routine.reduce((s, r) => s + award(r) * r.perWeek, 0);
	return Math.round(weekly * (52 / 12));
}

/** Потолок начислений за день — примерно полтора обычных дня. */
export function suggestDayCap(monthlyIncome: number, workdays: number): number {
	const perDay = monthlyIncome / Math.max(1, (workdays * 52) / 12);
	return Math.max(60, round5(perDay * 1.5));
}

/** Порог, выше которого излишек начинает сгорать: примерно месяц накоплений. */
export function suggestSoftCap(monthlyIncome: number): number {
	return Math.max(100, round5(monthlyIncome * 0.5));
}

/**
 * Сгорание излишка: 5 % от того, что выше порога, за каждый прошедший день.
 * Без него накопленный баланс однажды оплачивает неделю саморазрушения.
 */
export function decayAmount(balance: number, softCap: number, days: number): number {
	let b = balance;
	for (let i = 0; i < Math.min(days, 60); i++) {
		const excess = Math.max(0, b - softCap);
		if (excess < 1) break;
		b -= Math.round(excess * 0.05);
	}
	return Math.max(0, Math.round(balance - b));
}

/** Штраф за просроченную важную задачу. Мелкие просрочки не наказываются. */
export function penaltyFor(t: Task): number {
	if (t.prio < 1.2) return 0;
	return Math.round(clamp(award(t) * 0.15, 5, 40));
}

/* ── пересчёт, когда оценка кажется несправедливой ─────────────────────── */

/** Цена с учётом ручной поправки. Все места, где считается цена, идут сюда. */
export const effectiveK = (e: Pick<EconomyConst, 'k' | 'tune'>) => e.k * (e.tune || 1);

export const TUNE_LIMITS = [0.5, 2.0] as const;
/** Один шаг «дешевле» примерно на 15 %: заметно, но не рушит систему разом. */
const TUNE_STEP = 1.18;

export function tuneBy(current: number, direction: 'cheaper' | 'pricier'): number {
	const next = direction === 'cheaper' ? (current || 1) / TUNE_STEP : (current || 1) * TUNE_STEP;
	return Math.round(clamp(next, TUNE_LIMITS[0], TUNE_LIMITS[1]) * 100) / 100;
}

export interface IncomeFact {
	/** Месячный приход, посчитанный по фактическим начислениям. */
	monthly: number;
	/** За сколько дней есть данные. */
	spanDays: number;
	/** Сколько начислений попало в окно. */
	samples: number;
}

const MONTH_DAYS = 30.44;
/** Меньше недели данных — это не измерение, а совпадение. */
export const MIN_SPAN_DAYS = 7;

/**
 * Приход по факту, а не по оценке из онбординга. Это главный честный ответ
 * на «цены несправедливые»: чаще всего несправедлива не цена, а исходная
 * оценка того, сколько человек успевает за месяц. Учитываются начисления и
 * их откаты; траты, штрафы и сгорание — это уже расход, а не заработок.
 */
export function incomeFromHistory(
	history: LedgerEntry[],
	now: number = Date.now(),
	windowDays = 30,
): IncomeFact | null {
	const cutoff = now - windowDays * 864e5;
	const rows = history.filter((h) => h.at >= cutoff && (h.kind === 'earn' || h.kind === 'undo'));
	if (!rows.length) return null;

	const earliest = Math.min(...rows.map((h) => h.at));
	const spanDays = Math.max(1, (now - earliest) / 864e5);
	if (spanDays < MIN_SPAN_DAYS) return null;

	const total = rows.reduce((s, h) => s + h.amount, 0);
	if (total <= 0) return null;

	return {
		monthly: Math.round((total / spanDays) * MONTH_DAYS),
		spanDays: Math.round(spanDays),
		samples: rows.filter((h) => h.kind === 'earn').length,
	};
}

/** Награда просит недельный лимит, если она вредная. */
export function defaultWeeklyCap(kind: Reward['kind']): number | undefined {
	return kind === 'harmful' ? 2 : undefined;
}
