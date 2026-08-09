/**
 * Панель. Всё, что связано с DOM и жизненным циклом Obsidian, — здесь.
 * Раскладка приходит готовой из screens.ts, арифметика — из core/.
 */

import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type { Brain } from '../brain';
import { buy, checkBuy, earn, undo } from '../core/ledger';
import { dayKey } from '../core/time';
import type { Store } from '../store';
import * as A from './ascii';
import { render, type Pomodoro, type Tab } from './screens';

export const VIEW_TYPE = 'todo-economy';

const WORK = 25 * 60;
const REST = 5 * 60;

export class EconomyView extends ItemView {
	private store: Store;
	private brain: Brain;
	private tab: Tab = 'goals';
	private cols = 48;
	private textCols = 44;
	private profile: A.FontProfile = { cell: 8, prose: 8, kind: 'mono', wide: [], gridSafe: true };
	private glyphs: A.Glyphs = A.GLYPH_SETS.unicode;
	private hits: HTMLElement[] = [];
	private grid!: HTMLElement;
	private ro: ResizeObserver | null = null;
	private pomo: Pomodoro = { taskId: null, left: WORK, running: false, rest: false };

	constructor(leaf: WorkspaceLeaf, store: Store, brain: Brain) {
		super(leaf);
		this.store = store;
		this.brain = brain;
	}

	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return 'Todo Economy'; }
	getIcon(): string { return 'target'; }

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('te-root');
		this.grid = root.createDiv({ cls: 'te-grid' });
		this.grid.setAttribute('role', 'application');
		this.grid.setAttribute('aria-label', 'Todo Economy');

		this.registerDomEvent(this.grid, 'keydown', A.wireKeyboard(this.grid, () => this.hits));
		this.register(this.store.onChange(() => this.draw()));

		this.ro = new ResizeObserver(() => this.remeasure());
		this.ro.observe(root);
		this.register(() => { this.ro?.disconnect(); this.ro = null; });

		this.registerInterval(window.setInterval(() => this.tick(), 1000));

		this.brain.greet();
		if (!this.store.state.onboarded) this.tab = 'chat';
		this.refit();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/* ── шрифт и метрики ───────────────────────────────────────────────── */

	/**
	 * Полный пересчёт: применить шрифт, обмерить его, выбрать псевдографику.
	 * Дороже, чем remeasure, поэтому вызывается только на открытии и на
	 * смене настроек, а не на каждое движение границы панели.
	 */
	refit(): void {
		const font = this.store.state.panelFont.trim();
		this.grid.setCssStyles({ fontFamily: font ? `${font}, var(--font-monospace)` : '' });

		this.profile = A.probeFont(this.grid, A.GLYPH_SETS.unicode);
		this.glyphs = A.pickGlyphs(this.store.state.glyphMode, this.profile.gridSafe);
		this.remeasure(true);
	}

	private remeasure(force = false): void {
		const cols = A.colsFor(this.grid, this.profile.cell);
		const textCols = A.textColsFor(this.grid, this.profile.prose);
		const changed = cols !== this.cols || textCols !== this.textCols;
		this.cols = cols;
		this.textCols = textCols;
		if (force || changed || !this.hits.length) this.draw();
	}

	get fontProfile(): A.FontProfile { return this.profile; }

	/* ── отрисовка ─────────────────────────────────────────────────────── */

	private draw(): void {
		this.hits = A.paint(
			this.grid,
			render({
				store: this.store,
				cols: this.cols,
				textCols: this.textCols,
				g: this.glyphs,
				tab: this.tab,
				pomo: this.pomo,
				busy: this.brain.busy,
			}),
			{ onAct: (a) => void this.act(a), onSubmit: (a, v) => void this.submit(a, v) },
		);
	}

	private tick(): void {
		if (!this.pomo.running) return;
		this.pomo.left = Math.max(0, this.pomo.left - 1);
		if (this.pomo.left === 0) {
			if (this.pomo.rest) {
				this.pomo = { taskId: null, left: WORK, running: false, rest: false };
				new Notice('Перерыв закончился.');
			} else {
				this.pomo = { ...this.pomo, left: REST, rest: true };
				new Notice('Помодоро закончился — пять минут.');
			}
		}
		this.draw();
	}

	/* ── действия ──────────────────────────────────────────────────────── */

	private async submit(act: string, value: string): Promise<void> {
		if (act !== 'compose') return;
		this.draw();
		await this.brain.send(value);
		this.draw();
	}

	private async act(act: string): Promise<void> {
		const [kind, id] = act.split(':');
		const s = this.store.state;

		switch (kind) {
			case 'tab':
				this.tab = id as Tab;
				this.draw();
				return;

			case 'open': {
				const f = this.app.vault.getAbstractFileByPath(this.store.filePath);
				if (f instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(f);
				return;
			}

			case 'create':
				await this.store.ensureFile();
				await this.store.refreshTasks();
				return;

			case 'toggle': {
				const current = this.store.tasks.find((t) => t.id === id);
				if (!current) return;
				const next = await this.store.setDone(id, !current.done, dayKey());
				if (!next) return;
				if (next.done) {
					const got = earn(s, next);
					new Notice(`+${got}  ${next.title}`);
				} else {
					const back = undo(s, next);
					if (back) new Notice(`−${back}  откат`);
				}
				this.store.save();
				return;
			}

			case 'focus': {
				const same = this.pomo.taskId === id;
				this.pomo = same
					? { ...this.pomo, running: !this.pomo.running }
					: { taskId: id, left: WORK, running: true, rest: false };
				this.draw();
				return;
			}

			case 'stop':
				this.pomo = { taskId: null, left: WORK, running: false, rest: false };
				this.draw();
				return;

			case 'buy': {
				const r = s.rewards.find((x) => x.id === id);
				if (!r) return;
				const chk = checkBuy(s, r, this.store.doneToday());
				if (!chk.ok) {
					new Notice(chk.reason ?? 'Пока нельзя');
					return;
				}
				const paid = buy(s, r);
				new Notice(`−${paid}  ${r.title}`);
				this.store.save();
				return;
			}
		}
	}
}
