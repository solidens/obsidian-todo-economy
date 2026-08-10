/**
 * Пересчёт, когда оценка кажется несправедливой.
 *
 * «Несправедливо» бывает двух разных сортов, и лечатся они по-разному.
 *
 * 1. Несправедлива оценка ОДНОЙ задачи: отчёт вовсе не на полтора часа, а
 *    зарядка идёт тяжелее, чем записано. Это правка строки, экономику трогать
 *    незачем.
 *
 * 2. Несправедлива ВСЯ система: награды недостижимы или, наоборот, покупаются
 *    не глядя. Здесь важно не поддаться соблазну просто подкрутить цены —
 *    иначе рушится то, ради чего всё затевалось: цены решены, а не выдуманы.
 *
 *    Поэтому первый ответ на такую жалобу — пересчитать месячный приход по
 *    ФАКТИЧЕСКИМ начислениям и заново решить k. Обычно несправедлива не цена,
 *    а исходная оценка в онбординге: человек назвал идеальную неделю, а живёт
 *    обычную. Ручная поправка `tune` остаётся на случай, когда истории ещё
 *    мало, и хранится отдельно от k — чтобы всегда было видно, насколько
 *    далеко систему увели руками.
 */

import {
	effectiveK, incomeFromHistory, MIN_SPAN_DAYS, price, solveK,
	suggestDayCap, suggestSoftCap, tuneBy,
} from './economy';
import { t as L } from './i18n';
import type { State, Task } from './types';

export type Complaint = 'cheaper' | 'pricier' | 'solve';

export interface RebalanceResult {
	applied: boolean;
	/** Готовый текст для чата. */
	report: string;
}

const snapshot = (s: State) => ({
	k: effectiveK(s.economy),
	income: s.economy.monthlyIncome,
	tune: s.economy.tune || 1,
});

/** Три самые дешёвые награды с ценами — чтобы человек видел, что изменилось. */
function priceList(s: State): string {
	const k = effectiveK(s.economy);
	return s.rewards
		.slice()
		.sort((a, b) => price(a, k) - price(b, k))
		.slice(0, 4)
		.map((r) => `  ${price(r, k)}  ${r.title}`)
		.join('\n');
}

export function rebalance(s: State, want: Complaint, now: number = Date.now()): RebalanceResult {
	if (!s.rewards.length) {
		return { applied: false, report: L().rbNoRewards };
	}

	const before = snapshot(s);
	const fact = incomeFromHistory(s.history, now);

	if (want === 'solve') {
		if (!fact) {
			return {
				applied: false,
				report: L().rbThin(MIN_SPAN_DAYS),
			};
		}

		s.economy.monthlyIncome = fact.monthly;
		s.economy.k = solveK(fact.monthly, s.rewards);
		s.economy.tune = 1;
		s.economy.dayCap = suggestDayCap(fact.monthly, s.profile?.workdays ?? 5);
		s.economy.softCap = suggestSoftCap(fact.monthly);

		const diff = fact.monthly - before.income;
		const verdict =
			Math.abs(diff) < before.income * 0.1
				? L().rbClose
				: diff < 0
					? L().rbOver(Math.abs(diff))
					: L().rbUnder(diff);

		return {
			applied: true,
			report: L().rbSolved(
				fact.spanDays, fact.samples, before.income, fact.monthly, verdict,
				before.tune !== 1 ? L().rbTuneDropped : '', priceList(s)),
		};
	}

	const next = tuneBy(s.economy.tune || 1, want);
	if (next === before.tune) {
		return {
			applied: false,
			report: L().rbAtLimit(before.tune),
		};
	}
	s.economy.tune = next;

	const hint = fact
		? L().rbHint(fact.spanDays, fact.monthly, before.income)
		: '';

	return {
		applied: true,
		report: L().rbTuned(want, next, priceList(s), hint),
	};
}

/* ── поиск задачи по обрывку названия ──────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();

/**
 * Человек говорит «отчёт слишком дёшево», а не называет полное имя задачи.
 * Ищем от точного совпадения к нечёткому и сдаёмся, если кандидатов несколько:
 * молча поправить не ту задачу хуже, чем переспросить.
 */
export function findTask<T extends Task>(tasks: T[], query: string): T | null {
	const q = norm(query);
	if (!q) return null;

	const exact = tasks.filter((t) => norm(t.title) === q);
	if (exact.length === 1) return exact[0];

	const starts = tasks.filter((t) => norm(t.title).startsWith(q));
	if (starts.length === 1) return starts[0];

	const includes = tasks.filter((t) => norm(t.title).includes(q));
	if (includes.length === 1) return includes[0];

	const words = q.split(/\s+/).filter((w) => w.length > 2);
	if (!words.length) return null;
	const scored = tasks
		.map((t) => ({ t, hits: words.filter((w) => norm(t.title).includes(w)).length }))
		.filter((x) => x.hits > 0)
		.sort((a, b) => b.hits - a.hits);

	if (!scored.length) return null;
	if (scored.length > 1 && scored[0].hits === scored[1].hits) return null;
	return scored[0].t;
}
