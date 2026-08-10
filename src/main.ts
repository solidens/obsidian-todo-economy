/**
 * Todo Economy — тудушник с решённой экономикой баллов внутри Obsidian.
 *
 * Что плагин создаёт в хранилище: ровно один markdown-файл с задачами, и то
 * по явному действию. Баланс, награды, экономика, серия и история покупок
 * тоже живут в нём — служебным блоком кода в конце, см. store.ts. Переписка
 * с чатом и настройки интерфейса лежат в data.json самого плагина, их синкать
 * незачем. Ключ OpenRouter живёт в локальном хранилище устройства и никуда
 * не синкается.
 */

import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { Brain } from './brain';
import { penalize, rollover } from './core/ledger';
import { resolveLang, setLang, t as L } from './core/i18n';
import { dayKey } from './core/time';
import { EconomySettingsTab } from './settings';
import { Store } from './store';
import { EconomyView, VIEW_TYPE } from './ui/view';

export default class TodoEconomyPlugin extends Plugin {
	store!: Store;
	brain!: Brain;

	async onload(): Promise<void> {
		this.store = new Store(this);
		this.brain = new Brain(this.store);
		await this.store.load();
		this.applyLang();

		this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new EconomyView(leaf, this.store, this.brain));
		this.addRibbonIcon('target', 'Todo Economy', () => void this.activate());
		this.addCommands();
		this.addSettingTab(new EconomySettingsTab(this.app, this));

		/**
		 * Файл подхватывается на onLayoutReady, а не в onload. В onload
		 * хранилище ещё не проиндексировано: getAbstractFileByPath вернёт null
		 * даже для существующего файла, и панель встретит вас предложением
		 * создать то, что уже есть.
		 */
		this.app.workspace.onLayoutReady(() => void this.bootstrap());

		// правки файла руками подхватываются, свои записи отсеиваются по времени
		this.registerEvent(
			this.app.vault.on('modify', (f) => {
				if (f instanceof TFile) this.store.onVaultModify(f);
			}),
		);
		// файл мог приехать синхронизацией уже после запуска
		this.registerEvent(
			this.app.vault.on('create', (f: TAbstractFile) => {
				if (f instanceof TFile && f.path === this.store.filePath) void this.bootstrap();
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (f, oldPath) => {
				if (f instanceof TFile && oldPath === this.store.filePath) {
					this.store.state.tasksFile = f.path;
					this.store.save();
					void this.store.refreshTasks();
				}
			}),
		);

		// смена суток на живом окне: обнулить дневной счётчик, сжечь излишек,
		// открыть заново повторяющиеся задачи
		this.registerInterval(
			window.setInterval(() => {
				const today = dayKey();
				if (this.store.state.day.key !== today) void this.newDay(today);
			}, 60_000),
		);
	}

	/**
	 * `Component.onunload` объявлен как `void` — не `async`, чтобы не давать
	 * промис туда, где его не ждут. `flush()` не await'им: он не зависит от
	 * `dispose()`, а тот лишь снимает подписки и таймер debounce.
	 */
	onunload(): void {
		void this.store.flush();
		this.store.dispose();
	}

	/** Первое чтение файла — уже после того, как хранилище проиндексировано. */
	private async bootstrap(): Promise<void> {
		await this.store.refreshTasks();
		const back = await this.store.rollRecurring();
		this.sweepOverdue();
		if (back > 0) new Notice(L().reopened(back));
	}

	private async newDay(today: string): Promise<void> {
		rollover(this.store.state, today);
		await this.store.rollRecurring(today);
		this.sweepOverdue();
		this.store.save();
	}

	/**
	 * Язык выбирается один раз при загрузке и при смене настройки. Obsidian
	 * держит выбранный язык в localStorage под ключом `language`; для
	 * английского ключа может не быть вовсе, и это ровно тот случай, когда
	 * английский и нужен.
	 */
	applyLang(): void {
		let locale: string | null = null;
		try {
			locale = window.localStorage.getItem('language');
		} catch {
			locale = null;
		}
		setLang(resolveLang(this.store.state.langPref, locale));
		this.refitViews();
	}

	private addCommands(): void {
		this.addCommand({
			id: 'open-panel',
			name: L().cmdOpenPanel,
			callback: () => void this.activate(),
		});
		this.addCommand({
			id: 'open-tasks-file',
			name: L().cmdOpenFile,
			callback: () => void this.openTasksFile(),
		});
		this.addCommand({
			id: 'refresh-tasks',
			name: L().cmdRefresh,
			callback: () => void this.bootstrap(),
		});
		this.addCommand({
			id: 'restart-onboarding',
			name: L().cmdRestartOnboarding,
			callback: () => {
				const s = this.store.state;
				s.onboarded = false;
				s.onboardStep = 'workday';
				s.profile = null;
				s.rewards = [];
				s.chat = [];
				this.store.save();
				void this.activate();
			},
		});
	}

	/** Штраф за просроченные важные задачи — один раз на каждый срок. */
	private sweepOverdue(): void {
		const today = dayKey();
		let total = 0;
		for (const t of this.store.tasks) {
			// у повторяющейся «просрочка» — это просто пропущенный день
			if (t.done || t.repeat || !t.due || t.due >= today) continue;
			total += penalize(this.store.state, t, today);
		}
		if (total > 0) {
			new Notice(L().penalized(total));
			this.store.save();
		}
	}

	private async openTasksFile(): Promise<void> {
		const file = await this.store.ensureFile();
		if (file) await this.app.workspace.getLeaf('tab').openFile(file);
	}

	/** Перечитать шрифт во всех открытых панелях — после смены настроек. */
	refitViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const v = leaf.view;
			if (v instanceof EconomyView) v.refit();
		}
	}

	/** Панель живёт в правой шторке — рядом с заметкой, а не вместо неё. */
	async activate(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length) {
			await workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}
}
