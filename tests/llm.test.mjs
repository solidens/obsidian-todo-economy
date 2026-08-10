import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, isValidKey, messageForStatus, scrubSecrets } from '../.test-build/llm/parse.js';
import { toRewards, toRoutine, toTask, toWorkdays } from '../.test-build/core/intake.js';

const KEY = 'sk-or-v1-' + 'a1b2c3d4e5'.repeat(3);

/* ── ключ ──────────────────────────────────────────────────────────────── */

test('ключ принимается только по форме', () => {
	assert.equal(isValidKey(KEY), true);
	assert.equal(isValidKey('  ' + KEY + ' '), true);
	assert.equal(isValidKey('sk-or-v1-короткий'), false);
	assert.equal(isValidKey('sk-ant-api03-' + 'x'.repeat(40)), false);
	assert.equal(isValidKey(''), false);
	assert.equal(isValidKey('мой ключ'), false);
});

/* ── ключ не должен всплывать в ответах ────────────────────────────────── */

test('ключ вычищается из эха провайдера', () => {
	const echo = `No auth credentials found for key ${KEY}. Check your settings.`;
	const out = scrubSecrets(echo, KEY);
	assert.ok(!out.includes(KEY));
	assert.ok(out.includes('sk-or-v1-…'));
});

test('ключ вычищается, даже если он не тот, что передан', () => {
	const other = 'sk-or-v1-' + 'z'.repeat(30);
	const out = scrubSecrets(`утекло: ${other}`);
	assert.ok(!out.includes(other));
});

test('подчистка не портит обычный текст', () => {
	assert.equal(scrubSecrets('Завёл задачу на 90 минут.'), 'Завёл задачу на 90 минут.');
});

/* ── разбор ответа модели ──────────────────────────────────────────────── */

test('json достаётся из markdown-обёртки', () => {
	const j = extractJson('```json\n{"kind":"task","title":"Отчёт"}\n```');
	assert.equal(j.title, 'Отчёт');
});

test('json достаётся из болтовни вокруг', () => {
	const j = extractJson('Конечно! Вот результат:\n{"kind":"none"}\nНадеюсь, помог.');
	assert.equal(j.kind, 'none');
});

test('вложенные скобки и строки не сбивают разбор', () => {
	const j = extractJson('шум {"title":"скобка } внутри","meta":{"a":[1,2]}} хвост');
	assert.equal(j.title, 'скобка } внутри');
	assert.deepEqual(j.meta.a, [1, 2]);
});

test('массив верхнего уровня тоже читается', () => {
	assert.deepEqual(extractJson('[{"a":1}]'), [{ a: 1 }]);
});

test('невалидный ответ не применяется', () => {
	assert.equal(extractJson('я не понял вопрос'), null);
	assert.equal(extractJson('{сломано]'), null);
	assert.equal(extractJson(''), null);
});

/* ── коды ответа ───────────────────────────────────────────────────────── */

test('401 и 403 останавливают каскад, 429 и 5xx — нет', () => {
	assert.equal(messageForStatus(401).retry, false);
	assert.equal(messageForStatus(403).retry, false);
	assert.equal(messageForStatus(402).retry, false);
	assert.equal(messageForStatus(429).retry, true);
	assert.equal(messageForStatus(503).retry, true);
	assert.equal(messageForStatus(418).retry, true);
});

test('текст провайдера наружу не идёт', () => {
	for (const code of [400, 401, 402, 429, 500]) {
		const m = messageForStatus(code).message;
		assert.ok(m.length > 0 && !m.includes('sk-or'));
	}
});

/* ── превращение в доменные объекты ────────────────────────────────────── */

test('задача разбирается и зажимается', () => {
	const t = toTask({ title: 'Отчёт', min: '90', diff: 5, prio: '1,4', due: '2026-08-08' });
	assert.equal(t.title, 'Отчёт');
	assert.equal(t.min, 90);
	assert.equal(t.diff, 2);
	assert.equal(t.prio, 1.4);
	assert.equal(t.due, '2026-08-08');
});

test('срок принимается только в правильном формате', () => {
	assert.equal(toTask({ title: 'a', due: 'завтра' }).due, undefined);
	assert.equal(toTask({ title: 'a', due: '08.08.2026' }).due, undefined);
});

test('задача без названия отбрасывается', () => {
	assert.equal(toTask({ min: 90 }), null);
	assert.equal(toTask('строка'), null);
	assert.equal(toTask(null), null);
});

test('обратные кавычки и переводы строк не уезжают в файл', () => {
	const t = toTask({ title: 'a `te 1m` \n b' });
	assert.ok(!t.title.includes('`'));
	assert.ok(!t.title.includes('\n'));
});

test('список дел читается и из массива, и из обёртки', () => {
	const rows = [{ title: 'a', min: 60, perWeek: 5 }, { title: 'b', min: 30, perWeek: 2 }];
	assert.equal(toRoutine(rows).length, 2);
	assert.equal(toRoutine({ routine: rows }).length, 2);
	assert.equal(toRoutine('чепуха').length, 0);
});

test('частота в неделю зажимается', () => {
	assert.equal(toRoutine([{ title: 'a', perWeek: 900 }])[0].perWeek, 21);
	assert.equal(toRoutine([{ title: 'a', perWeek: 0 }])[0].perWeek, 0.25);
});

test('вид награды узнаётся и по-русски', () => {
	const rs = toRewards([
		{ title: 'Прогулка', kind: 'восстановление' },
		{ title: 'Лента', kind: 'вредное', harm: 2.4 },
		{ title: 'Кофе', kind: 'normal' },
	], 'normal');
	assert.equal(rs[0].harm, 0.7);
	assert.equal(rs[1].kind, 'harmful');
	assert.equal(rs[1].harm, 2.4);
	assert.equal(rs[2].harm, 1);
});

test('вредное получает недельный лимит по умолчанию', () => {
	const [r] = toRewards([{ title: 'Лента' }], 'harmful');
	assert.equal(r.kind, 'harmful');
	assert.equal(r.weeklyCap, 2);
	const [n] = toRewards([{ title: 'Кофе' }], 'normal');
	assert.equal(n.weeklyCap, undefined);
});

test('повторы наград не заводятся дважды', () => {
	const existing = [{ id: 'x', title: 'Серия', value: 2, harm: 1, freq: 8, kind: 'normal' }];
	assert.equal(toRewards([{ title: 'серия' }, { title: 'Кофе' }], 'normal', existing).length, 1);
});

test('у каждой награды свой идентификатор', () => {
	const rs = toRewards([{ title: 'a' }, { title: 'b' }, { title: 'c' }], 'normal');
	assert.equal(new Set(rs.map((r) => r.id)).size, 3);
});

test('рабочие дни зажимаются в неделю', () => {
	assert.equal(toWorkdays({ workdays: 5 }), 5);
	assert.equal(toWorkdays({ days: 99 }), 7);
	assert.equal(toWorkdays({ workdays: 0 }), 1);
	assert.equal(toWorkdays({}), null);
});

test('regularity подхватывается из фразы, когда модель её потеряла', () => {
	assert.equal(toTask({ title: 'Зарядка', min: 10 }, 'зарядка каждый день по утрам').repeat, 1);
	assert.equal(toTask({ title: 'читать каждый день по 30 минут' }).repeat, 1);
	assert.equal(toTask({ title: 'Отчёт', min: 90 }, 'дожать отчёт к пятнице').repeat, undefined);
});

test('явный repeat от модели важнее догадки по фразе', () => {
	assert.equal(toTask({ title: 'Зал', repeat: 2 }, 'ходить в зал каждый день').repeat, 2);
});
