/**
 * Хранилище. Два места и ни одного лишнего файла в хранилище заметок:
 *
 *   ТУДУ.md                  задачи — обычные галочки, редактируются руками
 *   data.json плагина        баланс, награды, экономика, история, чат
 *   локальное хранилище      ключ OpenRouter — не синкается между устройствами
 *
 * Ключ намеренно лежит отдельно от data.json: data.json уезжает в Obsidian
 * Sync и в git вместе с хранилищем, а ключ не должен. Это ровно то же
 * поведение, что было в вебе, где ключ жил в localStorage браузера.
 */

import { Notice, TFile, type App, type Plugin } from 'obsidian';
import * as md from './core/tasks-md';
import { pruneGranted, rollover } from './core/ledger';
import { dayKey } from './core/time';
import { DEFAULT_STATE, type State, type Task } from './core/types';

const KEY_SLOT = 'todo-economy:openrouter-key';
const SAVE_DELAY = 600;
const ECHO_WINDOW = 1500;

type Listener = () => void;

export class Store {
	state: State = structuredClone(DEFAULT_STATE);
	tasks: md.ParsedTask[] = [];

	private app: App;
	private plugin: Plugin;
	private listeners = new Set<Listener>();
	private saveTimer: number | null = null;
	private lastWriteAt = 0;
	private fileMissing = false;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	/* ── подписка ──────────────────────────────────────────────────────── */

	onChange(cb: Listener): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	private emit(): void {
		for (const cb of this.listeners) cb();
	}

	/* ── ключ: живёт на устройстве, не в хранилище ─────────────────────── */

	get apiKey(): string {
		return (this.app.loadLocalStorage(KEY_SLOT) as string | null) ?? '';
	}

	setApiKey(k: string): void {
		this.app.saveLocalStorage(KEY_SLOT, k.trim() || null);
		this.emit();
	}

	/* ── data.json ─────────────────────────────────────────────────────── */

	async load(): Promise<void> {
		const raw = (await this.plugin.loadData()) as Partial<State> | null;
		this.state = this.normalize(raw);
		rollover(this.state, dayKey());
		await this.refreshTasks();
	}

	private normalize(raw: Partial<State> | null): State {
		const base = structuredClone(DEFAULT_STATE);
		if (!raw || typeof raw !== 'object') return base;
		const s: State = { ...base, ...raw };
		// вложенные объекты сливаем поимённо, иначе старая схема оставит дыры
		s.economy = { ...base.economy, ...(raw.economy ?? {}) };
		s.streak = { ...base.streak, ...(raw.streak ?? {}) };
		s.day = { ...base.day, ...(raw.day ?? {}) };
		s.week = { ...base.week, ...(raw.week ?? {}) };
		s.rewards = Array.isArray(raw.rewards) ? raw.rewards : [];
		s.history = Array.isArray(raw.history) ? raw.history : [];
		s.chat = Array.isArray(raw.chat) ? raw.chat : [];
		s.granted = raw.granted && typeof raw.granted === 'object' ? raw.granted : {};
		s.version = base.version;
		return s;
	}

