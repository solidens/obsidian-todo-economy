/**
 * Экраны. Здесь только раскладка: ни одного обращения к DOM и ни одной
 * записи в состояние. На вход — состояние и ширина в символах, на выход —
 * массив строк из сегментов.
 */

import { award, price, streakMult } from '../core/economy';
import { checkBuy } from '../core/ledger';
import { mmss } from '../core/time';
import type { Store } from '../store';
import * as A from './ascii';
import { H, IN, S, type Line } from './ascii';

export type Tab = 'goals' | 'rewards' | 'chat';

export interface Pomodoro {
	taskId: string | null;
	left: number;
	running: boolean;
	/** true — идёт пятиминутный перерыв. */
	rest: boolean;
}

export interface Ctx {
	store: Store;
	cols: number;
	tab: Tab;
	pomo: Pomodoro;
	busy: boolean;
}

const COMPACT_AT = 46;
const TITLE = 'ТУДУ · ЭКОНОМИКА';

/* ── шапка ──────────────────────────────────────────────────────────────── */

function head(c: Ctx): Line[] {
	const tabs: Array<[Tab, string]> = [['goals', 'ЦЕЛИ'], ['rewards', 'НАГРАДЫ'], ['chat', 'ЧАТ']];
	const left: A.Seg[] = [];
	tabs.forEach(([id, label], i) => {
		if (i) left.push(S('  ', 'te-faint'));
		const on = c.tab === id;
		left.push(H(on ? `[ ${label} ]` : ` ${label} `, `tab:${id}`, on ? 'te-acc' : 'te-dim', `вкладка ${label}`));
	});
	const right: A.Seg[] = [
		S('⌁ ', 'te-faint'),
		S(String(c.store.state.balance), 'te-acc'),
		S(c.cols >= COMPACT_AT ? ' баллов' : '', 'te-dim'),
	];
	return [A.top(TITLE, c.cols), A.split(left, right, c.cols), A.sep(c.cols)];
}

/* ── цели ───────────────────────────────────────────────────────────────── */

function screenGoals(c: Ctx): Line[] {
	const { store, cols } = c;
	const s = store.state;
	const compact = cols < COMPACT_AT;
	const L: Line[] = head(c);

	if (store.missing) {
		L.push(A.row([S('Файла задач ещё нет.', 'te-dim')], cols));
		L.push(A.row([], cols));
		L.push(A.row([S('  '), H(`[ создать ${store.filePath} ]`, 'create', 'te-acc')], cols));
		L.push(A.bot(cols));
		return L;
	}

	const tasks = store.tasks;
	if (!tasks.length) {
		L.push(A.row([S('Пусто. Напиши задачу в чат — или галочкой в файле.', 'te-dim')], cols));
		L.push(A.row([], cols));
		L.push(A.row([S('  '), H('[ открыть файл ]', 'open', 'te-dim')], cols));
		L.push(A.bot(cols));
		return L;
	}

	const open = tasks.filter((t) => !t.done);
	const done = tasks.filter((t) => t.done);

	for (const t of [...open, ...done]) {
		// у закрытой показываем то, что реально начислено, а не пересчитанное
		const got = s.granted[t.id]?.amount ?? award(t);
		const base = Math.round(award(t) * streakMult(Math.max(1, s.streak.days)));
		const overdue = !t.done && t.due !== undefined && t.due < s.day.key;

		const left: A.Seg[] = [
			H(overdue ? '[!]' : t.done ? '[x]' : '[ ]', `toggle:${t.id}`,
				overdue ? 'te-bad' : t.done ? 'te-good' : '',
				`${t.done ? 'снять' : 'закрыть'} задачу «${t.title}»`),
			S(' '),
			S(t.title, t.done ? 'te-strike' : overdue ? 'te-warn' : ''),
		];
		const right: A.Seg[] = t.done
			? [S(`+${got}`, 'te-good'), S(' ✓', 'te-good')]
			: [S(`+${base}`, 'te-dim'), S('  ')];
		L.push(A.split(left, right, cols));

		if (t.done) continue;

		if (!compact) {
			const meta = `    ${t.min} мин · ${A.bar(t.diff, 2, 6)} · ${'▲'.repeat(Math.max(1, Math.round(t.prio)))}`;
			L.push(A.row([S(meta, 'te-faint'), S(t.due ? `  до ${t.due}` : '', overdue ? 'te-bad' : 'te-faint')], cols));
		}

		const focused = c.pomo.taskId === t.id;
		const act: A.Seg[] = [
			S('    '),
			H(focused && c.pomo.running ? '▸ пауза' : '▸ фокус', `focus:${t.id}`,
				focused ? 'te-acc' : 'te-dim', `помодоро для «${t.title}»`),
		];
		if (focused) {
			act.push(S(`  ${mmss(c.pomo.left)} `, c.pomo.rest ? 'te-good' : 'te-acc'));
			act.push(S(A.bar((c.pomo.rest ? 300 : 1500) - c.pomo.left, c.pomo.rest ? 300 : 1500, compact ? 6 : 12), 'te-faint'));
			act.push(S('  '), H('╳', `stop:${t.id}`, 'te-faint', 'сбросить помодоро'));
		}
		L.push(A.row(act, cols));
		L.push(A.row([], cols));
	}

	L.push(A.sep(cols));
	const cap = s.economy.dayCap;
	L.push(A.split(
		[S('сегодня  ', 'te-dim'), S(A.bar(s.day.earned, cap, compact ? 10 : 20), s.day.earned >= cap ? 'te-warn' : 'te-good')],
		[S(`${s.day.earned} / ${cap}`, 'te-dim')], cols));
	L.push(A.split(
		[S('серия    ', 'te-dim'), S(A.dots(s.streak.days, 7), 'te-good')],
		[S(`${s.streak.days} дн  ×${streakMult(s.streak.days).toFixed(2)}`, 'te-dim')], cols));
	L.push(A.bot(cols));
	return L;
}

