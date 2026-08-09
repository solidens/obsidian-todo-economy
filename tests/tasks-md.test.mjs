import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULTS, insertTask, parseTasks, readState, removeLine, replaceLines, serializeTask, writeState,
} from '../.test-build/core/tasks-md.js';

test('разбирает строку со всеми полями', () => {
	const [t] = parseTasks('- [ ] Дожать отчёт `te 90m d1.2 p1.3 due2026-08-08 ~k3f9x2`');
	assert.equal(t.title, 'Дожать отчёт');
	assert.equal(t.min, 90);
	assert.equal(t.diff, 1.2);
	assert.equal(t.prio, 1.3);
	assert.equal(t.due, '2026-08-08');
	assert.equal(t.id, 'k3f9x2');
	assert.equal(t.done, false);
	assert.equal(t.adopted, false);
});

test('голая галочка усыновляется со значениями по умолчанию', () => {
	const [t] = parseTasks('- [ ] Купить хлеб');
	assert.equal(t.title, 'Купить хлеб');
	assert.equal(t.min, DEFAULTS.min);
	assert.equal(t.adopted, true);
	assert.ok(t.id.length >= 4, 'усыновлённой задаче выдаётся идентификатор');
});

test('закрытая галочка читается в обоих регистрах', () => {
	assert.equal(parseTasks('- [x] a')[0].done, true);
	assert.equal(parseTasks('- [X] a')[0].done, true);
	assert.equal(parseTasks('- [ ] a')[0].done, false);
});

test('поддерживает разные маркеры и вложенность', () => {
	const src = ['- [ ] один', '  * [ ] два', '\t+ [ ] три', '1. [ ] четыре', '2) [ ] пять'].join('\n');
	const ts = parseTasks(src);
	assert.equal(ts.length, 5);
	assert.equal(ts[1].indent, '  ');
	assert.equal(ts[1].bullet, '*');
	assert.equal(ts[3].bullet, '1.');
});

test('не трогает галочки внутри блока кода', () => {
	const src = ['- [ ] настоящая', '```', '- [ ] пример из документации', '```', '- [ ] тоже настоящая'].join('\n');
	const ts = parseTasks(src);
	assert.equal(ts.length, 2);
	assert.deepEqual(ts.map((t) => t.title), ['настоящая', 'тоже настоящая']);
});

test('не считает задачей строку без текста', () => {
	assert.equal(parseTasks('- [ ]   ').length, 0);
});

test('обычные строки файла игнорируются', () => {
	const src = ['# Заголовок', '', 'Просто абзац с [[ссылкой]].', '- обычный пункт списка', '- [ ] задача'].join('\n');
	assert.equal(parseTasks(src).length, 1);
});

test('незнакомые токены переживают запись', () => {
	const [t] = parseTasks('- [ ] Задача `te 45m d1 p1 repeat:weekly #проект ~aaaa11`');
	assert.ok(t.extra.includes('repeat:weekly'));
	assert.ok(t.extra.includes('#проект'));
	const out = serializeTask(t);
	assert.ok(out.includes('repeat:weekly'));
	assert.ok(out.includes('#проект'));
});

test('запись обратима', () => {
	const line = '- [ ] Дожать отчёт `te 90m d1.2 p1.3 due2026-08-08 ~k3f9x2`';
	const once = serializeTask(parseTasks(line)[0]);
	const twice = serializeTask(parseTasks(once)[0]);
	assert.equal(once, twice);
	assert.equal(once, line);
});

test('дата закрытия пишется только у закрытой задачи', () => {
	const [t] = parseTasks('- [ ] a `te 30m d1 p1 ~aaaa11`');
	t.done = true;
	t.doneOn = '2026-08-06';
	assert.ok(serializeTask(t).includes('done2026-08-06'));
	t.done = false;
	assert.ok(!serializeTask(t).includes('done2026-08-06'));
});

test('одинаковые идентификаторы разводятся', () => {
	const src = ['- [ ] a `te 30m d1 p1 ~dupdup`', '- [ ] b `te 30m d1 p1 ~dupdup`'].join('\n');
	const ts = parseTasks(src);
	assert.notEqual(ts[0].id, ts[1].id);
	assert.ok(ts[1].adopted, 'переписанная строка помечена на дозапись');
});

