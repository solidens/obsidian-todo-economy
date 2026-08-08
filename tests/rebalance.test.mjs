import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	effectiveK, incomeFromHistory, MIN_SPAN_DAYS, price, TUNE_LIMITS, tuneBy,
} from '../.test-build/core/economy.js';
import { findTask, rebalance } from '../.test-build/core/rebalance.js';
import { DEFAULT_STATE } from '../.test-build/core/types.js';

const DAY = 864e5;
const NOW = Date.UTC(2026, 7, 8, 12);

const S = (over = {}) => {
	const s = structuredClone(DEFAULT_STATE);
	s.economy = { k: 20, monthlyIncome: 3000, dayCap: 200, softCap: 900, tune: 1 };
	s.rewards = [
		{ id: 'r1', title: 'Серия', value: 2, harm: 1, freq: 10, kind: 'normal' },
		{ id: 'r2', title: 'Прогулка', value: 0.8, harm: 0.7, freq: 20, kind: 'restore' },
	];
	s.profile = { workdays: 5, routine: [{ title: 'x', min: 60, diff: 1, prio: 1, perWeek: 5 }] };
	return Object.assign(s, over);
};

/** Ровный поток начислений: amount баллов в день на протяжении days дней. */
const earned = (days, amount, now = NOW) =>
	Array.from({ length: days }, (_, i) => ({
		at: now - (days - i) * DAY,
		kind: 'earn',
		amount,
		note: 'задача',
	}));

/* ── приход по факту ───────────────────────────────────────────────────── */

test('без истории мерить нечего', () => {
	assert.equal(incomeFromHistory([], NOW), null);
});

test('меньше недели данных — это не измерение', () => {
	assert.equal(incomeFromHistory(earned(3, 100), NOW), null);
	assert.ok(incomeFromHistory(earned(MIN_SPAN_DAYS + 1, 100), NOW));
});

test('месячный приход считается по дневному темпу', () => {
	const f = incomeFromHistory(earned(20, 100), NOW);
	assert.equal(f.samples, 20);
	assert.ok(Math.abs(f.monthly - 3044) < 200, `получилось ${f.monthly}`);
});

test('откаты вычитаются, траты и штрафы — нет', () => {
	const h = [
		...earned(14, 100),
		{ at: NOW - DAY, kind: 'undo', amount: -100, note: 'откат' },
		{ at: NOW - DAY, kind: 'spend', amount: -500, note: 'награда' },
		{ at: NOW - DAY, kind: 'penalty', amount: -40, note: 'просрочка' },
		{ at: NOW - DAY, kind: 'decay', amount: -30, note: 'сгорание' },
	];
	const only = incomeFromHistory(earned(14, 100), NOW);
	const withNoise = incomeFromHistory(h, NOW);
	assert.ok(withNoise.monthly < only.monthly, 'откат должен уменьшить приход');
	assert.ok(withNoise.monthly > only.monthly * 0.8, 'а траты — не должны');
});

test('старое за окном не учитывается', () => {
	const h = [...earned(10, 100), ...earned(10, 5000, NOW - 200 * DAY)];
	const f = incomeFromHistory(h, NOW);
	assert.ok(f.monthly < 5000, 'прошлогодние подвиги в счёт не идут');
});

test('нулевой или отрицательный итог не выдаётся за приход', () => {
	const h = [{ at: NOW - 10 * DAY, kind: 'earn', amount: 0, note: '' }];
	assert.equal(incomeFromHistory(h, NOW), null);
});

/* ── ручная поправка ───────────────────────────────────────────────────── */

test('поправка ходит в обе стороны и упирается в пределы', () => {
	assert.ok(tuneBy(1, 'cheaper') < 1);
	assert.ok(tuneBy(1, 'pricier') > 1);
	let v = 1;
	for (let i = 0; i < 50; i++) v = tuneBy(v, 'cheaper');
	assert.equal(v, TUNE_LIMITS[0]);
	for (let i = 0; i < 50; i++) v = tuneBy(v, 'pricier');
	assert.equal(v, TUNE_LIMITS[1]);
});

test('поправка входит в цену', () => {
	const r = { value: 2, harm: 1 };
	const base = price(r, effectiveK({ k: 20, tune: 1 }));
	assert.ok(price(r, effectiveK({ k: 20, tune: 0.5 })) < base);
	assert.ok(price(r, effectiveK({ k: 20, tune: 2 })) > base);
	assert.equal(effectiveK({ k: 20, tune: 0 }), 20, 'нулевая поправка считается единицей');
});