	/** Отложенная запись: галочки и помодоро дёргают состояние часто. */
	save(): void {
		this.emit();
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.plugin.saveData(this.state);
		}, SAVE_DELAY);
	}

	async flush(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.plugin.saveData(this.state);
	}

	/* ── файл задач ────────────────────────────────────────────────────── */

	get filePath(): string {
		return this.state.tasksFile || DEFAULT_STATE.tasksFile;
	}

	private getFile(): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.filePath);
		return f instanceof TFile ? f : null;
	}

	/** Создаётся один раз и только по явному действию — молча файлов не плодим. */
	async ensureFile(): Promise<TFile | null> {
		const existing = this.getFile();
		if (existing) return existing;
		const path = this.filePath;
		const slash = path.lastIndexOf('/');
		if (slash > 0) {
			const dir = path.slice(0, slash);
			if (!this.app.vault.getAbstractFileByPath(dir)) {
				try {
					await this.app.vault.createFolder(dir);
				} catch {
					// уже создана параллельно — не беда
				}
			}
		}
		try {
			this.lastWriteAt = Date.now();
			return await this.app.vault.create(path, md.STARTER_FILE);
		} catch (e) {
			new Notice(`Todo Economy: не удалось создать ${path}`);
			console.error(e);
			return null;
		}
	}

	async refreshTasks(): Promise<void> {
		const file = this.getFile();
		if (!file) {
			this.fileMissing = true;
			this.tasks = [];
			this.emit();
			return;
		}
		this.fileMissing = false;
		const text = await this.app.vault.cachedRead(file);
		this.tasks = md.parseTasks(text);

		pruneGranted(this.state, new Set(this.tasks.map((t) => t.id)));

		// Усыновлённые строки дописываем один раз, чтобы у задачи появился id.
		const adopted = this.tasks.filter((t) => t.adopted);
		if (adopted.length) await this.writeLines(adopted);

		this.emit();
	}

	get missing(): boolean {
		return this.fileMissing;
	}

	/** Правка файла целиком под замком Obsidian: чужие строки не страдают. */
	private async edit(fn: (text: string) => string): Promise<void> {
		const file = this.getFile();
		if (!file) return;
		this.lastWriteAt = Date.now();
		await this.app.vault.process(file, fn);
		const text = await this.app.vault.cachedRead(file);
		this.tasks = md.parseTasks(text);
		this.emit();
	}

	private async writeLines(tasks: md.ParsedTask[]): Promise<void> {
		const edits = new Map<number, string>();
		for (const t of tasks) edits.set(t.line, md.serializeTask(t));
		await this.edit((text) => md.replaceLines(text, edits));
	}

	/** Модель файла могла разъехаться, если человек правил его руками. */
	private async withFreshTask(id: string): Promise<md.ParsedTask | null> {
		await this.refreshTasks();
		return this.tasks.find((t) => t.id === id) ?? null;
	}

	async setDone(id: string, done: boolean, doneOn?: string): Promise<md.ParsedTask | null> {
		const t = await this.withFreshTask(id);
		if (!t) return null;
		t.done = done;
		if (done) t.doneOn = doneOn ?? dayKey();
		else delete t.doneOn;
		await this.writeLines([t]);
		return t;
	}

	async patchTask(id: string, patch: Partial<Task>): Promise<md.ParsedTask | null> {
		const t = await this.withFreshTask(id);
		if (!t) return null;
		Object.assign(t, patch);
		await this.writeLines([t]);
		return t;
	}

	async addTask(input: { title: string; min: number; diff: number; prio: number; due?: string }): Promise<string | null> {
		const file = (await this.ensureFile());
		if (!file) return null;
		const t: md.ParsedTask = {
			id: md.newId(),
			title: input.title.replace(/[`\n]/g, ' ').trim(),
			min: input.min, diff: input.diff, prio: input.prio,
			done: false, due: input.due,
			indent: '', bullet: '-', extra: [], line: -1, adopted: false,
		};
		await this.edit((text) => md.insertTask(text, md.serializeTask(t)));
		return t.id;
	}

	async removeTask(id: string): Promise<void> {
		const t = await this.withFreshTask(id);
		if (!t) return;
		await this.edit((text) => md.removeLine(text, t.line));
	}

	/* ── производные ───────────────────────────────────────────────────── */

	doneToday(today: string = dayKey()): boolean {
		return this.tasks.some((t) => t.done && t.doneOn === today);
	}

	openTasks(): md.ParsedTask[] {
		return this.tasks.filter((t) => !t.done);
	}

	/**
	 * Правка файла снаружи. Собственные записи отсеиваются по времени:
	 * иначе каждая галочка вызывала бы перечитывание и мигание панели.
	 */
	onVaultModify(file: TFile): void {
		if (file.path !== this.filePath) return;
		if (Date.now() - this.lastWriteAt < ECHO_WINDOW) return;
		void this.refreshTasks();
	}

	dispose(): void {
		this.listeners.clear();
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
	}
}
