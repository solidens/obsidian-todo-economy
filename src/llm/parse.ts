/**
 * Разбор ответов модели и подчистка секретов. Чистые функции — проверяются
 * тестами без сети и без Obsidian.
 */

/** Ключ OpenRouter принимается только по форме — мусор из поля ввода не поедет в заголовок. */
export const KEY_RE = /^sk-or-v1-[A-Za-z0-9._-]{20,}$/;
export const isValidKey = (k: string): boolean => KEY_RE.test(k.trim());

const KEY_ANYWHERE = /sk-or-v1-[A-Za-z0-9._-]{10,}/g;

/**
 * Провайдер при неверном ключе возвращает ошибку, в тексте которой
 * повторяется сам ключ. Такие сообщения наружу не пробрасываются, и на
 * выходе всё равно стоит подчистка — на случай, если ключ просочится
 * через саму модель.
 */
export function scrubSecrets(text: string, key?: string): string {
	let out = text.replace(KEY_ANYWHERE, 'sk-or-v1-…');
	if (key && key.length > 8) out = out.split(key).join('sk-or-v1-…');
	return out;
}

const FENCE = /^\s*```(?:json|JSON)?\s*|\s*```\s*$/g;

/** Найти первый сбалансированный JSON-объект или массив в тексте. */
function firstJsonChunk(text: string): string | null {
	for (let i = 0; i < text.length; i++) {
		const open = text[i];
		if (open !== '{' && open !== '[') continue;
		const close = open === '{' ? '}' : ']';
		let depth = 0;
		let inStr = false;
		let esc = false;
		for (let j = i; j < text.length; j++) {
			const c = text[j];
			if (esc) { esc = false; continue; }
			if (c === '\\') { esc = true; continue; }
			if (c === '"') { inStr = !inStr; continue; }
			if (inStr) continue;
			if (c === open) depth++;
			else if (c === close) {
				depth--;
				if (depth === 0) return text.slice(i, j + 1);
			}
		}
	}
	return null;
}

/**
 * Достать JSON из ответа. Бесплатные модели любят обернуть его в ```json,
 * приписать «Вот результат:» или прислать два объекта подряд.
 * Невалидный разбор просто не применяется — задачи всегда можно завести руками.
 */
export function extractJson<T = unknown>(text: string): T | null {
	const cleaned = text.replace(FENCE, '');
	for (const candidate of [cleaned.trim(), firstJsonChunk(cleaned)]) {
		if (!candidate) continue;
		try {
			return JSON.parse(candidate) as T;
		} catch {
			// пробуем следующий кандидат
		}
	}
	return null;
}

export type Outcome<T> =
	| { ok: true; value: T; model: string }
	| { ok: false; retry: boolean; message: string };

/** Понятная человеку причина по коду статуса. Текст провайдера наружу не идёт. */
export function messageForStatus(status: number): { retry: boolean; message: string } {
	if (status === 401 || status === 403) {
		return { retry: false, message: 'Ключ не принят. Проверь его в настройках плагина.' };
	}
	if (status === 402) {
		return { retry: false, message: 'Квота ключа исчерпана. Пополни счёт OpenRouter или подожди сутки.' };
	}
	if (status === 429) {
		return { retry: true, message: 'Модель упёрлась в лимит.' };
	}
	if (status >= 500) {
		return { retry: true, message: 'Провайдер не отвечает.' };
	}
	return { retry: true, message: `Запрос не прошёл (${status}).` };
}
