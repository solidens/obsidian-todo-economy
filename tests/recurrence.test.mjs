import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	describeRepeat, detectRepeat, nextDue, repeatBadge, rollRecurring, saneRepeat, shouldReopen,
} from '../.test-build/core/recurrence.js';
import { addDays } from '../.test-build/core/time.js';
import { parseTasks, serializeTask } from '../.test-build/core/tasks-md.js';

const T = (over = {}) => ({
	id: 't1', title: 'Зарядка', min: 20, diff: 0.8, prio: 1.2,
	done: false, indent: '', extra: [], line: 0, ...over,
});

/* ── интервал ──────────────────────────────────────────────────────────── */

test('интервал зажимается, мусор отбрасывается', () => {
	assert.equal(saneRepeat(1), 1);
	assert.equal(saneRepeat('2'), 2);
	assert.equal(saneRepeat(2.4), 2);
	assert.equal(saneRepeat(0), undefined);
	assert.equal(saneRepeat(-3), undefined);
	assert.equal(saneRepeat(9999), undefined);
	assert.equal(saneRepeat('каждый день'), undefined);
	assert.equal(saneRepeat(null), undefined);
});

/* ── когда возвращается ────────────────────────────────────────────────── */

test('ежедневная остаётся закрытой до конца суток', () => {
	const t = T({ repeat: 1, done: true, doneOn: '2026-08-06' });
	assert.equal(shouldReopen(t, '2026-08-06'), false, 'сегодня уже сделано — пусть будет видно');
	assert.equal(shouldReopen(t, '2026-08-07'), true);
});

test('через день возвращается на второй день', () => {
	const t = T({ repeat: 2, done: true, doneOn: '2026-08-06' });
	assert.equal(shouldReopen(t, '2026-08-07'), false);
	assert.equal(shouldReopen(t, '2026-08-08'), true);
});

test('пропущенные дни не копят долг: возвращается один раз', () => {
	const t = T({ repeat: 2, done: true, doneOn: '2026-08-01' });
	assert.equal(shouldReopen(t, '2026-08-20'), true);
	const [back] = rollRecurring([t], '2026-08-20');
	assert.equal(back.done, false);
	assert.equal(back.due, '2026-08-03', 'срок от дня выполнения, а не веер просрочек');
});

test('обычная задача не возвращается никогда', () => {
	assert.equal(shouldReopen(T({ done: true, doneOn: '2026-08-01' }), '2027-01-01'), false);
	assert.equal(rollRecurring([T({ done: true, doneOn: '2026-08-01' })], '2027-01-01').length, 0);
});

test('открытая повторяющаяся не трогается', () => {
	assert.equal(rollRecurring([T({ repeat: 1, done: false })], '2026-08-07').length, 0);
});

test('следующий срок считается от дня выполнения', () => {
	assert.equal(nextDue(T({ repeat: 1 }), '2026-08-06'), '2026-08-07');
	assert.equal(nextDue(T({ repeat: 7 }), '2026-08-06'), '2026-08-13');
	assert.equal(nextDue(T({ repeat: 3 }), '2026-08-30'), '2026-09-02', 'через границу месяца');
	assert.equal(nextDue(T({ repeat: 2 }), '2026-12-31'), '2027-01-02', 'через границу года');
});

test('открытие заново чистит дату выполнения', () => {
	const t = T({ repeat: 1, done: true, doneOn: '2026-08-06' });
	rollRecurring([t], '2026-08-07');
	assert.equal(t.done, false);
	assert.equal(t.doneOn, undefined);
	assert.equal(t.due, '2026-08-07');
});