/* ── пересчёт ──────────────────────────────────────────────────────────── */

test('без наград пересчитывать нечего', () => {
	const r = rebalance(S({ rewards: [] }), 'solve', NOW);
	assert.equal(r.applied, false);
	assert.match(r.report, /наград/);
});

test('пересчёт по факту без истории честно отказывается и предлагает выход', () => {
	const r = rebalance(S(), 'solve', NOW);
	assert.equal(r.applied, false);
	assert.match(r.report, /дешевле или дороже/);
});

test('пересчёт по факту заменяет оценку из онбординга', () => {
	const s = S({ history: earned(20, 50) });
	const before = s.economy.monthlyIncome;
	const r = rebalance(s, 'solve', NOW);
	assert.equal(r.applied, true);
	assert.notEqual(s.economy.monthlyIncome, before);
	assert.ok(s.economy.monthlyIncome < before, 'по факту зарабатывается меньше, чем обещал онбординг');
	assert.match(r.report, /завышена/);
});

test('пересчёт по факту снимает ручную поправку', () => {
	const s = S({ history: earned(20, 50) });
	s.economy.tune = 0.6;
	const r = rebalance(s, 'solve', NOW);
	assert.equal(s.economy.tune, 1);
	assert.match(r.report, /поправку убрал/);
});

test('пересчёт держит замыкание бюджета', () => {
	const s = S({ history: earned(20, 50) });
	rebalance(s, 'solve', NOW);
	const spend = s.rewards.reduce((sum, r) => sum + r.freq * s.economy.k * r.value * r.harm, 0);
	assert.ok(Math.abs(spend - 0.85 * s.economy.monthlyIncome * 0.75) < 1e-6);
});

test('дешевле и дороже двигают только поправку', () => {
	const s = S();
	const k = s.economy.k;
	rebalance(s, 'cheaper', NOW);
	assert.ok(s.economy.tune < 1);
	assert.equal(s.economy.k, k, 'решённое значение не трогаем');
	rebalance(s, 'pricier', NOW);
	rebalance(s, 'pricier', NOW);
	assert.ok(s.economy.tune > 1);
});

test('на пределе поправки предлагается пересобрать, а не крутить дальше', () => {
	const s = S();
	s.economy.tune = TUNE_LIMITS[0];
	const r = rebalance(s, 'cheaper', NOW);
	assert.equal(r.applied, false);
	assert.match(r.report, /пределе/);
});

test('при подкрутке подсказывается честный путь, если данные есть', () => {
	const withData = rebalance(S({ history: earned(20, 50) }), 'cheaper', NOW);
	assert.match(withData.report, /пересчитай по факту/);
	const without = rebalance(S(), 'cheaper', NOW);
	assert.doesNotMatch(without.report, /пересчитай по факту/);
});

test('отчёт показывает новые цены', () => {
	const r = rebalance(S({ history: earned(20, 50) }), 'solve', NOW);
	assert.match(r.report, /Серия/);
	assert.match(r.report, /Прогулка/);
});

/* ── поиск задачи по обрывку названия ──────────────────────────────────── */

const tasks = [
	{ id: 'a', title: 'Дожать отчёт по кварталу' },
	{ id: 'b', title: 'Созвон с подрядчиком' },
	{ id: 'c', title: 'Зарядка' },
];

test('задача находится по части названия', () => {
	assert.equal(findTask(tasks, 'отчёт').id, 'a');
	assert.equal(findTask(tasks, 'Зарядка').id, 'c');
	assert.equal(findTask(tasks, 'созвон с подрядчиком').id, 'b');
	assert.equal(findTask(tasks, 'дожать').id, 'a');
});

test('регистр и ё не мешают', () => {
	assert.equal(findTask(tasks, 'ОТЧЕТ').id, 'a');
	assert.equal(findTask(tasks, '  зарядка  ').id, 'c');
});

test('находится по нескольким словам вразнобой', () => {
	assert.equal(findTask(tasks, 'отчёт квартал').id, 'a');
});

test('при неоднозначности лучше промолчать, чем поправить не ту', () => {
	const two = [{ id: 'x', title: 'Отчёт недельный' }, { id: 'y', title: 'Отчёт квартальный' }];
	assert.equal(findTask(two, 'отчёт'), null);
});

test('пустой и несуществующий запрос ничего не находит', () => {
	assert.equal(findTask(tasks, ''), null);
	assert.equal(findTask(tasks, 'полить кактус'), null);
	assert.equal(findTask([], 'что угодно'), null);
});
