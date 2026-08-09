/**
 * Запрос к OpenRouter. Прокси не нужен: requestUrl из Obsidian ходит мимо
 * CORS и работает на телефоне — так исчезает вся серверная часть веб-версии.
 */

import { requestUrl } from 'obsidian';
import { benchModel, pickModels } from './models';
import { messageForStatus, scrubSecrets, type Outcome } from './parse';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT = 45_000;

/**
 * У бесплатных reasoning-моделей размышления съедают бюджет токенов, и человек
 * получает пустой пузырь вместо ответа. Отсюда потолок в 4000 и низкий effort:
 * задача — разобрать фразу в JSON, а не думать над ней.
 */
const MAX_TOKENS = 4000;

export interface Msg {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
	Promise.race([
		p,
		new Promise<T>((_, rej) => window.setTimeout(() => rej(new Error('timeout')), ms)),
	]);

interface Attempt {
	kind: 'ok' | 'retry' | 'fatal';
	text?: string;
	message?: string;
}

async function askOne(key: string, model: string, messages: Msg[]): Promise<Attempt> {
	let res;
	try {
		res = await withTimeout(
			requestUrl({
				url: ENDPOINT,
				method: 'POST',
				headers: {
					Authorization: `Bearer ${key}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://github.com/solidens/obsidian-todo-economy',
					'X-Title': 'Todo Economy',
				},
				body: JSON.stringify({
					model,
					messages,
					max_tokens: MAX_TOKENS,
					reasoning: { effort: 'low' },
				}),
				throw: false,
			}),
			TIMEOUT,
		);
	} catch {
		return { kind: 'retry', message: 'Модель не ответила вовремя.' };
	}

	if (res.status < 200 || res.status >= 300) {
		const { retry, message } = messageForStatus(res.status);
		return { kind: retry ? 'retry' : 'fatal', message };
	}

	let parsed: unknown;
	try {
		parsed = res.json;
	} catch {
		return { kind: 'retry', message: 'Модель прислала не JSON.' };
	}
	if (!parsed || typeof parsed !== 'object') return { kind: 'retry', message: 'Модель прислала не JSON.' };
	const body = parsed as Record<string, unknown>;

	// 200 с полем error — тоже авария: провайдер иногда отвечает так
	if (body.error) return { kind: 'retry', message: 'Модель вернула ошибку.' };

	const choices = body.choices as Array<{ message?: { content?: string } }> | undefined;
	const text = choices?.[0]?.message?.content ?? '';
	if (!text.trim()) return { kind: 'retry', message: 'Модель прислала пустой ответ.' };

	return { kind: 'ok', text };
}

/**
 * Пройти очередь моделей сверху вниз. Три исхода различаются намеренно:
 * годный ответ, «эта модель сейчас не может» и «дальше пробовать бессмысленно»
 * (401/403 — ключ, 402 — квота).
 */
export async function ask(key: string, messages: Msg[]): Promise<Outcome<string>> {
	const queue = await pickModels();
	let last = 'Ни одна модель не ответила.';

	for (const model of queue) {
		const a = await askOne(key, model, messages);
		if (a.kind === 'ok') {
			return { ok: true, value: scrubSecrets(a.text ?? '', key), model };
		}
		if (a.kind === 'fatal') {
			return { ok: false, retry: false, message: scrubSecrets(a.message ?? last, key) };
		}
		benchModel(model);
		last = a.message ?? last;
	}
	return { ok: false, retry: true, message: scrubSecrets(last, key) };
}
