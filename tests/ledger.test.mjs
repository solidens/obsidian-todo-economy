import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buy, checkBuy, earn, penalize, pruneGranted, rollover, undo } from '../.test-build/core/ledger.js';
import { DEFAULT_STATE } from '../.test-build/core/types.js';

const S = (over = {}) => {
	const s = structuredClone(DEFAULT_STATE);
	s.economy = { k: 10, monthlyIncome: 1000, dayCap: 200, softCap: 900 };
	s.day = { key: '2026-08-06', earned: 0 };
	s.week = { key: '2026-W32', harm: {} };
	s.decayedOn = '2026-08-06';
	return Object.assign(s, over);
};

const T = (over = {}) => ({
	id: 't1', title: 'Отчёт', min: 90, diff: 1.2, prio: 1.3,
	done: false, indent: '', extra: [], line: 0, ...over,
});

const TODAY = '2026-08-06';

test('закрытие начисляет и заводит серию', () => {
	const s = S();
	const got = earn(s, T(), TODAY);
	assert.equal(s.streak.days, 1);
	assert.equal(s.balance, got);
	assert.equal(s.day.earned, got);
	assert.equal(got, 146, 'award 140 × серия 1.043');
});

test('откат ровно на ту же сумму, даже если условия изменились', () => {
	const s = S();
	const got = earn(s, T(), TODAY);
	s.streak.days = 7;
	s.economy.dayCap = 1;
	const back = undo(s, T());
	assert.equal(back, got);
	assert.equal(s.balance, 0);
	assert.equal(s.day.earned, 0);
});

test('повторный откат ничего не списывает', () => {
	const s = S();
	earn(s, T(), TODAY);
	undo(s, T());
	assert.equal(undo(s, T()), 0);
	assert.equal(s.balance, 0);
});

test('дневной потолок обрезает начисление', () => {
	const s = S({ economy: { k: 10, monthlyIncome: 1000, dayCap: 200, softCap: 900 } });
	earn(s, T({ id: 'a' }), TODAY);
	const second = earn(s, T({ id: 'b' }), TODAY);
	assert.equal(s.day.earned, 200);
	assert.equal(second, 54);
	assert.ok(s.history[0].note.includes('потолок'));
});

test('серия продолжается день в день и рвётся на пропуске', () => {
	const s = S({ streak: { days: 3, lastDone: '2026-08-05' } });
	earn(s, T(), '2026-08-06');
	assert.equal(s.streak.days, 4);

	const b = S({ streak: { days: 3, lastDone: '2026-08-01' }, day: { key: '2026-08-01', earned: 0 } });
	earn(b, T(), '2026-08-06');
	assert.equal(b.streak.days, 1, 'пропущенные дни обнуляют серию');
});

test('вторая задача за день не наращивает серию повторно', () => {
	const s = S();
	earn(s, T({ id: 'a' }), TODAY);
	earn(s, T({ id: 'b' }), TODAY);
	assert.equal(s.streak.days, 1);
});

test('смена суток обнуляет дневной счётчик и жжёт излишек', () => {
	const s = S({ balance: 1000, day: { key: '2026-08-05', earned: 180 }, decayedOn: '2026-08-05' });
	rollover(s, '2026-08-06');
	assert.equal(s.day.key, '2026-08-06');
	assert.equal(s.day.earned, 0);
	assert.equal(s.balance, 995);
	assert.equal(s.history[0].kind, 'decay');
});

test('сгорание внутри одних суток не повторяется', () => {
	const s = S({ balance: 1000, day: { key: '2026-08-05', earned: 0 }, decayedOn: '2026-08-05' });
	rollover(s, '2026-08-06');
	const after = s.balance;
	rollover(s, '2026-08-06');
	rollover(s, '2026-08-06');
	assert.equal(s.balance, after);
});

test('смена недели обнуляет счётчик вредного', () => {
	const s = S({ week: { key: '2026-W01', harm: { r1: 2 } } });
	rollover(s, TODAY);
	assert.deepEqual(s.week.harm, {});
});

const R = (over = {}) => ({ id: 'r1', title: 'Серия', value: 2, harm: 1, freq: 8, kind: 'normal', ...over });

test('покупка требует закрытой сегодня задачи', () => {
	const s = S({ balance: 500 });
	assert.deepEqual(checkBuy(s, R(), false).reason, 'сначала закрой задачу');
	assert.equal(checkBuy(s, R(), true).ok, true);
});

test('восстановительное не блокируется требованием закрыть задачу', () => {
	const s = S({ balance: 500 });
	const отдых = R({ id: 'r2', title: 'Прогулка', kind: 'restore', harm: 0.7 });
	assert.equal(checkBuy(s, отдых, false).ok, true);
});

test('строгий режим снимает поблажку восстановительному', () => {
	const s = S({ balance: 500, strictRestore: true });
	const отдых = R({ id: 'r2', kind: 'restore', harm: 0.7 });
	assert.equal(checkBuy(s, отдых, false).ok, false);
});

test('недельный лимит сильнее полного кошелька', () => {
	const s = S({ balance: 100000, week: { key: '2026-W32', harm: { r3: 2 } } });
	const лента = R({ id: 'r3', kind: 'harmful', harm: 3, weeklyCap: 2 });
	const c = checkBuy(s, лента, true);
	assert.equal(c.ok, false);
	assert.equal(c.reason, 'лимит недели выбран');
});

test('не хватает баллов — причина называет недостачу', () => {
	const s = S({ balance: 3 });
	const c = checkBuy(s, R(), true);
	assert.equal(c.ok, false);
	assert.equal(c.reason, `не хватает ${c.price - 3}`);
});

test('покупка списывает и считает вредное за неделю', () => {
	const s = S({ balance: 500 });
	const лента = R({ id: 'r3', kind: 'harmful', harm: 3, weeklyCap: 2 });
	const paid = buy(s, лента, TODAY);
	assert.equal(s.balance, 500 - paid);
	assert.equal(s.week.harm.r3, 1);
	assert.equal(s.history[0].kind, 'spend');
});

test('штраф за просрочку списывается один раз', () => {
	const s = S({ balance: 100 });
	const t = T({ prio: 1.6, due: '2026-08-01' });
	const first = penalize(s, t, TODAY);
	assert.ok(first > 0);
	assert.equal(penalize(s, t, TODAY), 0);
	assert.equal(s.balance, 100 - first);
});

test('неважное не штрафуется', () => {
	const s = S({ balance: 100 });
	assert.equal(penalize(s, T({ prio: 1, due: '2026-08-01' }), TODAY), 0);
	assert.equal(s.balance, 100);
});

test('пропавшие задачи не копятся в начислениях, штрафы остаются', () => {
	const s = S();
	earn(s, T({ id: 'alive' }), TODAY);
	earn(s, T({ id: 'gone' }), TODAY);
	penalize(s, T({ id: 'alive', prio: 2, due: '2026-08-01' }), TODAY);
	pruneGranted(s, new Set(['alive']));
	assert.ok(s.granted.alive);
	assert.equal(s.granted.gone, undefined);
	assert.ok(Object.keys(s.granted).some((k) => k.startsWith('penalty:')));
});

test('история не растёт бесконечно', () => {
	const s = S();
	for (let i = 0; i < 300; i++) {
		earn(s, T({ id: `t${i}` }), TODAY);
		undo(s, T({ id: `t${i}` }));
	}
	assert.equal(s.history.length, 200);
});
