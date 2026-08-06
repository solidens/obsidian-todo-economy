/**
 * Связка целиком: хранилище, файл задач и чат — с подменённым Obsidian
 * и подменённой сетью. Ловит то, что не поймают тесты чистых функций:
 * порядок записи, сохранность чужого текста, работу онбординга.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlugin, makeVault, setNet, Notice } from './fake-obsidian.mjs';
import { Store } from '../.test-build/wired/store.js';
import { Brain } from '../.test-build/wired/brain.js';

globalThis.window ??= globalThis;

const KEY = 'sk-or-v1-' + 'a1b2c3d4e5'.repeat(3);
const FILE = 'ТУДУ.md';

const answer = (content) => ({
	status: 200,
	json: { choices: [{ message: { content } }] },
});

/** Рейтинг моделей отдаём пустой, ответ модели — по сценарию. */
function serve(content) {
	setNet(async (opts) => {
		if (opts.url.includes('shir-man')) return { status: 500, json: {} };
		return typeof content === 'function' ? content(opts) : answer(content);
	});
}

async function fresh(initial = {}) {
	const vault = makeVault(initial);
	const plugin = makePlugin(vault);
	const store = new Store(plugin);
	await store.load();
	return { vault, plugin, store };
}

/* ── файл ──────────────────────────────────────────────────────────────── */

test('без явного действия файл не создаётся', async () => {
	const { vault, store } = await fresh();
	assert.equal(vault.files.size, 0);
	assert.equal(store.missing, true);
	assert.deepEqual(store.tasks, []);
});

test('файл создаётся один раз и переиспользуется', async () => {
	const { vault, store } = await fresh();
	const a = await store.ensureFile();
	const b = await store.ensureFile();
	assert.equal(a.path, FILE);
	assert.equal(b.path, FILE);
	assert.equal(vault.files.size, 1);
});

test('новая задача становится строкой в файле', async () => {
	const { vault, store } = await fresh();
	const id = await store.addTask({ title: 'Дожать отчёт', min: 90, diff: 1.2, prio: 1.3 });
	const text = vault.files.get(FILE);
	assert.ok(text.includes('- [ ] Дожать отчёт'));
	assert.ok(text.includes(`~${id}`));
	assert.equal(store.tasks.length, 1);
	assert.equal(store.tasks[0].min, 90);
});

test('чужой текст в файле переживает правку задачи', async () => {
	const before = [
		'# Мои дела',
		'',
		'Заметка про [[проект]] и `код`.',
		'',
		'- [ ] Отчёт `te 90m d1.2 p1.3 ~aaaa11`',
		'',
		'> цитата снизу',
		'',
		'```',
		'- [ ] это пример, не задача',
		'```',
	].join('\n');

	const { vault, store } = await fresh({ [FILE]: before });
	assert.equal(store.tasks.length, 1);

	await store.setDone('aaaa11', true, '2026-08-06');
	const after = vault.files.get(FILE).split('\n');

	assert.equal(after[0], '# Мои дела');
	assert.equal(after[2], 'Заметка про [[проект]] и `код`.');
	assert.equal(after[6], '> цитата снизу');
	assert.equal(after[9], '- [ ] это пример, не задача');
	assert.ok(after[4].startsWith('- [x] Отчёт'));
	assert.ok(after[4].includes('done2026-08-06'));
});

test('голая галочка усыновляется при первом чтении', async () => {
	const { vault, store } = await fresh({ [FILE]: '# Дела\n\n- [ ] Купить хлеб\n' });
	assert.equal(store.tasks.length, 1);
	const text = vault.files.get(FILE);
	assert.ok(text.includes('`te 30m d1 p1 ~'), 'плашка дописана: ' + text);
	assert.ok(text.startsWith('# Дела'));

	// повторное чтение не должно ничего менять
	const snapshot = vault.files.get(FILE);
	await store.refreshTasks();
	assert.equal(vault.files.get(FILE), snapshot);
});

test('правка руками подхватывается, своя запись — нет', async () => {
	const { vault, store } = await fresh({ [FILE]: '- [ ] a `te 30m d1 p1 ~aaaa11`\n' });
	const file = vault.getAbstractFileByPath(FILE);

	await store.setDone('aaaa11', true, '2026-08-06');
	const reads = [];
	const orig = store.refreshTasks.bind(store);
	store.refreshTasks = async () => { reads.push(1); return orig(); };

	store.onVaultModify(file);
	assert.equal(reads.length, 0, 'эхо собственной записи не вызывает перечитывания');

	store.lastWriteAt = 0;
	store.onVaultModify(file);
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(reads.length, 1);
});

test('удаление убирает строку и не трогает соседей', async () => {
	const src = '- [ ] a `te 30m d1 p1 ~aaaa11`\nтекст\n- [ ] b `te 30m d1 p1 ~bbbb22`\n';
	const { vault, store } = await fresh({ [FILE]: src });
	await store.removeTask('aaaa11');
	const text = vault.files.get(FILE);
	assert.ok(!text.includes('~aaaa11'));
	assert.ok(text.includes('текст'));
	assert.ok(text.includes('~bbbb22'));
});

/* ── состояние ─────────────────────────────────────────────────────────── */

test('ключ живёт отдельно от data.json', async () => {
	const { plugin, store } = await fresh();
	store.setApiKey(KEY);
	await store.flush();
	assert.equal(store.apiKey, KEY);
	assert.ok(!JSON.stringify(plugin.saved).includes(KEY), 'ключ не должен попасть в data.json');
});

