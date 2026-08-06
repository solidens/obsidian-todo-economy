import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	award, decayAmount, estimateMonthlyIncome, penaltyFor, price, round5,
	sane, solveK, streakMult, suggestDayCap, suggestSoftCap,
} from '../.test-build/core/economy.js';

test('начисление зажимает минуты в 10…120', () => {
	assert.equal(award({ min: 5, diff: 1, prio: 1 }), 10);
	assert.equal(award({ min: 600, diff: 1, prio: 1 }), 120);
	assert.equal(award({ min: 90, diff: 1.2, prio: 1.3 }), 140);
});

test('начисление зажимает произведение сложности и приоритета в 0.6…2.8', () => {
	assert.equal(award({ min: 100, diff: 0.5, prio: 0.5 }), 60);
	assert.equal(award({ min: 100, diff: 2, prio: 2 }), 280);
});

test('сложность и длительность — разные вещи', () => {
	const посуда = award({ min: 120, diff: 0.6, prio: 0.8 });
	const отчёт = award({ min: 60, diff: 1.8, prio: 1.6 });
	assert.ok(отчёт > посуда, 'час тяжёлого должен стоить больше двух часов механики');
});

test('цена округляется до пятёрки и не опускается ниже пяти', () => {
	assert.equal(price({ value: 2, harm: 1 }, 10), 20);
	assert.equal(price({ value: 1, harm: 1 }, 12.4), 10);
	assert.equal(price({ value: 0.2, harm: 0.7 }, 0.1), 5);
	assert.equal(round5(12.4), 10);
	assert.equal(round5(12.5), 15);
});

test('замыкание: приход сходится с тратами', () => {
	const rewards = [
		{ id: 'a', title: 'a', value: 2, harm: 1, freq: 12, kind: 'normal' },
		{ id: 'b', title: 'b', value: 1, harm: 3, freq: 4, kind: 'harmful' },
		{ id: 'c', title: 'c', value: 0.8, harm: 0.7, freq: 20, kind: 'restore' },
	];
	const income = 3000;
	const k = solveK(income, rewards);
	const spend = rewards.reduce((s, r) => s + r.freq * k * r.value * r.harm, 0);
	assert.ok(Math.abs(spend - 0.85 * income * 0.75) < 1e-6);
});

test('замыкание не делит на ноль', () => {
	assert.equal(solveK(1000, []), 0);
	assert.equal(solveK(0, [{ value: 1, harm: 1, freq: 1 }]), 0);
});

test('вредное выходит дороже нейтрального при той же ценности', () => {
	const k = 20;
	const плохое = price({ value: 1.4, harm: 3 }, k);
	const обычное = price({ value: 1.4, harm: 1 }, k);
	const отдых = price({ value: 1.4, harm: 0.7 }, k);
	assert.ok(плохое > обычное && обычное > отдых);
});

test('серия даёт не больше ×1.3', () => {
	assert.equal(streakMult(0), 1);
	assert.ok(streakMult(1) > 1 && streakMult(1) < 1.1);
	assert.equal(streakMult(7), 1.3);
	assert.equal(streakMult(90), 1.3);
});

test('излишек сгорает только выше порога', () => {
	assert.equal(decayAmount(500, 900, 10), 0);
	assert.equal(decayAmount(1000, 900, 1), 5);
	assert.ok(decayAmount(1000, 900, 5) > decayAmount(1000, 900, 1));
	assert.ok(decayAmount(5000, 900, 3650) < 5000, 'сгорание не уводит баланс в минус');
});

test('штраф только за важное и в разумных пределах', () => {
	assert.equal(penaltyFor({ min: 60, diff: 1, prio: 1, title: '', id: '' }), 0);
	assert.equal(penaltyFor({ min: 15, diff: 0.6, prio: 1.4, title: '', id: '' }), 5);
	assert.equal(penaltyFor({ min: 120, diff: 2, prio: 2, title: '', id: '' }), 40);
});

test('месячный приход считается по типичной неделе', () => {
	const p = { workdays: 5, routine: [{ title: 'x', min: 60, diff: 1, prio: 1, perWeek: 5 }] };
	assert.equal(estimateMonthlyIncome(p), 1300);
	assert.equal(suggestDayCap(1300, 5), 90);
	assert.equal(suggestSoftCap(1300), 650);
});

test('границы не пускают мусор из модели', () => {
	assert.equal(sane.prio(10), 2);
	assert.equal(sane.prio(-3), 0.5);
	assert.equal(sane.diff(Number.NaN), 0.5);
	assert.equal(sane.min(1e9), 480);
	assert.equal(sane.harm(99), 3);
	assert.equal(sane.value('нет'), 0.2);
});