test('сдвиг дат переживает високосный год', () => {
	assert.equal(addDays('2028-02-28', 1), '2028-02-29');
	assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

/* ── формат в файле ────────────────────────────────────────────────────── */

test('повтор читается из файла', () => {
	const [t] = parseTasks('- [ ] Зарядка `te 20m d0.8 p1.2 rep1d ~aaaa11`');
	assert.equal(t.repeat, 1);
	assert.equal(parseTasks('- [ ] a `te 20m d1 p1 rep2d ~aaaa11`')[0].repeat, 2);
	assert.equal(parseTasks('- [ ] a `te 20m d1 p1 rep2w ~aaaa11`')[0].repeat, 14);
});

test('запись повтора обратима', () => {
	const line = '- [ ] Зарядка `te 20m d0.8 p1.2 rep1d ~aaaa11`';
	assert.equal(serializeTask(parseTasks(line)[0]), line);
	const weekly = '- [ ] Уборка `te 60m d1 p1 rep2w ~bbbb22`';
	assert.equal(serializeTask(parseTasks(weekly)[0]), weekly);
});

test('бессмысленный интервал в файле игнорируется, но строка не ломается', () => {
	const [t] = parseTasks('- [ ] a `te 20m d1 p1 rep0d ~aaaa11`');
	assert.equal(t.repeat, undefined);
	assert.ok(!serializeTask(t).includes('rep'));
});

test('обычная задача не обзаводится повтором из ниоткуда', () => {
	const [t] = parseTasks('- [ ] a `te 20m d1 p1 ~aaaa11`');
	assert.equal(t.repeat, undefined);
	assert.ok(!serializeTask(t).includes('rep'));
});

/* ── как это называется ────────────────────────────────────────────────── */

test('интервал называется по-человечески', () => {
	assert.equal(describeRepeat(1), 'каждый день');
	assert.equal(describeRepeat(2), 'через день');
	assert.equal(describeRepeat(7), 'раз в неделю');
	assert.equal(describeRepeat(14), 'раз в две недели');
	assert.equal(describeRepeat(3), 'раз в 3 дн.');
	assert.equal(describeRepeat(undefined), '');
	assert.equal(repeatBadge(1), 'ежедн.');
	assert.equal(repeatBadge(21), '3нед');
	assert.equal(repeatBadge(undefined), '');
});

/* ── регулярность из фразы ─────────────────────────────────────────────── */

test('интервал вычитывается из фразы', () => {
	assert.equal(detectRepeat('читать каждый день по 30 минут'), 1);
	assert.equal(detectRepeat('Зарядка по утрам'), 1);
	assert.equal(detectRepeat('ходить в зал через день'), 2);
	assert.equal(detectRepeat('убираться раз в неделю'), 7);
	assert.equal(detectRepeat('созвон раз в две недели'), 14);
	assert.equal(detectRepeat('мыть миски раз в 3 дня'), 3);
	assert.equal(detectRepeat('бассейн 2 раза в неделю'), 4);
	assert.equal(detectRepeat('платить за квартиру раз в месяц'), 30);
});

test('«через день» не путается с «каждый день»', () => {
	assert.equal(detectRepeat('через день зарядка каждый день не выйдет'), 2);
});

test('разовое дело интервала не получает', () => {
	assert.equal(detectRepeat('дожать отчёт к пятнице'), undefined);
	assert.equal(detectRepeat('весь день делать презентацию'), undefined);
	assert.equal(detectRepeat(null), undefined);
	assert.equal(detectRepeat(42), undefined);
});

test('ё не мешает разбору', () => {
	assert.equal(detectRepeat('ЕЖЕДНЕВНО гулять'), 1);
});

/* ── регулярность по-английски ─────────────────────────────────────────── */

test('английские фразы тоже дают интервал', () => {
	assert.equal(detectRepeat('read every day for 30 minutes'), 1);
	assert.equal(detectRepeat('Morning workout, daily'), 1);
	assert.equal(detectRepeat('gym every other day'), 2);
	assert.equal(detectRepeat('clean the flat weekly'), 7);
	assert.equal(detectRepeat('call mum every two weeks'), 14);
	assert.equal(detectRepeat('water the plants every 3 days'), 3);
	assert.equal(detectRepeat('swim 2 times a week'), 4);
	assert.equal(detectRepeat('pay rent monthly'), 30);
	assert.equal(detectRepeat('finish the report by Friday'), undefined);
});
