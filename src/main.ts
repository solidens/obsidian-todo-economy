/**
 * Todo Economy — тудушник с решённой экономикой баллов внутри Obsidian.
 *
 * Что плагин создаёт в хранилище: ровно один markdown-файл с задачами, и то
 * по явному действию. Всё остальное — баланс, награды, история, переписка —
 * лежит в data.json самого плагина. Ключ OpenRouter живёт в локальном
 * хранилище устройства и никуда не синкается.
 */

import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { Brain } from './brain';
import { penalize, rollover } from './core/ledger';
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
		this.sweepOverdue();

		this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new EconomyView(leaf, this.store, this.brain));

		this.addRibbonIcon('target', 'Todo Economy', () => void this.activate());

		this.addCommand({
			id: 'open-panel',
			name: 'Открыть панель',
			callback: () => void this.activate(),
		});

		this.addCommand({
			id: 'open-tasks-file',
			name: 'Открыть файл задач',
			callback: () => void this.openTasksFile(),
		});

		this.addCommand({
			id: 'restart-onboarding',
			name: 'Пройти онбординг заново',
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

		// правки файла руками подхватываются, свои записи отсеиваются по времени
		this.registerEvent(
			this.app.vault.on('modify', (f) => {
				if (f instanceof TFile) this.store.onVaultModify(f);
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

		// смена суток на живом окне: обнулить дневной счётчик, сжечь излишек
		this.registerInterval(
			window.setInterval(() => {
				const today = dayKey();
				if (this.store.state.day.key !== today) {
					rollover(this.store.state, today);
					this.sweepOverdue();
					this.store.save();
				}
			}, 60_000),
		);

		this.addSettingTab(new EconomySettingsTab(this.app, this));
	}

	async onunload(): Promise<void> {
		await this.store.flush();
		this.store.dispose();
	}

	/** Штраф за просроченные важные задачи — один раз на каждый срок. */
	private sweepOverdue(): void {
		const today = dayKey();
		let total = 0;
		for (const t of this.store.tasks) {
			if (t.done || !t.due || t.due >= today) continue;
			total += penalize(this.store.state, t, today);
		}
		if (total > 0) {
			new Notice(`Todo Economy: −${total} за просроченное`);
			this.store.save();
		}
	}

	private async openTasksFile(): Promise<void> {
		const file = (await this.store.ensureFile());
		if (file) await this.app.workspace.getLeaf('tab').openFile(file);
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
