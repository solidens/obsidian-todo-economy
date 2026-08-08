import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	bar, bot, classify, dots, dw, GLYPH_SETS, hasGap, lineW, pickGlyphs,
	row, sep, split, top, trunc, wrap, S, H, IN, GAP,
} from '../.test-build/ui/ascii.js';

const U = GLYPH_SETS.unicode;
const A = GLYPH_SETS.ascii;

// Разложенная «e с акутом» и невидимые символы собираются кодами намеренно:
// в исходнике редактор нормализовал бы их, и тест проверял бы не то.
const COMBINING = 'e' + String.fromCharCode(0x0301);
const ZERO_WIDTH = String.fromCharCode(0x200b);
const VARIATION = String.fromCharCode(0xfe0f);

/* ── мера ширины ───────────────────────────────────────────────────────── */

test('кириллица занимает одну ячейку, азиатское и эмодзи — две', () => {
	assert.equal(dw('привет'), 6);
	assert.equal(dw('日本'), 4);
	assert.equal(dw('👍'), 2);
	assert.equal(dw('a👍b'), 4);
});

test('комбинирующие и невидимые знаки не занимают ничего', () => {
	assert.equal(dw(COMBINING), 1);
	assert.equal(dw(ZERO_WIDTH), 0);
	assert.equal(dw(VARIATION), 0);
});

test('.length соврал бы там, где dw права', () => {
	assert.equal('👍'.length, 2);
	assert.equal(dw('👍'), 2);
	assert.equal(COMBINING.length, 2);
	assert.equal(dw(COMBINING), 1);
});

test('обрезка держит ширину и не рвёт широкий глиф', () => {
	assert.equal(trunc('короткое', 20), 'короткое');
	assert.equal(dw(trunc('очень длинное название задачи', 10)), 10);
	assert.ok(trunc('очень длинное название задачи', 10).endsWith('…'));
	assert.ok(dw(trunc('a👍👍👍', 4)) <= 4);
	assert.equal(trunc('текст', 0), '');
});

test('перенос не превышает ширину и сохраняет абзацы', () => {
	const text = 'Посчитал. Приход около 1300 баллов в месяц, потолок за день 90.';
	for (const w of [12, 20, 33, 60]) {
		for (const line of wrap(text, w)) assert.ok(dw(line) <= w, `«${line}» шире ${w}`);
	}
	assert.deepEqual(wrap('a\n\nb', 10), ['a', '', 'b']);
	assert.equal(dw(wrap('ааааааааааааааааааааа', 8)[0]), 8);
});

/* ── главный инвариант: распорка, а не пробелы ─────────────────────────── */

const CASES = [
	[S('обычный текст')],
	[S('очень длинное название задачи, которое точно не влезет ни в какую панель')],
	[S('эмодзи 👍 и 日本 в названии')],
	[H('[ КУПИТЬ ]', 'buy:x', 'te-acc'), S(' хвост')],
	[],
	[S('mmmmm wwwww MMMMM WWWWW')],
	[S(COMBINING + ' комбинирующий')],
];

test('в каждой строке ровно одна распорка — она и держит правую границу', () => {
	for (const g of [U, A]) {
		for (const segs of CASES) {
			const line = row(segs, g);
			assert.equal(line.filter((x) => x.t === 'gap').length, 1);
			assert.ok(hasGap(line));
		}
	}
});

test('две колонки: распорка между ними, правая часть на месте', () => {
	const line = split([S('невероятно длинное название задачи')], [S('+140')], U);
	assert.equal(line.filter((x) => x.t === 'gap').length, 1);
	const right = line[line.length - 2];
	assert.equal(right.t, 'text');
	assert.equal(right.s, '+140');
});

test('левая колонка помечена как ужимаемая, правая — нет', () => {
	const line = split([S('название'), H('[x]', 'toggle:a')], [S('+140')], U);
	const left = line.filter((x) => (x.t === 'text' || x.t === 'hit') && (x.s === 'название' || x.s === '[x]'));
	assert.equal(left.length, 2);
	assert.ok(left.every((x) => x.clip === true), 'левое должно резаться многоточием');
	assert.notEqual(line[line.length - 2].clip, true, 'цена справа не режется');
});

test('поле ввода не требует ширины в символах', () => {
	const line = row([S('› '), IN('compose', '', 'подсказка')], U);
	const inp = line.find((x) => x.t === 'input');
	assert.ok(inp);
	assert.equal(inp.w, undefined, 'ширина поля — дело разметки, а не счётчика');
	assert.ok(hasGap(line));
});

