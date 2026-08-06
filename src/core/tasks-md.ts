/**
 * Задачи живут в ОДНОМ markdown-файле обычными галочками — плагин не плодит
 * заметки. Метаданные прячутся в код-спан в конце строки: в режиме чтения это
 * тихая моноширинная плашка, в режиме правки — очевидный текст, который можно
 * поправить руками.
 *
 *     - [ ] Дожать отчёт по кварталу `te 90m d1.2 p1.3 due2026-08-08 ~k3f9x2`
 *     - [x] Разгрести инбокс `te 25m d0.7 p0.9 done2026-08-06 ~a71bqz`
 *
 * Голая галочка без спана — тоже задача: плагин усыновляет её со значениями
 * по умолчанию и дописывает спан при первом же касании. Всё, что в файле не
 * является строкой задачи, не трогается вообще: заголовки, текст, ссылки.
 */

import { sane } from './economy';
import type { Task } from './types';

export interface ParsedTask extends Task {
	bullet: string;
	/** У строки не было спана — плагин проставил значения по умолчанию. */
	adopted: boolean;
}

const TASK_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+\[([ xX])\]\s?(.*)$/;
const SPAN_RE = /\s*`te\s+([^`]*)`\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

export const DEFAULTS = { min: 30, diff: 1, prio: 1 };

export function newId(): string {
	let s = '';
	const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
	const rnd =
		typeof crypto !== 'undefined' && crypto.getRandomValues
			? crypto.getRandomValues(new Uint8Array(6))
			: Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
	for (const b of rnd) s += alphabet[b % alphabet.length];
	return s;
}

const num = (v: string, fallback: number) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
};

/** Разобрать содержимое файла. Возвращает только строки-задачи. */
export function parseTasks(text: string): ParsedTask[] {
	const out: ParsedTask[] = [];
	const lines = text.split('\n');
	let fenced = false;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (FENCE_RE.test(raw)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;

		const m = TASK_RE.exec(raw);
		if (!m) continue;

		const [, indent, bullet, box, rest] = m;
		const span = SPAN_RE.exec(rest);
		const title = (span ? rest.slice(0, span.index) : rest).trim();
		if (!title) continue;

		const t: ParsedTask = {
			id: '',
			title,
			min: DEFAULTS.min,
			diff: DEFAULTS.diff,
			prio: DEFAULTS.prio,
			done: box.toLowerCase() === 'x',
			indent,
			bullet,
			extra: [],
			line: i,
			adopted: !span,
		};

		if (span) {
			for (const tok of span[1].trim().split(/\s+/)) {
				if (!tok) continue;
				if (/^\d+m$/.test(tok)) t.min = sane.min(num(tok.slice(0, -1), DEFAULTS.min));
				else if (/^d[\d.]+$/.test(tok)) t.diff = sane.diff(num(tok.slice(1), DEFAULTS.diff));
				else if (/^p[\d.]+$/.test(tok)) t.prio = sane.prio(num(tok.slice(1), DEFAULTS.prio));
				else if (/^due\d{4}-\d{2}-\d{2}$/.test(tok)) t.due = tok.slice(3);
				else if (/^done\d{4}-\d{2}-\d{2}$/.test(tok)) t.doneOn = tok.slice(4);
				else if (/^~[a-z0-9]+$/.test(tok)) t.id = tok.slice(1);
				else t.extra.push(tok);
			}
		}

		if (!t.id) {
			t.id = newId();
			t.adopted = true;
		}
		out.push(t);
	}

	// Дубли идентификаторов — например после копипасты строки — разводим.
	const seen = new Set<string>();
	for (const t of out) {
		if (seen.has(t.id)) {
			t.id = newId();
			t.adopted = true;
		}
		seen.add(t.id);
	}
	return out;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function serializeSpan(t: Task): string {
	const tok = [`${Math.round(t.min)}m`, `d${fmt(t.diff)}`, `p${fmt(t.prio)}`];
	if (t.due) tok.push(`due${t.due}`);
	if (t.done && t.doneOn) tok.push(`done${t.doneOn}`);
	tok.push(...t.extra);
	tok.push(`~${t.id}`);
	return '`te ' + tok.join(' ') + '`';
}

export function serializeTask(t: ParsedTask): string {
	return `${t.indent}${t.bullet} [${t.done ? 'x' : ' '}] ${t.title} ${serializeSpan(t)}`;
}

/**
 * Переписать конкретные строки. Всё остальное содержимое файла остаётся
 * байт в байт — включая заголовки, абзацы и чужие списки.
 */
export function replaceLines(text: string, edits: Map<number, string>): string {
	if (edits.size === 0) return text;
	const lines = text.split('\n');
	for (const [i, next] of edits) {
		if (i >= 0 && i < lines.length) lines[i] = next;
	}
	return lines.join('\n');
}

/** Вставить новую задачу сразу после последней существующей, иначе в конец. */
export function insertTask(text: string, line: string): string {
	const lines = text.split('\n');
	let at = -1;
	let fenced = false;
	for (let i = 0; i < lines.length; i++) {
		if (FENCE_RE.test(lines[i])) fenced = !fenced;
		else if (!fenced && TASK_RE.test(lines[i])) at = i;
	}
	if (at >= 0) lines.splice(at + 1, 0, line);
	else {
		if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
		lines.push(line);
	}
	return lines.join('\n');
}

/** Убрать строку задачи целиком. */
export function removeLine(text: string, line: number): string {
	const lines = text.split('\n');
	if (line < 0 || line >= lines.length) return text;
	lines.splice(line, 1);
	return lines.join('\n');
}

export const STARTER_FILE = `# ТУДУ

Задачи — обычные галочки. Плашка в конце строки хранит оценку в минутах,
сложность и приоритет; её можно править руками, а можно не трогать вовсе.
Написал голую галочку — плагин допишет плашку сам.

`;