/* ── награды ────────────────────────────────────────────────────────────── */

function screenRewards(c: Ctx): Line[] {
	const { store, cols } = c;
	const s = store.state;
	const L: Line[] = head(c);

	if (!s.rewards.length) {
		L.push(A.row([S('Наград пока нет. Расскажи о них в чате.', 'te-dim')], cols));
		L.push(A.bot(cols));
		return L;
	}

	const doneToday = store.doneToday();
	const sorted = s.rewards.slice().sort((a, b) => price(a, s.economy.k) - price(b, s.economy.k));

	for (const r of sorted) {
		const chk = checkBuy(s, r, doneToday);
		const tag = r.kind === 'harmful' ? ' ×3' : r.kind === 'restore' ? ' ×0.7' : '';
		const left: A.Seg[] = [
			S('▸ ', 'te-faint'),
			S(r.title),
			S(tag, r.kind === 'harmful' ? 'te-bad' : 'te-good'),
		];
		const right: A.Seg[] = chk.ok
			? [S(`${chk.price}  `, 'te-dim'), H('[ КУПИТЬ ]', `buy:${r.id}`, 'te-acc', `купить «${r.title}» за ${chk.price}`)]
			: [S(`${chk.price}  `, 'te-faint'), S('╳', 'te-faint')];
		L.push(A.split(left, right, cols));
		if (!chk.ok) L.push(A.row([S(`  └ ${chk.reason}`, 'te-faint')], cols));
	}

	L.push(A.sep(cols));
	L.push(A.split(
		[S(`k = ${s.economy.k.toFixed(1)}`, 'te-faint')],
		[S(`приход ≈ ${s.economy.monthlyIncome}/мес`, 'te-faint')], cols));
	L.push(A.bot(cols));
	return L;
}

/* ── чат ────────────────────────────────────────────────────────────────── */

const PREFIX = { user: '› ', assistant: '  ', system: '· ' } as const;
const CLS = { user: 'te-acc', assistant: '', system: 'te-faint' } as const;

function screenChat(c: Ctx): Line[] {
	const { store, cols } = c;
	const s = store.state;
	const L: Line[] = head(c);
	const inner = cols - 4;

	const shown = s.chat.slice(-24);
	if (!shown.length) L.push(A.row([S('Пусто.', 'te-faint')], cols));

	for (const m of shown) {
		const lines = A.wrap(m.text, inner - 2);
		lines.forEach((ln, i) => {
			L.push(A.row([S(i === 0 ? PREFIX[m.role] : '  ', CLS[m.role]), S(ln, CLS[m.role])], cols));
		});
		L.push(A.row([], cols));
	}

	if (c.busy) L.push(A.row([S('  думает…', 'te-faint')], cols));

	L.push(A.sep(cols));
	L.push(A.row([S('› ', 'te-acc'), IN(Math.max(6, inner - 2), 'compose', '', hint(store))], cols));
	L.push(A.bot(cols));
	return L;
}

function hint(store: Store): string {
	if (!store.state.onboarded) return 'ответь как есть';
	return 'завтра дожать отчёт, часа полтора';
}

/* ── подвал с моделью ───────────────────────────────────────────────────── */

export function render(c: Ctx): Line[] {
	const L =
		c.tab === 'goals' ? screenGoals(c) :
		c.tab === 'rewards' ? screenRewards(c) :
		screenChat(c);

	const model = c.store.state.lastModel;
	if (model) L.push([S(A.trunc(`  ${model}`, c.cols), 'te-faint')]);
	return L;
}