test('строка с готовой распоркой не получает вторую', () => {
	const line = row([S('a'), GAP, S('b')], U);
	assert.equal(line.filter((x) => x.t === 'gap').length, 1);
});

test('рамка открывается и закрывается своими углами', () => {
	for (const g of [U, A]) {
		const t = top('ТУДУ', g);
		assert.ok(t[0].s.startsWith(g.tl + g.h));
		assert.equal(t[t.length - 1].s, g.tr);
		assert.equal(t.filter((x) => x.t === 'fill').length, 1);

		assert.equal(sep(g)[0].s, g.ml);
		assert.equal(bot(g)[0].s, g.bl);
		assert.equal(bot(g)[bot(g).length - 1].s, g.br);
	}
});

test('линейка — заполнитель, а не точное число символов', () => {
	const fill = sep(U).find((x) => x.t === 'fill');
	assert.ok(fill.s.length > 100, 'заведомо длиннее любой панели, лишнее обрежет разметка');
	assert.ok([...fill.s].every((ch) => ch === U.h));
});

test('ширина текстовой части считается без распорок и заполнителей', () => {
	assert.equal(lineW([S('абв'), GAP]), 3);
	assert.equal(lineW(sep(U)), 2, 'только левый и правый угол');
});

/* ── полоски ───────────────────────────────────────────────────────────── */

test('полоска всегда заданной длины, в любом наборе', () => {
	for (const g of [U, A]) {
		for (const [v, max] of [[0, 200], [118, 200], [200, 200], [999, 200], [-5, 200], [1, 0]]) {
			assert.equal(dw(bar(v, max, 20, g)), 20, `${v}/${max}`);
		}
	}
	assert.equal(bar(0, 10, 4, U), '░░░░');
	assert.equal(bar(10, 10, 4, U), '████');
	assert.equal(bar(5, 10, 4, A), '##..');
});

test('точки серии не выходят за максимум', () => {
	assert.equal(dots(0, 7, U).length, 7);
	assert.equal(dots(5, 7, U), '▪▪▪▪▪▫▫');
	assert.equal(dots(99, 7, U).length, 7);
	assert.equal(dots(2, 4, A), '**..');
});

/* ── определение шрифта ────────────────────────────────────────────────── */

const widths = (over) => ({ '0': 10, m: 10, M: 10, w: 10, W: 10, i: 10, l: 10, '.': 10, ...over });

test('моноширинный узнаётся', () => {
	const r = classify(widths());
	assert.equal(r.kind, 'mono');
	assert.deepEqual(r.wide, []);
});

test('iA Writer Duo узнаётся по полуторным m и w', () => {
	const r = classify(widths({ m: 15, M: 15, w: 15, W: 15 }));
	assert.equal(r.kind, 'duo');
	assert.deepEqual(r.wide.sort(), ['M', 'W', 'm', 'w']);
});

test('дуоспейс с расширенной кириллицей — тоже дуоспейс', () => {
	const r = classify(widths({ m: 15, w: 15, м: 15, ш: 15, щ: 15 }));
	assert.equal(r.kind, 'duo');
	assert.ok(r.wide.includes('ш'));
});

test('пропорциональный узнаётся по узким буквам', () => {
	assert.equal(classify(widths({ i: 5, l: 5, m: 15 })).kind, 'proportional');
	assert.equal(classify(widths({ i: 5 })).kind, 'proportional');
});

test('расширение не в полтора раза — уже не дуоспейс', () => {
	assert.equal(classify(widths({ m: 12 })).kind, 'proportional');
});

test('без замера нуля не гадаем', () => {
	assert.equal(classify({}).kind, 'proportional');
	assert.equal(classify({ '0': 0, m: 10 }).kind, 'proportional');
});

test('разброс в пределах округления считается моноширинным', () => {
	assert.equal(classify(widths({ m: 10.1, w: 9.9 })).kind, 'mono');
});

test('выбор набора: авто смотрит на псевдографику, ручной — сильнее', () => {
	assert.equal(pickGlyphs('auto', true), GLYPH_SETS.unicode);
	assert.equal(pickGlyphs('auto', false), GLYPH_SETS.ascii);
	assert.equal(pickGlyphs('unicode', false), GLYPH_SETS.unicode);
	assert.equal(pickGlyphs('ascii', true), GLYPH_SETS.ascii);
});

test('запасной набор целиком из ASCII', () => {
	for (const ch of Object.values(GLYPH_SETS.ascii)) {
		assert.ok(ch.codePointAt(0) < 128, `${ch} не ASCII`);
	}
});