test('битый data.json не роняет плагин', async () => {
	const vault = makeVault();
	const plugin = makePlugin(vault);
	plugin.loadData = async () => ({ balance: 40, rewards: 'мусор', economy: { k: 3 } });
	const store = new Store(plugin);
	await store.load();
	assert.equal(store.state.balance, 40);
	assert.deepEqual(store.state.rewards, []);
	assert.equal(store.state.economy.k, 3);
	assert.equal(store.state.economy.dayCap, 200, 'недостающие поля берутся из умолчаний');
});

test('закрытая сегодня задача открывает награды', async () => {
	const { store } = await fresh({ [FILE]: '- [ ] a `te 30m d1 p1 ~aaaa11`\n' });
	assert.equal(store.doneToday('2026-08-06'), false);
	await store.setDone('aaaa11', true, '2026-08-06');
	assert.equal(store.doneToday('2026-08-06'), true);
	assert.equal(store.doneToday('2026-08-07'), false);
});

/* ── чат ───────────────────────────────────────────────────────────────── */

test('фраза в чате превращается в строку файла', async () => {
	const { vault, store } = await fresh();
	store.setApiKey(KEY);
	store.state.onboarded = true;
	const brain = new Brain(store);

	serve('```json\n{"kind":"task","title":"Созвон с подрядчиком","min":30,"diff":0.9,"prio":1.1}\n```');
	await brain.send('созвон с подрядчиком полчаса');

	const text = vault.files.get(FILE);
	assert.ok(text.includes('- [ ] Созвон с подрядчиком'));
	assert.ok(text.includes('30m'));
	assert.ok(store.state.chat.some((m) => m.role === 'assistant' && m.text.includes('Завёл')));
});

test('невалидный ответ модели ничего не портит', async () => {
	const { vault, store } = await fresh();
	store.setApiKey(KEY);
	store.state.onboarded = true;
	const brain = new Brain(store);

	serve('извини, я не понял вопрос');
	await brain.send('созвон');

	assert.equal(vault.files.size, 0, 'файл не создаётся из мусора');
	assert.ok(store.state.chat.some((m) => m.role === 'system'));
});

test('неверный ключ отбрасывает на шаг ключа и не течёт наружу', async () => {
	const { store } = await fresh();
	store.setApiKey(KEY);
	const brain = new Brain(store);
	store.state.onboardStep = 'workday';

	setNet(async (opts) => {
		if (opts.url.includes('shir-man')) return { status: 500, json: {} };
		return { status: 401, json: { error: { message: `No auth for key ${KEY}` } } };
	});
	await brain.send('пять');

	assert.equal(store.state.onboardStep, 'key');
	assert.ok(!JSON.stringify(store.state.chat).includes(KEY));
});

test('онбординг проходится до решённых цен', async () => {
	const { store } = await fresh();
	const brain = new Brain(store);
	const replies = [
		'{"workdays":5}',
		'{"routine":[{"title":"Разбор почты","min":45,"diff":0.9,"prio":1.2,"perWeek":5},{"title":"Отчёт","min":90,"diff":1.5,"prio":1.6,"perWeek":2}]}',
		'{"rewards":[{"title":"Серия вечером","value":2.0,"freq":10,"kind":"normal"},{"title":"Прогулка","value":0.8,"freq":20,"kind":"restore"}]}',
		'{"rewards":[{"title":"Лента","value":1.5,"harm":2.4,"freq":12,"weeklyCap":2}]}',
	];
	let i = 0;
	serve(() => answer(replies[Math.min(i++, replies.length - 1)]));

	brain.greet();
	assert.equal(store.state.onboardStep, 'key');

	await brain.send(KEY);
	assert.equal(store.state.onboardStep, 'workday');

	await brain.send('пять дней');
	await brain.send('разбираю почту каждый день, раз в две недели отчёт');
	await brain.send('сериал вечером, гуляю');
	await brain.send('залипаю в ленту');

	assert.equal(store.state.onboardStep, 'confirm');
	assert.equal(store.state.rewards.length, 3);
	assert.ok(store.state.economy.k > 0);
	assert.ok(store.state.economy.monthlyIncome > 0);

	const prices = store.state.chat.at(-1).text;
	assert.ok(prices.includes('Лента'));
	assert.ok(prices.includes('вредное'));

	await brain.send('да');
	assert.equal(store.state.onboarded, true);
	assert.equal(store.state.onboardStep, 'done');
});

test('шаг можно пропустить', async () => {
	const { store } = await fresh();
	store.setApiKey(KEY);
	const brain = new Brain(store);
	store.state.onboardStep = 'workday';
	serve('{}');

	await brain.send('пропустить');
	assert.equal(store.state.onboardStep, 'routine');
	assert.equal(store.state.profile.workdays, 5);
});

test('«заново» откатывает онбординг к началу', async () => {
	const { store } = await fresh();
	store.setApiKey(KEY);
	const brain = new Brain(store);
	store.state.onboardStep = 'confirm';
	store.state.rewards = [{ id: 'x', title: 'a', value: 1, harm: 1, freq: 1, kind: 'normal' }];

	await brain.send('заново');
	assert.equal(store.state.onboardStep, 'workday');
	assert.deepEqual(store.state.rewards, []);
	assert.equal(store.state.profile, null);
});

test('параллельные отправки не смешиваются', async () => {
	const { store } = await fresh();
	store.setApiKey(KEY);
	store.state.onboarded = true;
	const brain = new Brain(store);
	serve('{"kind":"none"}');

	const a = brain.send('раз');
	const b = brain.send('два');
	await Promise.all([a, b]);
	assert.equal(store.state.chat.filter((m) => m.role === 'user').length, 1);
});

test('уведомления не сыплются на ровном месте', () => {
	assert.deepEqual(Notice.log, []);
});
