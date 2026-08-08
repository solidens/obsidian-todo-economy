/**
 * Чистые операции над состоянием: начислить, откатить, купить, оштрафовать.
 * Мутируют переданный объект и ничего не сохраняют — сохранением занимается
 * store.ts. Так вся арифметика проверяется тестами без Obsidian.
 */

import { award, decayAmount, effectiveK, penaltyFor, price, streakMult } from './economy';
import { dayKey, daysBetween, weekKey } from './time';
import type { LedgerKind, Reward, State, Task } from './types';

const HISTORY_MAX = 200;

function log(s: State, kind: LedgerKind, amount: number, note: string): void {
	s.history.unshift({ at: Date.now(), kind, amount, note });
	if (s.history.length > HISTORY_MAX) s.history.length = HISTORY_MAX;
}

/**
 * Смена суток и недели: обнулить дневной счётчик, сжечь излишек за
 * пропущенные дни, оборвать серию, если день пропущен.
 * Вызывается перед любой операцией — она идемпотентна внутри одних суток.
 */
export function rollover(s: State, today: string = dayKey()): void {
	const week = weekKey();
	if (s.week.key !== week) s.week = { key: week, harm: {} };

	if (s.day.key !== today) {
		if (s.day.key) {
			const gap = daysBetween(s.decayedOn ?? s.day.key, today);
			if (gap > 0) {
				const burn = decayAmount(s.balance, s.economy.softCap, gap);
				if (burn > 0) {
					s.balance -= burn;
					log(s, 'decay', -burn, `сгорел излишек за ${gap} дн.`);
				}
			}
		}
		s.decayedOn = today;
		s.day = { key: today, earned: 0 };
	}

	if (s.streak.lastDone && daysBetween(s.streak.lastDone, today) > 1) {
		s.streak.days = 0;
	}
}

/**
 * Закрыть задачу. День засчитывается в серию до умножения — так первое
 * закрытое дело уже приносит бонус за то, что день не пропущен.
 * Возвращает фактически начисленное с учётом дневного потолка.
 */
export function earn(s: State, t: Task, today: string = dayKey()): number {
	rollover(s, today);

	if (s.streak.lastDone !== today) {
		const continued = s.streak.lastDone && daysBetween(s.streak.lastDone, today) === 1;
		s.streak.days = continued ? s.streak.days + 1 : 1;
		s.streak.lastDone = today;
	}

	const raw = Math.round(award(t) * streakMult(s.streak.days));
	const room = Math.max(0, s.economy.dayCap - s.day.earned);
	const amount = Math.min(raw, room);

	s.balance += amount;
	s.day.earned += amount;
	s.granted[t.id] = { amount, on: today };
	log(s, 'earn', amount, t.title + (amount < raw ? ' (упёрлось в дневной потолок)' : ''));
	return amount;
}

/**
 * Снять галочку. Откат ровно на ту сумму, что была начислена, — не на
 * пересчитанную заново: серия и потолок с тех пор могли измениться.
 */
export function undo(s: State, t: Task): number {
	const g = s.granted[t.id];
	if (!g) return 0;
	s.balance -= g.amount;
	if (g.on === s.day.key) s.day.earned = Math.max(0, s.day.earned - g.amount);
	delete s.granted[t.id];
	log(s, 'undo', -g.amount, t.title);
	return g.amount;
}

/** Штраф за просроченную важную задачу. Списывается один раз. */
export function penalize(s: State, t: Task, today: string = dayKey()): number {
	const key = `penalty:${t.id}:${t.due ?? ''}`;
	if (s.granted[key]) return 0;
	const p = penaltyFor(t);
	if (p <= 0) return 0;
	rollover(s, today);
	s.balance -= p;
	s.granted[key] = { amount: -p, on: today };
	log(s, 'penalty', -p, `просрочено: ${t.title}`);
	return p;
}

export interface BuyCheck {
	ok: boolean;
	price: number;
	reason?: string;
}

/**
 * Три условия покупки: закрыта хотя бы одна задача сегодня, хватает баллов,
 * не выбран недельный лимит. Восстановительное — сон, прогулка, отдых —
 * не блокируется первым условием: в плохой день человек не закрывает задачи
 * именно потому, что вымотан, и запрет отдохнуть в этот момент добивает.
 */
export function checkBuy(s: State, r: Reward, doneToday: boolean): BuyCheck {
	const p = price(r, effectiveK(s.economy));
	const needsWork = r.kind !== 'restore' || s.strictRestore;

	if (r.weeklyCap !== undefined && (s.week.harm[r.id] ?? 0) >= r.weeklyCap) {
		return { ok: false, price: p, reason: 'лимит недели выбран' };
	}
	if (s.balance < p) {
		return { ok: false, price: p, reason: `не хватает ${p - s.balance}` };
	}
	if (needsWork && !doneToday) {
		return { ok: false, price: p, reason: 'сначала закрой задачу' };
	}
	return { ok: true, price: p };
}

export function buy(s: State, r: Reward, today: string = dayKey()): number {
	rollover(s, today);
	const p = price(r, effectiveK(s.economy));
	s.balance -= p;
	if (r.weeklyCap !== undefined) s.week.harm[r.id] = (s.week.harm[r.id] ?? 0) + 1;
	log(s, 'spend', -p, r.title);
	return p;
}

/** Сколько начислено сегодня — для полоски прогресса. */
export const earnedToday = (s: State) => s.day.earned;

/** Убрать записи о задачах, которых больше нет в файле. */
export function pruneGranted(s: State, aliveIds: Set<string>): void {
	for (const key of Object.keys(s.granted)) {
		if (key.startsWith('penalty:')) continue;
		if (!aliveIds.has(key)) delete s.granted[key];
	}
}