test('значения за границами зажимаются при чтении', () => {
	const [t] = parseTasks('- [ ] a `te 9999m d99 p0.01 ~aaaa11`');
	assert.equal(t.min, 480);
	assert.equal(t.diff, 2);
	assert.equal(t.prio, 0.5);
});

test('правка строк не задевает остальной файл', () => {
	const src = ['# Заголовок', '', 'Абзац.', '- [ ] a `te 30m d1 p1 ~aaaa11`', '', '> цитата'].join('\n');
	const out = replaceLines(src, new Map([[3, '- [x] a `te 30m d1 p1 done2026-08-06 ~aaaa11`']]));
	const lines = out.split('\n');
	assert.equal(lines[0], '# Заголовок');
	assert.equal(lines[2], 'Абзац.');
	assert.equal(lines[5], '> цитата');
	assert.ok(lines[3].startsWith('- [x]'));
});

test('пустая правка возвращает исходный текст без изменений', () => {
	const src = 'a\nb\nc';
	assert.equal(replaceLines(src, new Map()), src);
});

test('новая задача встаёт после последней существующей', () => {
	const src = ['# Заголовок', '- [ ] a `te 30m d1 p1 ~aaaa11`', '', 'Заметка внизу.'].join('\n');
	const out = insertTask(src, '- [ ] новая `te 30m d1 p1 ~bbbb22`').split('\n');
	assert.ok(out[2].includes('новая'));
	assert.equal(out[4], 'Заметка внизу.');
});

test('в файле без задач новая уходит в конец', () => {
	const out = insertTask('# Заголовок\n\nТекст.', '- [ ] новая').split('\n');
	assert.equal(out[out.length - 1], '- [ ] новая');
});

test('удаление убирает ровно одну строку', () => {
	const src = ['- [ ] a', 'текст', '- [ ] b'].join('\n');
	assert.equal(removeLine(src, 0), 'текст\n- [ ] b');
	assert.equal(removeLine(src, 99), src);
});

test('номера строк совпадают с файлом', () => {
	const src = ['', '# h', '- [ ] a', '', '- [ ] b'].join('\n');
	const ts = parseTasks(src);
	assert.equal(ts[0].line, 2);
	assert.equal(ts[1].line, 4);
});

/* ── блок состояния ────────────────────────────────────────────────────── */

test('в файле без блока состояние не читается', () => {
	assert.equal(readState('# Дела\n\n- [ ] a\n'), null);
});

test('блок состояния читается и не портит парсинг задач', () => {
	const withState = writeState('- [ ] a\n', JSON.stringify({ balance: 40 }));
	const ts = parseTasks(withState);
	assert.equal(ts.length, 1, 'блок состояния не принимается за задачу');
	assert.deepEqual(readState(withState), { balance: 40 });
});

test('повторная запись переписывает блок на месте, а не дублирует', () => {
	let text = '# Дела\n\n- [ ] a\n';
	text = writeState(text, JSON.stringify({ balance: 10 }));
	const afterFirst = text;
	text = writeState(text, JSON.stringify({ balance: 55, streak: 3 }));

	assert.deepEqual(readState(text), { balance: 55, streak: 3 });
	assert.equal((text.match(/```te-state/g) || []).length, 1, 'блок ровно один');
	assert.equal(text.split('\n').length, afterFirst.split('\n').length, 'число строк не растёт при переписи');
});

test('запись блока не трогает остальной файл', () => {
	const src = ['# Заголовок', '', 'Абзац.', '- [ ] a `te 30m d1 p1 ~aaaa11`'].join('\n');
	const out = writeState(src, JSON.stringify({ balance: 1 })).split('\n');
	assert.equal(out[0], '# Заголовок');
	assert.equal(out[2], 'Абзац.');
	assert.ok(out[3].startsWith('- [ ] a'));
});

test('битый JSON в блоке не роняет чтение', () => {
	const src = '- [ ] a\n```te-state\n{не json\n```\n';
	assert.equal(readState(src), null);
	assert.equal(parseTasks(src).length, 1, 'задача снаружи блока всё равно читается');
});
