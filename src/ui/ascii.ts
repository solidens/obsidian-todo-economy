/**
 * ASCII-рендерер. Не знает ни про Obsidian, ни про предметную область —
 * только про ширину в символах, сегменты и точки попадания.
 *
 * Ключевое решение: строка — это не текст в одном <pre>, а массив сегментов.
 * Интерактивные сегменты становятся настоящими <button> и <input> с нулевым
 * паддингом. На вид — псевдографика, на деле — фокус, клавиатура и
 * скринридер работают сами собой.
 */

export type Seg =
	| { t: 'text'; s: string; cls?: string }
	| { t: 'hit'; s: string; act: string; cls?: string; label?: string }
	| { t: 'input'; w: number; act: string; value: string; placeholder?: string };

export const S = (s: string, cls?: string): Seg => ({ t: 'text', s, cls });
export const H = (s: string, act: string, cls?: string, label?: string): Seg => ({
	t: 'hit', s, act, cls, label,
});
export const IN = (w: number, act: string, value = '', placeholder?: string): Seg => ({
	t: 'input', w, act, value, placeholder,
});

export type Line = Seg[];

/* ── ширина в ячейках ──────────────────────────────────────────────────────
   .length врёт: суррогатная пара считается за два, комбинирующий знак — за
   один, а восточноазиатский глиф и эмодзи занимают две ячейки. Без честной
   меры ширины сетка разъезжается на первом же нестандартном символе.        */

const WIDE: Array<[number, number]> = [
	[0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0x303e], [0x3041, 0x33ff],
	[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3],
	[0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
	[0x1f300, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];

const isWide = (cp: number) => WIDE.some(([a, b]) => cp >= a && cp <= b);
const isZero = (cp: number) =>
	(cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f;

const cellOf = (cp: number) => (isZero(cp) ? 0 : isWide(cp) ? 2 : 1);

/** Ширина строки в ячейках терминальной сетки. */
export function dw(s: string): number {
	let w = 0;
	for (const ch of s) w += cellOf(ch.codePointAt(0) as number);
	return w;
}

/** Обрезать до ширины w, добавив многоточие. Режется хвост, не начало. */
export function trunc(s: string, w: number): string {
	if (w <= 0) return '';
	if (dw(s) <= w) return s;
	let out = '';
	let acc = 0;
	for (const ch of s) {
		const c = cellOf(ch.codePointAt(0) as number);
		if (acc + c > w - 1) break;
		out += ch;
		acc += c;
	}
	return out + '…';
}

const sp = (n: number) => ' '.repeat(Math.max(0, n));

/** Перенос по словам с честной мерой ширины. Пустая строка остаётся пустой. */
export function wrap(text: string, w: number): string[] {
	if (w <= 0) return [''];
	const out: string[] = [];
	for (const para of text.split('\n')) {
		if (!para.trim()) { out.push(''); continue; }
		let line = '';
		for (const word of para.split(/\s+/)) {
			if (!word) continue;
			if (!line) {
				line = dw(word) <= w ? word : trunc(word, w);
				continue;
			}
			if (dw(line) + 1 + dw(word) <= w) line += ' ' + word;
			else { out.push(line); line = dw(word) <= w ? word : trunc(word, w); }
		}
		if (line) out.push(line);
	}
	return out.length ? out : [''];
}

const segW = (g: Seg) => (g.t === 'input' ? g.w : dw(g.s));
export const lineW = (segs: Seg[]) => segs.reduce((n, g) => n + segW(g), 0);

/** Срезать хвост набора сегментов на `over` ячеек. */
function shrink(segs: Seg[], over: number): Seg[] {
	const out = segs.slice();
	let left = over;
	for (let i = out.length - 1; i >= 0 && left > 0; i--) {
		const g = out[i];
		const w = segW(g);
		if (g.t === 'input') { out.splice(i, 1); left -= w; continue; }
		if (w <= left) { out.splice(i, 1); left -= w; continue; }
		out[i] = { ...g, s: trunc(g.s, w - left) } as Seg;
		left = 0;
	}
	return out;
}

/* ── рамка ─────────────────────────────────────────────────────────────── */

export function top(title: string, cols: number): Line {
	const fill = cols - 2 - dw(`─ ${title} `);
	return [S(`┌─ ${title} ${'─'.repeat(Math.max(0, fill))}┐`, 'te-faint')];
}
export const sep = (cols: number): Line => [S(`├${'─'.repeat(Math.max(0, cols - 2))}┤`, 'te-faint')];
export const bot = (cols: number): Line => [S(`└${'─'.repeat(Math.max(0, cols - 2))}┘`, 'te-faint')];

/** Строка внутри рамки: `│ содержимое │`, добитая до ровного правого края. */
export function row(segs: Seg[], cols: number): Line {
	const inner = cols - 4;
	let body = segs;
	const used = lineW(body);
	if (used > inner) body = shrink(body, used - inner);
	const pad = inner - lineW(body);
	return [S('│ ', 'te-faint'), ...body, S(sp(pad)), S(' │', 'te-faint')];
}

/** Слева и справа, с добивкой пробелами посередине. */
export function split(left: Seg[], right: Seg[], cols: number): Line {
	const inner = cols - 4;
	const rw = lineW(right);
	const room = Math.max(0, inner - rw - 1);
	let l = left;
	if (lineW(l) > room) l = shrink(l, lineW(l) - room);
	return row([...l, S(sp(inner - lineW(l) - rw)), ...right], cols);
}

export const bar = (v: number, max: number, w: number): string => {
	const f = Math.round(Math.max(0, Math.min(1, max > 0 ? v / max : 0)) * w);
	return '█'.repeat(f) + '░'.repeat(Math.max(0, w - f));
};

export const dots = (v: number, max: number): string =>
	'▪'.repeat(Math.max(0, Math.min(v, max))) + '▫'.repeat(Math.max(0, max - v));

/* ── отрисовка ─────────────────────────────────────────────────────────── */

export interface PaintHandlers {
	onAct(act: string): void;
	onSubmit(act: string, value: string): void;
}

interface Snapshot {
	act: string;
	value?: string;
	sel?: [number, number];
	isInput: boolean;
}

function snapshot(host: HTMLElement): Snapshot | null {
	const el = host.ownerDocument.activeElement as HTMLElement | null;
	if (!el || !host.contains(el)) return null;
	const act = el.dataset?.act;
	if (!act) return null;
	if (el instanceof HTMLInputElement) {
		return {
			act, isInput: true, value: el.value,
			sel: [el.selectionStart ?? 0, el.selectionEnd ?? 0],
		};
	}
	return { act, isInput: false };
}

/**
 * Перерисовать панель целиком и вернуть точки попадания.
 * Полная перерисовка идёт раз в секунду из-за помодоро, поэтому фокус,
 * набранный текст и позиция курсора аккуратно переживают её.
 */
export function paint(host: HTMLElement, lines: Line[], h: PaintHandlers): HTMLElement[] {
	const keep = snapshot(host);
	host.empty();

	let restore: HTMLElement | null = null;
	const hits: HTMLElement[] = [];

	for (const segs of lines) {
		const ln = host.createDiv({ cls: 'te-ln' });
		for (const g of segs) {
			if (g.t === 'text') {
				if (!g.s) continue;
				ln.createSpan({ text: g.s, cls: g.cls });
				continue;
			}
			if (g.t === 'hit') {
				const b = ln.createEl('button', { text: g.s, cls: 'te-hit' + (g.cls ? ' ' + g.cls : '') });
				b.type = 'button';
				b.dataset.act = g.act;
				b.tabIndex = -1;
				if (g.label) b.setAttribute('aria-label', g.label);
				b.addEventListener('click', () => h.onAct(g.act));
				hits.push(b);
				if (keep && keep.act === g.act && !keep.isInput) restore = b;
				continue;
			}
			const inp = ln.createEl('input', { cls: 'te-in' });
			inp.type = 'text';
			inp.dataset.act = g.act;
			inp.tabIndex = -1;
			inp.value = g.value;
			if (g.placeholder) inp.placeholder = g.placeholder;
			inp.style.width = `${g.w}ch`;
			inp.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				const v = inp.value.trim();
				if (v) { inp.value = ''; h.onSubmit(g.act, v); }
			});
			hits.push(inp);
			if (keep && keep.act === g.act && keep.isInput) {
				inp.value = keep.value ?? '';
				restore = inp;
			}
		}
	}

	if (hits.length) (restore ?? hits[0]).tabIndex = 0;
	if (restore) {
		restore.focus({ preventScroll: true });
		if (restore instanceof HTMLInputElement && keep?.sel) {
			restore.setSelectionRange(keep.sel[0], keep.sel[1]);
		}
	}
	return hits;
}

/** Стрелки водят по точкам попадания. Внутри поля ввода они отданы каретке. */
export function wireKeyboard(host: HTMLElement, getHits: () => HTMLElement[]): (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		const el = host.ownerDocument.activeElement as HTMLElement | null;
		if (!el || el instanceof HTMLInputElement) return;
		const hits = getHits();
		const i = hits.indexOf(el);
		if (i < 0) return;
		let n: number | null = null;
		if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % hits.length;
		else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + hits.length) % hits.length;
		else if (e.key === 'Home') n = 0;
		else if (e.key === 'End') n = hits.length - 1;
		if (n === null) return;
		e.preventDefault();
		hits[i].tabIndex = -1;
		hits[n].tabIndex = 0;
		hits[n].focus();
	};
}

