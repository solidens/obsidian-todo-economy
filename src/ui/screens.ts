/**
 * Экраны. Здесь только раскладка: ни одного обращения к DOM и ни одной
 * записи в состояние. На вход — состояние, метрики шрифта и набор
 * псевдографики; на выход — массив строк из сегментов.
 */

import { award, effectiveK, price, streakMult } from '../core/economy';
import { checkBuy } from '../core/ledger';
import { nextDue, repeatBadge } from '../core/recurrence';
import { mmss } from '../core/time';
import type { Store } from '../store';
import * as A from './ascii';
import { GAP, H, IN, S, type Glyphs, type Line, type Seg } from './ascii';

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
	/** Ячеек по ширине — для полосок и порога компактности. */
	cols: number;
	/** Букв прозы по ширине — для переноса текста в чате. */
	textCols: number;
	g: Glyphs;
	tab: Tab;
	pomo: Pomodoro;
	busy: boolean;
}

const COMPACT_AT = 46;
const TITLE = 'ТУДУ · ЭКОНОМИКА';

/* ── шапка ──────────────────────────────────────────────────────────────── */

function head(c: Ctx): Line[] {
	const tabs: Array<[Tab, string]> = [['goals', 'ЦЕЛИ'], ['rewards', 'НАГРАДЫ'], ['chat', 'ЧАТ']];
	const left: Seg[] = [];
	tabs.forEach(([id, label], i) => {
		if (i) left.push(S('  ', 'te-faint'));
		const on = c.tab === id;
		left.push(H(on ? `[ ${label} ]` : ` ${label} `, `tab:${id}`, on ? 'te-acc' : 'te-dim', `вкладка ${label}`));
	});
	const right: Seg[] = [
		S(`${c.g.bolt} `, 'te-faint'),
		S(String(c.store.state.balance), 'te-acc'),
		S(c.cols >= COMPACT_AT ? ' баллов' : '', 'te-dim'),
	];
	return [A.top(TITLE, c.g), A.split(left, right, c.g), A.sep(c.g)];
}

/* ── цели ───────────────────────────────────────────────────────────────── */

function screenGoals(c: Ctx): Line[] {
	const { store, cols, g } = c;
	const s = store.state;
	const compact = cols < COMPACT_AT;
	const L: Line[] = head(c);

	if (store.missing) {
		L.push(A.row([S('Файла задач ещё нет.', 'te-dim')], g));
		L.push(A.row([], g));
		L.push(A.row([S('  '), H(`[ создать ${store.filePath} ]`, 'create', 'te-acc')], g));
		L.push(A.bot(g));
		return L;
	}

	if (!store.tasks.length) {
		L.push(A.row([S('Пусто. Напиши задачу в чат — или галочкой в файле.', 'te-dim')], g));
		L.push(A.row([], g));
		L.push(A.row([S('  '), H('[ открыть файл ]', 'open', 'te-dim')], g));
		L.push(A.bot(g));
		return L;
	}

	const open = store.tasks.filter((t) => !t.done);
	const done = store.tasks.filter((t) => t.done);

	for (const t of [...open, ...done]) {
		// у закрытой показываем начисленное, а не пересчитанное заново
		const got = s.granted[t.id]?.amount ?? award(t);
		const base = Math.round(award(t) * streakMult(Math.max(1, s.streak.days)));
		const overdue = !t.done && t.due !== undefined && t.due < s.day.key;

		const left: Seg[] = [
			H(overdue ? '[!]' : t.done ? '[x]' : '[ ]', `toggle:${t.id}`,
				overdue ? 'te-bad' : t.done ? 'te-good' : '',
				`${t.done ? 'снять' : 'закрыть'} задачу «${t.title}»`),
			S(' '),
			S(t.title, t.done ? 'te-strike' : overdue ? 'te-warn' : ''),
		];
		const right: Seg[] = t.done
			? [S(`+${got}`, 'te-good'), S(` ${g.check}`, 'te-good')]
			: [S(`+${base}`, 'te-dim'), S('  ')];
		L.push(A.split(left, right, g));

		if (t.done) {
			// повторяющаяся остаётся закрытой до конца суток — видно, что сделал
			if (t.repeat && t.doneOn) {
				L.push(A.row([S(`    вернётся ${nextDue(t, t.doneOn)}`, 'te-faint')], g));
			}
			continue;
		}

		if (!compact) {
			const meta = `    ${t.min} мин · ${A.bar(t.diff, 2, 6, g)} · ${g.warn.repeat(Math.max(1, Math.round(t.prio)))}`;
			L.push(A.row([
				S(meta, 'te-faint'),
				S(t.repeat ? `  ${repeatBadge(t.repeat)}` : '', 'te-dim'),
				S(t.due && !t.repeat ? `  до ${t.due}` : '', overdue ? 'te-bad' : 'te-faint'),
			], g));
		}

		const focused = c.pomo.taskId === t.id;
		const act: Seg[] = [
			S('    '),
			H(focused && c.pomo.running ? `${g.arrow} пауза` : `${g.arrow} фокус`, `focus:${t.id}`,
				focused ? 'te-acc' : 'te-dim', `помодоро для «${t.title}»`),
		];
		if (focused) {
			const total = c.pomo.rest ? 300 : 1500;
			act.push(S(`  ${mmss(c.pomo.left)} `, c.pomo.rest ? 'te-good' : 'te-acc'));
			act.push(S(A.bar(total - c.pomo.left, total, compact ? 6 : 12, g), 'te-faint'));
			act.push(S('  '), H(g.cross, `stop:${t.id}`, 'te-faint', 'сбросить помодоро'));
		}
		L.push(A.row(act, g));
		L.push(A.row([], g));
	}

	L.push(A.sep(g));
	const cap = s.economy.dayCap;
	L.push(A.split(
		[S('сегодня  ', 'te-dim'), S(A.bar(s.day.earned, cap, compact ? 10 : 20, g), s.day.earned >= cap ? 'te-warn' : 'te-good')],
		[S(`${s.day.earned} / ${cap}`, 'te-dim')], g));
	L.push(A.split(
		[S('серия    ', 'te-dim'), S(A.dots(s.streak.days, 7, g), 'te-good')],
		[S(`${s.streak.days} дн  ×${streakMult(s.streak.days).toFixed(2)}`, 'te-dim')], g));
	L.push(A.bot(g));
	return L;
}

