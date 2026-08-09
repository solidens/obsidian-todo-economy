/**
 * Хранилище. Три места и ни одного лишнего файла в хранилище заметок:
 *
 *   ТУДУ.md                  задачи, а в конце — блок с балансом, наградами,
 *                             экономикой, серией и историей
 *   data.json плагина        то же самое как локальный кэш плюс чат и
 *                             настройки интерфейса, которые синкать незачем
 *   локальное хранилище      ключ OpenRouter — не синкается между устройствами
 *
 * Баланс и награды раньше жили только в data.json, а его синхронизация
 * (Obsidian Sync, git, Syncthing по подпискам) часто обходит стороной —
 * человек синкает заметки, а не служебную папку плагина. Поэтому источник
 * истины для «синкаемой» части состояния — сам файл задач: она пишется туда
 * же блоком кода и читается оттуда при каждом перечитывании файла. data.json
 * остаётся резервной копией и источником при миграции со старых версий,
 * пока блок в файле ещё не появился.
 *
 * Ключ намеренно лежит отдельно от обоих: он не должен уезжать вместе с
 * хранилищем. Это ровно то же поведение, что было в вебе, где ключ жил в
 * localStorage браузера.
 */

import { Notice, TFile, type App, type Plugin } from 'obsidian';
import * as md from './core/tasks-md';
import { pruneGranted, rollover } from './core/ledger';
import { rollRecurring } from './core/recurrence';
import { dayKey } from './core/time';
import { DEFAULT_STATE, type State, type Task } from './core/types';

const KEY_SLOT = 'todo-economy:openrouter-key';
const SAVE_DELAY = 600;
const ECHO_WINDOW = 1500;

/**
 * Поля, которые едут в файле задач, а не только в data.json — то, ради чего
 * человек хочет синкать один файл и получать баланс, награды, серию и
 * историю на всех устройствах.
 */
const SYNCED_KEYS = [
	'onboarded', 'onboardStep', 'economy', 'rewards', 'balance', 'granted',
	'streak', 'day', 'week', 'decayedOn', 'history', 'profile', 'strictRestore',
] as const satisfies readonly (keyof State)[];

type SyncedState = Pick<State, (typeof SYNCED_KEYS)[number]>;

