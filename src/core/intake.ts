/**
 * Превращение того, что прислала модель, в доменные объекты.
 * Всё зажимается в границы: бесплатные модели путают сложность с
 * длительностью и охотно выдают приоритет 10. Невалидное просто отбрасывается —
 * задачи и награды всегда можно завести формой.
 */

import { defaultWeeklyCap, sane } from './economy';
import { saneRepeat } from './recurrence';
import { newId } from './tasks-md';
import type { Profile, Reward, RewardKind } from './types';

const str = (v: unknown, max = 80): string =>
	typeof v === 'string' ? v.replace(/[`\n\r]/g, ' ').trim().slice(0, max) : '';

const numOf = (v: unknown, fallback: number): number => {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string') {
		const n = Number(v.replace(',', '.'));
		if (Number.isFinite(n)) return n;
	}
	return fallback;
};

const asArray = (v: unknown): unknown[] => {
	if (Array.isArray(v)) return v;
	if (v && typeof v === 'object') {
		for (const val of Object.values(v)) {
			if (Array.isArray(val)) return val;
		}
	}
	return [];
};

const rec = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export interface TaskDraft {
	title: string;
	min: number;
	diff: number;
	prio: number;
	due?: string;
	/** Повтор раз в N дней. */
	repeat?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toTask(raw: unknown): TaskDraft | null {
	const o = rec(raw);
	const title = str(o.title ?? o.name ?? o.task);
	if (!title) return null;
	const due = str(o.due ?? o.deadline, 10);
	return {
		title,
		min: sane.min(numOf(o.min ?? o.minutes ?? o.duration, 30)),
		diff: sane.diff(numOf(o.diff ?? o.difficulty, 1)),
		prio: sane.prio(numOf(o.prio ?? o.priority, 1)),
		due: DATE_RE.test(due) ? due : undefined,
		repeat: saneRepeat(o.repeat ?? o.repeatDays ?? o.every ?? o.everyDays),
	};
}

export function toRoutine(raw: unknown): Profile['routine'] {
	const out: Profile['routine'] = [];
	for (const item of asArray(raw)) {
		const t = toTask(item);
		if (!t) continue;
		const o = rec(item);
		const perWeek = Math.min(21, Math.max(0.25, numOf(o.perWeek ?? o.per_week ?? o.freq, 3)));
		out.push({ title: t.title, min: t.min, diff: t.diff, prio: t.prio, perWeek });
		if (out.length >= 20) break;
	}
	return out;
}

function kindOf(raw: Record<string, unknown>, fallback: RewardKind): RewardKind {
	const k = str(raw.kind ?? raw.type, 16).toLowerCase();
	if (k.startsWith('harm') || k.startsWith('вред')) return 'harmful';
	if (k.startsWith('restor') || k.startsWith('восст')) return 'restore';
	if (k.startsWith('norm') || k.startsWith('нейтр')) return 'normal';
	return fallback;
}

/** Вредное дороже через множитель до ×3, восстановительное наоборот со скидкой ×0.7. */
function harmOf(o: Record<string, unknown>, kind: RewardKind): number {
	if (kind === 'restore') return 0.7;
	if (kind === 'normal') return 1;
	return sane.harm(numOf(o.harm ?? o.harmful, 2));
}

export function toRewards(raw: unknown, fallbackKind: RewardKind, existing: Reward[] = []): Reward[] {
	const taken = new Set(existing.map((r) => r.title.toLowerCase()));
	const out: Reward[] = [];
	for (const item of asArray(raw)) {
		const o = rec(item);
		const title = str(o.title ?? o.name ?? o.reward);
		if (!title || taken.has(title.toLowerCase())) continue;
		taken.add(title.toLowerCase());
		const kind = kindOf(o, fallbackKind);
		const cap = o.weeklyCap ?? o.weekly_cap ?? o.limit;
		out.push({
			id: newId(),
			title,
			value: sane.value(numOf(o.value ?? o.worth, 1)),
			harm: harmOf(o, kind),
			freq: sane.freq(numOf(o.freq ?? o.perMonth ?? o.per_month, kind === 'harmful' ? 8 : 6)),
			kind,
			weeklyCap:
				cap === undefined || cap === null
					? defaultWeeklyCap(kind)
					: Math.max(1, Math.round(numOf(cap, 2))),
		});
		if (out.length >= 20) break;
	}
	return out;
}

export function toWorkdays(raw: unknown): number | null {
	const o = rec(raw);
	const n = numOf(o.workdays ?? o.days ?? raw, NaN);
	if (!Number.isFinite(n)) return null;
	return Math.min(7, Math.max(1, Math.round(n)));
}
