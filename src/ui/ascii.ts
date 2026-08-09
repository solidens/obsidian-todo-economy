/**
 * ASCII-рендерер. Не знает ни про Obsidian, ни про предметную область —
 * только про сегменты, точки попадания и метрики шрифта.
 *
 * ── Почему выравнивание НЕ считает символы ────────────────────────────────
 *
 * Первая версия добивала строку пробелами до ровно N ячеек. Это работает
 * ровно до тех пор, пока шрифт моноширинный. iA Writer Duo — не моноширинный:
 * m, M, w, W в нём в полтора раза шире прочих, и строка съезжает настолько,
 * сколько в ней таких букв. Подобрать глифы тут нельзя, потому что ломается
 * не псевдографика, а сам способ выравнивания.
 *
 * Поэтому добивка пробелами убрана. Строка — flex-ряд: слева содержимое,
 * справа колонка, между ними распорка `gap`, занимающая весь остаток.
 * Горизонтальные линейки — сегмент `fill`: заведомо длинная строка из `─`,
 * обрезанная по границе. Длинные названия режет CSS многоточием, а не наш
 * счётчик символов.
 *
 * В итоге правая граница рамки стоит на месте при любом шрифте — моноширинном,
 * дуоспейсном и даже пропорциональном. Счёт в ячейках остался только там, где
 * он честен: длина полосок и порог компактной раскладки.
 */

/* ── набор псевдографики ───────────────────────────────────────────────── */

export interface Glyphs {
	tl: string; tr: string; bl: string; br: string; ml: string; mr: string;
	h: string; v: string;
	full: string; empty: string;
	dotOn: string; dotOff: string;
	arrow: string; check: string; cross: string; bolt: string; warn: string;
}

export const GLYPH_SETS: Record<'unicode' | 'ascii', Glyphs> = {
	unicode: {
		tl: '┌', tr: '┐', bl: '└', br: '┘', ml: '├', mr: '┤',
		h: '─', v: '│',
		full: '█', empty: '░',
		dotOn: '▪', dotOff: '▫',
		arrow: '▸', check: '✓', cross: '╳', bolt: '⌁', warn: '▲',
	},
	// Запасной набор: рисуется любым шрифтом, ничего не подставляется из
	// чужого семейства и потому ничего не разъезжается ни вширь, ни ввысь.
	ascii: {
		tl: '+', tr: '+', bl: '+', br: '+', ml: '+', mr: '+',
		h: '-', v: '|',
		full: '#', empty: '.',
		dotOn: '*', dotOff: '.',
		arrow: '>', check: 'v', cross: 'x', bolt: '*', warn: '^',
	},
};

export type GlyphMode = 'auto' | 'unicode' | 'ascii';

/* ── сегменты ──────────────────────────────────────────────────────────── */

export type Seg =
	| { t: 'text'; s: string; cls?: string; clip?: boolean }
	| { t: 'hit'; s: string; act: string; cls?: string; label?: string; clip?: boolean }
	| { t: 'input'; act: string; value: string; placeholder?: string }
	| { t: 'gap' }
	| { t: 'fill'; s: string; cls?: string };

export type Line = Seg[];

export const S = (s: string, cls?: string): Seg => ({ t: 'text', s, cls });
/** Текст, который разрешено обрезать многоточием, когда места не хватает. */
export const CLIP = (s: string, cls?: string): Seg => ({ t: 'text', s, cls, clip: true });
export const H = (s: string, act: string, cls?: string, label?: string): Seg =>
	({ t: 'hit', s, act, cls, label });
export const IN = (act: string, value = '', placeholder?: string): Seg =>
	({ t: 'input', act, value, placeholder });
export const GAP: Seg = { t: 'gap' };
export const FILL = (s: string, cls?: string): Seg => ({ t: 'fill', s, cls });

/* ── мера ширины в ячейках ─────────────────────────────────────────────────
   Нужна только для полосок и порогов. .length соврал бы: суррогатная пара
   считается за два, комбинирующий знак — за один, восточноазиатский глиф
   занимает две ячейки.                                                     */

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

export function dw(s: string): number {
	let w = 0;
	for (const ch of s) w += cellOf(ch.codePointAt(0) as number);
	return w;
}

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

/** Перенос по словам. Пустая строка остаётся пустой. */
export function wrap(text: string, w: number): string[] {
	if (w <= 0) return [''];
	const out: string[] = [];
	for (const para of text.split('\n')) {
		if (!para.trim()) { out.push(''); continue; }
		let line = '';
		for (const word of para.split(/\s+/)) {
			if (!word) continue;
			if (!line) { line = dw(word) <= w ? word : trunc(word, w); continue; }
			if (dw(line) + 1 + dw(word) <= w) line += ' ' + word;
			else { out.push(line); line = dw(word) <= w ? word : trunc(word, w); }
		}
		if (line) out.push(line);
	}
	return out.length ? out : [''];
}