function pickSynced(s: State): SyncedState {
	return {
		onboarded: s.onboarded,
		onboardStep: s.onboardStep,
		economy: s.economy,
		rewards: s.rewards,
		balance: s.balance,
		granted: s.granted,
		streak: s.streak,
		day: s.day,
		week: s.week,
		decayedOn: s.decayedOn,
		history: s.history,
		profile: s.profile,
		strictRestore: s.strictRestore,
	};
}

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

	/**
	 * data.json целиком: локальные поля берутся отсюда всегда, синкаемые —
	 * как запасной вариант, пока файл задач ещё не прочитан или блока в нём
	 * ещё нет (миграция со старой версии, где всё лежало только в data.json).
	 */
	private normalize(raw: Partial<State> | null): State {
		const base = structuredClone(DEFAULT_STATE);
		if (!raw || typeof raw !== 'object') return base;
		base.tasksFile = typeof raw.tasksFile === 'string' && raw.tasksFile ? raw.tasksFile : base.tasksFile;
		base.chat = Array.isArray(raw.chat) ? raw.chat : [];
		base.lastModel = typeof raw.lastModel === 'string' ? raw.lastModel : null;
		base.panelFont = typeof raw.panelFont === 'string' ? raw.panelFont : '';
		base.glyphMode = raw.glyphMode === 'unicode' || raw.glyphMode === 'ascii' ? raw.glyphMode : 'auto';
		this.mergeSynced(base, raw);
		return base;
	}

	/**
	 * Слить синкаемую часть состояния поимённо — иначе старая схема или
	 * частичный объект из файла оставит дыры. Общий код для data.json (полный
	 * State) и для блока, прочитанного из файла задач (произвольный JSON).
	 */
	private mergeSynced(base: State, raw: Partial<State>): void {
		if (typeof raw.onboarded === 'boolean') base.onboarded = raw.onboarded;
		if (typeof raw.onboardStep === 'string') base.onboardStep = raw.onboardStep as State['onboardStep'];
		base.economy = { ...base.economy, ...(raw.economy && typeof raw.economy === 'object' ? raw.economy : {}) };
		if (Array.isArray(raw.rewards)) base.rewards = raw.rewards;
		if (typeof raw.balance === 'number' && Number.isFinite(raw.balance)) base.balance = raw.balance;
		if (raw.granted && typeof raw.granted === 'object') base.granted = raw.granted;
		base.streak = { ...base.streak, ...(raw.streak && typeof raw.streak === 'object' ? raw.streak : {}) };
		base.day = { ...base.day, ...(raw.day && typeof raw.day === 'object' ? raw.day : {}) };
		base.week = { ...base.week, ...(raw.week && typeof raw.week === 'object' ? raw.week : {}) };
		if (raw.decayedOn === null || typeof raw.decayedOn === 'string') base.decayedOn = raw.decayedOn;
		if (Array.isArray(raw.history)) base.history = raw.history;
		if (raw.profile === null || (raw.profile && typeof raw.profile === 'object')) {
			base.profile = raw.profile as State['profile'];
		}
		if (typeof raw.strictRestore === 'boolean') base.strictRestore = raw.strictRestore;
	}

	/** Отложенная запись: галочки и помодоро дёргают состояние часто. */
	save(): void {
		this.emit();
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.persist();
		}, SAVE_DELAY);
	}

	async flush(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.persist();
	}

	/** data.json как резервная копия целиком, плюс синкаемый блок в файле задач. */
	private async persist(): Promise<void> {
		await this.plugin.saveData(this.state);
		await this.writeSyncedState();
	}

	/**
	 * Переписать блок состояния в файле задач. Если файла ещё нет (например,
	 * онбординг не дошёл до первой задачи) — молча пропускаем, data.json пока
	 * побудет единственной копией; следующее сохранение допишет блок, как
	 * только файл появится.
	 */
	private async writeSyncedState(): Promise<void> {
		const file = this.getFile();
		if (!file) return;
		const json = JSON.stringify(pickSynced(this.state), null, 2);
		this.lastWriteAt = Date.now();
		await this.app.vault.process(file, (text) => md.writeState(text, json));
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

		// Блок в файле — источник истины для баланса, наград, серии и истории:
		// его могло принести синхронизацией с другого устройства.
		const synced = md.readState(text);
		if (synced && typeof synced === 'object') {
			this.mergeSynced(this.state, synced as Partial<State>);
		} else {
			// Блока ещё нет — старый файл или файл только что создан. Допишем его
			// из текущего состояния (data.json на первом запуске), чтобы дальше
			// синхронизация уже переносила актуальные данные.
			this.save();
		}

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

	/**
	 * Открыть заново повторяющиеся задачи, которым пришёл срок, и отпустить
	 * их записи о начислении — эпизод закрыт, следующий заработает сам.
	 */
	async rollRecurring(today: string = dayKey()): Promise<number> {
		const changed = rollRecurring(this.tasks, today);
		if (!changed.length) return 0;
		for (const t of changed) delete this.state.granted[t.id];
		await this.writeLines(changed);
		this.save();
		return changed.length;
	}

	async addTask(input: {
		title: string; min: number; diff: number; prio: number; due?: string; repeat?: number;
	}): Promise<string | null> {
		const file = (await this.ensureFile());
		if (!file) return null;
		const t: md.ParsedTask = {
			id: md.newId(),
			title: input.title.replace(/[`\n]/g, ' ').trim(),
			min: input.min, diff: input.diff, prio: input.prio,
			done: false, due: input.due, repeat: input.repeat,
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
