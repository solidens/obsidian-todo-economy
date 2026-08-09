import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayKey } from '../.test-build/core/time.js';

test('рубеж суток — не полночь, а 2 ночи', () => {
	assert.equal(dayKey(new Date(2026, 7, 9, 1, 30)), '2026-08-08', 'час тридцать ночи — ещё вчера');
	assert.equal(dayKey(new Date(2026, 7, 9, 1, 59)), '2026-08-08');
	assert.equal(dayKey(new Date(2026, 7, 9, 2, 0)), '2026-08-09', 'ровно в два — уже новый день');
	assert.equal(dayKey(new Date(2026, 7, 9, 23, 59)), '2026-08-09');
});

test('addDays переживает сдвиг рубежа суток', () => {
	assert.equal(addDays('2026-08-08', 1), '2026-08-09');
	assert.equal(addDays('2026-08-31', 1), '2026-09-01', 'переход месяца');
	assert.equal(addDays('2026-08-08', -1), '2026-08-07');
});
