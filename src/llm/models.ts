/**
 * Выбор модели. Модель не зашита в код: берётся рейтинг лучших бесплатных
 * моделей OpenRouter, кэшируется на шесть часов, дальше очередь идёт сверху
 * вниз, пока кто-нибудь не ответит. Упёршаяся в лимит откладывается на десять
 * минут. Последним рубежом стоит `openrouter/free` — роутер, который сам
 * решает, куда отправить запрос.
 *
 * Поэтому «чат сегодня не работает» практически не случается: чтобы замолчать,
 * должны одновременно отвалиться четыре разные модели.
 */

import { requestUrl } from 'obsidian';

const RATING_URL = 'https://shir-man.com/api/free-llm/top-models';
const RATING_TTL = 6 * 60 * 60 * 1000;
const COOLDOWN = 10 * 60 * 1000;
const QUEUE_LEN = 3;

export const LAST_RESORT = 'openrouter/free';

/** Снимок топа на момент сборки. Устареет, но `openrouter/free` подстрахует. */
const STATIC_FALLBACK = [
	'deepseek/deepseek-chat-v3-0324:free',
	'meta-llama/llama-3.3-70b-instruct:free',
	'qwen/qwen-2.5-72b-instruct:free',
	'google/gemma-3-27b-it:free',
	'mistralai/mistral-small-3.1-24b-instruct:free',
];

let cache: { at: number; ids: string[] } | null = null;
const cooldown = new Map<string, number>();

/** Отложить модель: ответила 429 или молчит. */
export function benchModel(id: string): void {
	cooldown.set(id, Date.now() + COOLDOWN);
}

function extractIds(body: unknown): string[] {
	const seen: string[] = [];
	const walk = (v: unknown, depth: number): void => {
		if (depth > 4 || seen.length > 40) return;
		if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
		if (v && typeof v === 'object') {
			const o = v as Record<string, unknown>;
			for (const key of ['id', 'model', 'slug', 'name']) {
				const s = o[key];
				if (typeof s === 'string' && s.includes('/')) { seen.push(s); return; }
			}
			for (const x of Object.values(o)) walk(x, depth + 1);
			return;
		}
		if (typeof v === 'string' && v.includes('/')) seen.push(v);
	};
	walk(body, 0);
	return seen.filter((s) => s.includes(':free') || s.startsWith('openrouter/'));
}

async function fetchRating(): Promise<string[]> {
	if (cache && Date.now() - cache.at < RATING_TTL) return cache.ids;
	try {
		const r = await requestUrl({ url: RATING_URL, method: 'GET', throw: false });
		if (r.status >= 200 && r.status < 300) {
			const ids = extractIds(r.json);
			if (ids.length) {
				cache = { at: Date.now(), ids };
				return ids;
			}
		}
	} catch {
		// сеть недоступна — молча уходим на зашитый список
	}
	cache = { at: Date.now(), ids: STATIC_FALLBACK };
	return STATIC_FALLBACK;
}

/** Очередь попыток: живые модели из рейтинга плюс последний рубеж. */
export async function pickModels(): Promise<string[]> {
	const rated = await fetchRating();
	const now = Date.now();
	const fresh = rated.filter((id) => (cooldown.get(id) ?? 0) < now);
	const queue = (fresh.length ? fresh : rated).slice(0, QUEUE_LEN);
	if (!queue.includes(LAST_RESORT)) queue.push(LAST_RESORT);
	return queue;
}

/** Для тестов и «Сбросить кэш моделей» в настройках. */
export function resetModelCache(): void {
	cache = null;
	cooldown.clear();
}