/** Ширина текстовой части строки в ячейках. Распорки и заполнители — ноль. */
export const lineW = (segs: Seg[]) =>
	segs.reduce((n, g) => n + (g.t === 'text' || g.t === 'hit' ? dw(g.s) : 0), 0);

/** Есть ли в строке распорка — без неё правая граница не встанет на место. */
export const hasGap = (segs: Seg[]) => segs.some((g) => g.t === 'gap' || g.t === 'fill');

/* ── рамка ─────────────────────────────────────────────────────────────── */

const FILL_LEN = 240;

export function top(title: string, g: Glyphs): Line {
	return [
		S(`${g.tl}${g.h} ${title} `, 'te-faint'),
		FILL(g.h.repeat(FILL_LEN), 'te-faint'),
		S(g.tr, 'te-faint'),
	];
}
export const sep = (g: Glyphs): Line =>
	[S(g.ml, 'te-faint'), FILL(g.h.repeat(FILL_LEN), 'te-faint'), S(g.mr, 'te-faint')];
export const bot = (g: Glyphs): Line =>
	[S(g.bl, 'te-faint'), FILL(g.h.repeat(FILL_LEN), 'te-faint'), S(g.br, 'te-faint')];

/**
 * Строка внутри рамки. Распорка добавляется автоматически, если её нет:
 * именно она, а не пробелы, держит правую границу на месте.
 */
export function row(segs: Seg[], g: Glyphs): Line {
	const body = hasGap(segs) ? segs : [...segs, GAP];
	return [S(`${g.v} `, 'te-faint'), ...body, S(` ${g.v}`, 'te-faint')];
}

/** Слева и справа. Левая часть ужимается многоточием, правая стоит намертво. */
export function split(left: Seg[], right: Seg[], g: Glyphs): Line {
	const shrinkable = left.map((s) =>
		s.t === 'text' || s.t === 'hit' ? ({ ...s, clip: true } as Seg) : s);
	return row([...shrinkable, GAP, ...right], g);
}

export const bar = (v: number, max: number, w: number, g: Glyphs): string => {
	const f = Math.round(Math.max(0, Math.min(1, max > 0 ? v / max : 0)) * w);
	return g.full.repeat(f) + g.empty.repeat(Math.max(0, w - f));
};

export const dots = (v: number, max: number, g: Glyphs): string =>
	g.dotOn.repeat(Math.max(0, Math.min(v, max))) + g.dotOff.repeat(Math.max(0, max - v));

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
	if (el.instanceOf(HTMLInputElement)) {
		return { act, isInput: true, value: el.value, sel: [el.selectionStart ?? 0, el.selectionEnd ?? 0] };
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
			switch (g.t) {
				case 'gap':
					ln.createSpan({ cls: 'te-gap' });
					break;

				case 'fill': {
					const f = ln.createSpan({ text: g.s, cls: 'te-fill' + (g.cls ? ' ' + g.cls : '') });
					f.setAttribute('aria-hidden', 'true');
					break;
				}

				case 'text': {
					if (!g.s) break;
					ln.createSpan({ text: g.s, cls: (g.cls ?? '') + (g.clip ? ' te-clip' : '') });
					break;
				}

				case 'hit': {
					const b = ln.createEl('button', {
						text: g.s,
						cls: 'te-hit' + (g.cls ? ' ' + g.cls : '') + (g.clip ? ' te-clip' : ''),
					});
					b.type = 'button';
					b.dataset.act = g.act;
					b.tabIndex = -1;
					if (g.label) b.setAttribute('aria-label', g.label);
					b.addEventListener('click', () => h.onAct(g.act));
					hits.push(b);
					if (keep && keep.act === g.act && !keep.isInput) restore = b;
					break;
				}

				case 'input': {
					const inp = ln.createEl('input', { cls: 'te-in' });
					inp.type = 'text';
					inp.dataset.act = g.act;
					inp.tabIndex = -1;
					inp.value = g.value;
					if (g.placeholder) inp.placeholder = g.placeholder;
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
					break;
				}
			}
		}
	}

	if (hits.length) (restore ?? hits[0]).tabIndex = 0;
	if (restore) {
		restore.focus({ preventScroll: true });
		if (restore.instanceOf(HTMLInputElement) && keep?.sel) {
			restore.setSelectionRange(keep.sel[0], keep.sel[1]);
		}
	}
	return hits;
}

