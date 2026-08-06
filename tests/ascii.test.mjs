import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bar, bot, dots, dw, lineW, row, sep, split, top, trunc, wrap } from '../.test-build/ui/ascii.js';
import { S, H, IN } from '../.test-build/ui/ascii.js';

/* ── честная мера ширины ───────────────────────────────────────────────── */

test('кириллица занимает одну ячейку', () => {
	assert.equal(dw('привет'), 6);
	assert.equal(dw('Ёжик'), 4);
});

test('восточноазиатские глифы и эмодзи занимают две', () => {
	assert.equal(dw('日本'), 4);
	assert.equal(dw('👍'), 2);
	assert.equal(dw('a👍b'), 4);
});

test('комбинирующие знаки не занимают ничего', () => {
	assert.equal(dw('é'), 1);
	assert.equal(dw('​'), 0);
});

test('.length соврал бы там, где dw права', () => {
	assert.equal('👍'.length, 2);
	assert.equal(dw('👍'), 2);
	assert.equal('é'.length, 2);
	assert.equal(dw('é'), 1);
});

/* ── обрезка ───────────────────────────────────────────────────────────── */

test('обрезка держит заданную ширину', () => {
	assert.equal(trunc('короткое', 20), 'короткое');
	assert.equal(dw(trunc('очень длинное название задачи', 10)), 10);
	assert.ok(trunc('очень длинное название задачи', 10).endsWith('…'));
});

test('обрезка не разрывает широкий глиф пополам', () => {
	const out = trunc('a👍👍👍', 4);
	assert.ok(dw(out) <= 4);
});

test('обрезка в ноль и в единицу не падает', () => {
	assert.equal(trunc('текст', 0), '');
	assert.equal(dw(trunc('текст', 1)), 1);
});

/* ── перенос ───────────────────────────────────────────────────────────── */

test('перенос не превышает ширину', () => {
	const text = 'Посчитал. Приход около 1300 баллов в месяц, потолок за день 90.';
	for (const w of [12, 20, 33, 60]) {
		for (const line of wrap(text, w)) assert.ok(dw(line) <= w, `«${line}» шире ${w}`);
	}
});

test('перенос сохраняет абзацы и режет слишком длинное слово', () => {
	assert.deepEqual(wrap('a\n\nb', 10), ['a', '', 'b']);
	const [only] = wrap('ааааааааааааааааааааа', 8);
	assert.equal(dw(only), 8);
});

/* ── главный инвариант: строка ровно в cols ────────────────────────────── */

const CASES = [
	[S('обычный текст')],
	[S('очень длинное название задачи, которое точно не влезет ни в какую панель')],
	[S('эмодзи 👍 и 日本 в названии')],
	[H('[ КУПИТЬ ]', 'buy:x', 'te-acc'), S(' хвост')],
	[S(''), S('  '), S('')],
	[IN(12, 'compose'), S(' рядом')],
	[S('é комбинирующий')],
];

test('строка в рамке всегда ровно в ширину панели', () => {
	for (const cols of [32, 40, 46, 61, 80, 110]) {
		assert.equal(lineW(top('ТУДУ · ЭКОНОМИКА', cols)), cols, `шапка при ${cols}`);
		assert.equal(lineW(sep(cols)), cols, `разделитель при ${cols}`);
		assert.equal(lineW(bot(cols)), cols, `подвал при ${cols}`);
		for (const segs of CASES) {
			assert.equal(lineW(row(segs, cols)), cols, `строка при ${cols}`);
		}
	}
});

test('две колонки тоже держат ширину', () => {
	const rights = [
		[S('+140')],
		[S('999999  '), H('[ КУПИТЬ ]', 'buy:x')],
		[],
	];
	for (const cols of [32, 44, 61, 100]) {
		for (const segs of CASES) {
			for (const right of rights) {
				assert.equal(lineW(split(segs, right, cols)), cols, `колонки при ${cols}`);
			}
		}
	}
});

test('правая колонка не срезается длинной левой', () => {
	const line = split(
		[S('невероятно длинное название задачи, которое никуда не влезет')],
		[S('+140')],
		40,
	);
	const text = line.map((g) => (g.t === 'input' ? ' '.repeat(g.w) : g.s)).join('');
	assert.ok(text.includes('+140'), 'цена справа должна уцелеть');
	assert.ok(text.endsWith(' │'));
});

test('рамка остаётся рамкой на любой ширине', () => {
	for (const cols of [32, 33, 110]) {
		const t = top('ТУДУ', cols).map((g) => g.s).join('');
		assert.ok(t.startsWith('┌─'));
		assert.ok(t.endsWith('┐'));
		assert.equal(bot(cols).map((g) => g.s).join('').at(0), '└');
	}
});

/* ── полоски ───────────────────────────────────────────────────────────── */

test('полоска всегда заданной длины', () => {
	for (const [v, max] of [[0, 200], [118, 200], [200, 200], [999, 200], [-5, 200], [1, 0]]) {
		assert.equal(dw(bar(v, max, 20)), 20, `${v}/${max}`);
	}
});

test('полоска отражает долю', () => {
	assert.equal(bar(0, 10, 4), '░░░░');
	assert.equal(bar(10, 10, 4), '████');
	assert.equal(bar(5, 10, 4), '██░░');
});

test('точки серии не выходят за максимум', () => {
	assert.equal(dots(0, 7).length, 7);
	assert.equal(dots(5, 7), '▪▪▪▪▪▫▫');
	assert.equal(dots(99, 7).length, 7);
});
