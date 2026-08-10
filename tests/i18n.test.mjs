import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, lang, resolveLang, setLang, t } from '../.test-build/core/i18n.js';
import { describeRepeat } from '../.test-build/core/recurrence.js';

test('язык Obsidian определяется по коду локали', () => {
	assert.equal(detectLang('ru'), 'ru');
	assert.equal(detectLang('RU'), 'ru');
	assert.equal(detectLang('ru-RU'), 'ru');
	assert.equal(detectLang('en'), 'en');
	assert.equal(detectLang('uk'), 'en');
	assert.equal(detectLang('sr'), 'en');
	assert.equal(detectLang('zh-TW'), 'en');
});

test('без языка в localStorage — английский', () => {
	assert.equal(detectLang(null), 'en');
	assert.equal(detectLang(undefined), 'en');
	assert.equal(detectLang(42), 'en');
});

test('ручной выбор важнее локали приложения', () => {
	assert.equal(resolveLang('auto', 'ru'), 'ru');
	assert.equal(resolveLang('auto', 'de'), 'en');
	assert.equal(resolveLang('ru', 'de'), 'ru');
	assert.equal(resolveLang('en', 'ru'), 'en');
});

test('английский словарь не растерял ключей', () => {
	setLang('ru');
	const ru = Object.keys(t()).sort();
	setLang('en');
	const en = Object.keys(t()).sort();
	assert.deepEqual(en, ru);
	setLang('ru');
});

test('в словарях нет пустых строк и совпадающих типов', () => {
	for (const l of ['ru', 'en']) {
		setLang(l);
		for (const [key, value] of Object.entries(t())) {
			const kind = typeof value;
			assert.ok(kind === 'string' || kind === 'function', `${l}.${key}: ${kind}`);
			if (kind === 'string') assert.ok(value.length > 0, `${l}.${key} пустая`);
		}
	}
	setLang('ru');
});

test('смена языка доходит до чужих модулей', () => {
	setLang('en');
	assert.equal(lang(), 'en');
	assert.equal(describeRepeat(1), 'every day');
	assert.equal(describeRepeat(2), 'every other day');
	assert.equal(describeRepeat(7), 'weekly');
	setLang('ru');
	assert.equal(describeRepeat(1), 'каждый день');
});