/* ── награды ────────────────────────────────────────────────────────────── */

function screenRewards(c: Ctx): Line[] {
	const { store, g } = c;
	const s = store.state;
	const L: Line[] = head(c);

	if (!s.rewards.length) {
		L.push(A.row([S('Наград пока нет. Расскажи о них в чате.', 'te-dim')], g));
		L.push(A.bot(g));
		return L;
	}

	const doneToday = store.doneToday();
	const sorted = s.rewards.slice().sort((a, b) => price(a, effectiveK(s.economy)) - price(b, effectiveK(s.economy)));

	for (const r of sorted) {
		const chk = checkBuy(s, r, doneToday);
		const tag = r.kind === 'harmful' ? ' ×3' : r.kind === 'restore' ? ' ×0.7' : '';
		const left: Seg[] = [
			S(`${g.arrow} `, 'te-faint'),
			S(r.title),
			S(tag, r.kind === 'harmful' ? 'te-bad' : 'te-good'),
		];
		const right: Seg[] = chk.ok
			? [S(`${chk.price}  `, 'te-dim'), H('[ КУПИТЬ ]', `buy:${r.id}`, 'te-acc', `купить «${r.title}» за ${chk.price}`)]
			: [S(`${chk.price}  `, 'te-faint'), S(g.cross, 'te-faint')];
		L.push(A.split(left, right, g));
		if (!chk.ok) L.push(A.row([S(`  └ ${chk.reason}`, 'te-faint')], g));
	}

	L.push(A.sep(g));
	L.push(A.split(
		[S(`k = ${effectiveK(s.economy).toFixed(1)}${s.economy.tune !== 1 ? ` (×${s.economy.tune})` : ''}`, 'te-faint')],
		[S(`приход ≈ ${s.economy.monthlyIncome}/мес`, 'te-faint')], g));
	L.push(A.bot(g));
	return L;
}

/* ── чат ────────────────────────────────────────────────────────────────── */

const PREFIX = { user: '› ', assistant: '  ', system: '· ' } as const;
const CLS = { user: 'te-acc', assistant: '', system: 'te-faint' } as const;

function screenChat(c: Ctx): Line[] {
	const { store, g, textCols } = c;
	const s = store.state;
	const L: Line[] = head(c);

	const shown = s.chat.slice(-24);
	if (!shown.length) L.push(A.row([S('Пусто.', 'te-faint')], g));

	for (const m of shown) {
		for (const [i, ln] of A.wrap(m.text, textCols - 2).entries()) {
			L.push(A.row([S(i === 0 ? PREFIX[m.role] : '  ', CLS[m.role]), S(ln, CLS[m.role])], g));
		}
		L.push(A.row([], g));
	}

	if (c.busy) L.push(A.row([S('  думает…', 'te-faint')], g));

	L.push(A.sep(g));
	L.push(A.row([S('› ', 'te-acc'), IN('compose', '', hint(store)), GAP], g));
	L.push(A.bot(g));
	return L;
}

const hint = (store: Store) =>
	store.state.onboarded ? 'завтра дожать отчёт, часа полтора' : 'ответь как есть';

/* ── подвал с моделью ───────────────────────────────────────────────────── */

export function render(c: Ctx): Line[] {
	const L =
		c.tab === 'goals' ? screenGoals(c) :
		c.tab === 'rewards' ? screenRewards(c) :
		screenChat(c);

	if (c.store.state.lastModel) {
		L.push([S(`  ${c.store.state.lastModel}`, 'te-faint te-clip'), GAP]);
	}
	return L;
}