/** Стрелки водят по точкам попадания. Внутри поля ввода отданы каретке. */
export function wireKeyboard(host: HTMLElement, getHits: () => HTMLElement[]): (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		const el = host.ownerDocument.activeElement as HTMLElement | null;
		if (!el || el.instanceOf(HTMLInputElement)) return;
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

/* ── метрики шрифта ────────────────────────────────────────────────────── */

export type FontKind = 'mono' | 'duo' | 'proportional';

export interface FontProfile {
	/** Ширина «0» в пикселях — ячейка сетки. */
	cell: number;
	/** Средняя ширина буквы русской прозы: по ней считается перенос строк. */
	prose: number;
	kind: FontKind;
	/** Символы шире ячейки более чем на 2 %. */
	wide: string[];
	/** Псевдографика этого шрифта держит ширину ячейки. */
	gridSafe: boolean;
}

/** Проба ширины: строку меряем двадцатикратно, чтобы сгладить округление. */
export function makeMeasurer(host: HTMLElement): { of: (s: string) => number; dispose: () => void } {
	const probe = host.createSpan();
	probe.setCssStyles({
		position: 'absolute', left: '-9999px', top: '0',
		visibility: 'hidden', whiteSpace: 'pre', pointerEvents: 'none',
	});
	return {
		of: (s: string) => {
			if (!s) return 0;
			probe.textContent = s.repeat(20);
			return probe.getBoundingClientRect().width / 20;
		},
		dispose: () => probe.remove(),
	};
}

/** Буквы, которым дуоспейсные шрифты дают полуторную ширину. */
const LATIN_WIDE = ['m', 'M', 'w', 'W'];
/** Их кириллические родственники — какие именно расширены, у шрифтов расходится. */
const CYRILLIC_WIDE = ['м', 'ш', 'щ', 'ж', 'ы', 'М', 'Ш', 'Щ', 'Ж'];
const NARROW = ['i', 'l', '.', 'j'];
export const PROSE_SAMPLE = 'обычныйтекстзадачидляоценкисреднейшириныбуквы';

const near = (a: number, b: number, tol = 0.02) => Math.abs(a / b - 1) <= tol;

/**
 * Классификация по замерам. Отделена от DOM, чтобы проверяться тестами на
 * выдуманных метриках — в том числе на метриках iA Writer Duo.
 */
export function classify(w: Record<string, number>): { kind: FontKind; wide: string[] } {
	const cell = w['0'];
	if (!cell) return { kind: 'proportional', wide: [] };

	const wide: string[] = [];
	let narrowFound = false;

	for (const [ch, px] of Object.entries(w)) {
		if (ch === '0') continue;
		if (px > cell * 1.02) wide.push(ch);
		else if (px < cell * 0.98) narrowFound = true;
	}

	if (!wide.length && !narrowFound) return { kind: 'mono', wide: [] };
	if (narrowFound) return { kind: 'proportional', wide };

	// дуоспейс: всё расширенное расширено ровно в полтора раза, узкого нет
	const allOneAndHalf = wide.every((ch) => near(w[ch], cell * 1.5, 0.06));
	return { kind: allOneAndHalf ? 'duo' : 'proportional', wide };
}

export function probeFont(host: HTMLElement, glyphs: Glyphs): FontProfile {
	const m = makeMeasurer(host);
	try {
		const sample: Record<string, number> = { '0': m.of('0') };
		for (const ch of [...LATIN_WIDE, ...CYRILLIC_WIDE, ...NARROW]) sample[ch] = m.of(ch);

		const { kind, wide } = classify(sample);
		const cell = sample['0'] || 8;
		const prose = m.of(PROSE_SAMPLE) || cell;

		// Псевдографику проверяем на согласованность с ячейкой: если шрифт её
		// не содержит, подставится другое семейство — и поедет и вширь, и ввысь.
		const frame = [glyphs.h, glyphs.v, glyphs.tl, glyphs.full, glyphs.empty];
		const gridSafe = frame.every((ch) => near(m.of(ch), cell, 0.03));

		return { cell, prose, kind, wide, gridSafe };
	} finally {
		m.dispose();
	}
}

/** Сколько ячеек влезает по ширине — для полосок и порога компактности. */
export function colsFor(host: HTMLElement, cell: number, lo = 28, hi = 120): number {
	const avail = host.getBoundingClientRect().width;
	if (!avail || !cell) return lo;
	return Math.max(lo, Math.min(hi, Math.floor(avail / cell)));
}

/**
 * Сколько букв прозы влезает в строку — для переноса текста в чате.
 * У дуоспейсных шрифтов это заметно меньше, чем ячеек: буквы в среднем шире.
 */
export function textColsFor(host: HTMLElement, prose: number, lo = 18): number {
	const avail = host.getBoundingClientRect().width;
	if (!avail || !prose) return lo;
	return Math.max(lo, Math.floor((avail * 0.92) / prose));
}

export function pickGlyphs(mode: GlyphMode, gridSafe: boolean): Glyphs {
	if (mode === 'unicode') return GLYPH_SETS.unicode;
	if (mode === 'ascii') return GLYPH_SETS.ascii;
	return gridSafe ? GLYPH_SETS.unicode : GLYPH_SETS.ascii;
}

/** Человеческое описание профиля — для настроек. */
export function describeFont(p: FontProfile): string {
	const kind =
		p.kind === 'mono' ? 'моноширинный' :
		p.kind === 'duo' ? 'дуоспейсный' : 'пропорциональный';
	const wide = p.wide.length ? `, шире ячейки: ${p.wide.join(' ')}` : '';
	const frame = p.gridSafe ? 'псевдографика своя' : 'псевдографика подставная — включён ASCII';
	return `${kind}, ячейка ${p.cell.toFixed(1)} px${wide}. ${frame}.`;
}