/* ── метрики сетки ─────────────────────────────────────────────────────── */

/** Ширина одного символа в пикселях. Меряется по сотне нулей. */
export function charWidth(host: HTMLElement): number {
	const probe = host.createSpan({ text: '0'.repeat(100) });
	probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
	const w = probe.getBoundingClientRect().width / 100;
	probe.remove();
	return w > 0 ? w : 8;
}

export function colsFor(host: HTMLElement, cw: number, lo = 32, hi = 110): number {
	const avail = host.getBoundingClientRect().width;
	if (!avail || !cw) return lo;
	return Math.max(lo, Math.min(hi, Math.floor(avail / cw)));
}

/** Символы, на которых держится сетка. Если шрифт рисует их не в одну ячейку — всё поедет. */
export const GRID_GLYPHS = ['─', '│', '┌', '┐', '└', '┘', '├', '┤', '█', '░', '▪', '▫', '▸', '✓', '…'];

/** Вернуть глифы, ширина которых расходится с шириной «0» больше чем на 2 %. */
export function auditGlyphs(host: HTMLElement): string[] {
	const base = charWidth(host);
	if (!base) return [];
	const bad: string[] = [];
	for (const g of GRID_GLYPHS) {
		const probe = host.createSpan({ text: g.repeat(40) });
		probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
		const w = probe.getBoundingClientRect().width / 40;
		probe.remove();
		if (base > 0 && Math.abs(w / base - 1) > 0.02) bad.push(g);
	}
	return bad;
}
