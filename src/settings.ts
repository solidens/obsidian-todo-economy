import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import {
	effectiveK, estimateMonthlyIncome, incomeFromHistory, MIN_SPAN_DAYS,
	price, solveK, suggestDayCap, suggestSoftCap,
} from './core/economy';
import { rebalance } from './core/rebalance';
import { t as L, type LangPref } from './core/i18n';
import { isValidKey } from './llm/parse';
import { resetModelCache } from './llm/models';
import { describeFont, GLYPH_SETS, probeFont } from './ui/ascii';
import type { State } from './core/types';
import type TodoEconomyPlugin from './main';

export class EconomySettingsTab extends PluginSettingTab {
	private plugin: TodoEconomyPlugin;
	private fontNote: HTMLElement | null = null;

	constructor(app: App, plugin: TodoEconomyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Обмерить выбранный шрифт прямо здесь и сказать, что получилось.
	 * Проба своя, а не из панели: настройки открываются и без открытой панели.
	 */
	private refreshFontNote(): void {
		const el = this.fontNote;
		if (!el) return;
		const s = this.plugin.store.state;
		const probe = el.createDiv();
		probe.setCssStyles({
			position: 'absolute', left: '-9999px', visibility: 'hidden',
			fontFamily: s.panelFont.trim()
				? `${s.panelFont.trim()}, var(--font-monospace)`
				: 'var(--font-monospace)',
		});
		let text: string;
		try {
			text = describeFont(probeFont(probe, GLYPH_SETS.unicode));
		} catch {
			text = L().fontMeasureFailed;
		}
		probe.remove();
		el.setText(text);
	}

	display(): void {
		const { containerEl } = this;
		const store = this.plugin.store;
		const s = store.state;
		containerEl.empty();

		new Setting(containerEl)
			.setName(L().setKey)
			.setDesc(L().setKeyDesc)
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setPlaceholder('sk-or-v1-…')
					.setValue(store.apiKey)
					.onChange((v) => {
						const k = v.trim();
						if (!k || isValidKey(k)) store.setApiKey(k);
					});
				t.inputEl.addEventListener('blur', () => {
					const k = t.getValue().trim();
					if (k && !isValidKey(k)) new Notice(L().setKeyBad);
				});
			});

		new Setting(containerEl)
			.setName(L().setFile)
			.setDesc(L().setFileDesc)
			.addText((t) => {
				t.setPlaceholder(L().defaultFileName)
					.setValue(s.tasksFile)
					.onChange((v) => {
						s.tasksFile = v.trim();
						store.save();
					});
				// Перечитать файл только когда человек закончил печатать путь —
				// иначе каждая буква гоняет чтение по несуществующему промежуточному
				// пути и может рассинхронизировать состояние с параллельным чтением.
				t.inputEl.addEventListener('blur', () => void store.refreshTasks());
			});

		new Setting(containerEl)
			.setName(L().setLang)
			.setDesc(L().setLangDesc)
			.addDropdown((d) =>
				d.addOptions({ auto: L().setLangAuto, ru: 'Русский', en: 'English' })
					.setValue(s.langPref)
					.onChange((v) => {
						s.langPref = v as LangPref;
						store.save();
						this.plugin.applyLang();
						this.display();
						new Notice(L().setLangChanged);
					}),
			);

		new Setting(containerEl)
			.setName(L().setStrict)
			.setDesc(L().setStrictDesc)
			.addToggle((t) =>
				t.setValue(s.strictRestore).onChange((v) => {
					s.strictRestore = v;
					store.save();
				}),
			);

		new Setting(containerEl).setName(L().setPanel).setHeading();

		new Setting(containerEl)
			.setName(L().setFont)
			.setDesc(L().setFontDesc)
			.addText((t) =>
				t.setPlaceholder('iA Writer Mono S')
					.setValue(s.panelFont)
					.onChange((v) => {
						s.panelFont = v.trim();
						store.save();
						this.plugin.refitViews();
						this.refreshFontNote();
					}),
			);

		this.fontNote = containerEl.createDiv({ cls: 'te-font-note' });
		this.refreshFontNote();

		new Setting(containerEl)
			.setName(L().setGlyphs)
			.setDesc(L().setGlyphsDesc)
			.addDropdown((d) =>
				d.addOptions({ auto: L().setGlyphsAuto, unicode: L().setGlyphsUnicode, ascii: 'ASCII' })
					.setValue(s.glyphMode)
					.onChange((v) => {
						s.glyphMode = v as State['glyphMode'];
						store.save();
						this.plugin.refitViews();
						this.refreshFontNote();
					}),
			);

		new Setting(containerEl).setName(L().setEconomy).setHeading();

		new Setting(containerEl)
			.setName(L().setDayCap)
			.addText((t) =>
				t.setValue(String(s.economy.dayCap)).onChange((v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n > 0) {
						s.economy.dayCap = Math.round(n);
						store.save();
					}
				}),
			);

		new Setting(containerEl)
			.setName(L().setSoftCap)
			.setDesc(L().setSoftCapDesc)
			.addText((t) =>
				t.setValue(String(s.economy.softCap)).onChange((v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n > 0) {
						s.economy.softCap = Math.round(n);
						store.save();
					}
				}),
			);

		const fact = incomeFromHistory(s.history);

		new Setting(containerEl)
			.setName(L().setResolve)
			.setDesc(
				fact
					? L().setResolveFact(fact.spanDays, fact.monthly, s.economy.monthlyIncome)
					: L().setResolveThin(MIN_SPAN_DAYS),
			)
			.addButton((b) =>
				b.setButtonText(fact ? L().setResolveByFact : L().setResolveByGuess).onClick(() => {
					if (!s.rewards.length) {
						new Notice(L().setNoRewards);
						return;
					}
					if (fact) {
						const r = rebalance(s, 'solve');
						store.save();
						this.display();
						new Notice(r.applied ? L().setIncomeFact(s.economy.monthlyIncome) : r.report);
						return;
					}
					if (!s.profile) {
						new Notice(L().setNoProfile);
						return;
					}
					const income = estimateMonthlyIncome(s.profile);
					s.economy = {
						monthlyIncome: income,
						k: solveK(income, s.rewards),
						dayCap: suggestDayCap(income, s.profile.workdays),
						softCap: suggestSoftCap(income),
						tune: 1,
					};
					store.save();
					this.display();
					new Notice(L().setIncomeDone(income));
				}),
			);

		if (s.economy.tune !== 1) {
			new Setting(containerEl)
				.setName(L().setTune)
				.setDesc(L().setTuneDesc(s.economy.tune))
				.addButton((b) =>
					b.setButtonText(L().setTuneDrop).onClick(() => {
						s.economy.tune = 1;
						store.save();
						this.display();
					}),
				);
		}

		if (s.rewards.length) {
			const list = containerEl.createEl('ul', { cls: 'te-settings-list' });
			for (const r of s.rewards.slice().sort((a, b) => price(a, effectiveK(s.economy)) - price(b, effectiveK(s.economy)))) {
				const tag = r.kind === 'harmful' ? L().tagHarmful : r.kind === 'restore' ? L().tagRestore : '';
				const cap = r.weeklyCap ? L().perWeekShort(r.weeklyCap) : '';
				const li = list.createEl('li');
				li.createSpan({ text: `${price(r, effectiveK(s.economy))}  ${r.title}${tag}${cap}` });
				li.createEl('button', { text: L().setRemove }).addEventListener('click', () => {
					s.rewards = s.rewards.filter((x) => x.id !== r.id);
					store.save();
					this.display();
				});
			}
		}

		new Setting(containerEl).setName(L().setMaintenance).setHeading();

		new Setting(containerEl)
			.setName(L().setModel)
			.setDesc(s.lastModel ? L().setModelLast(s.lastModel) : L().setModelNone)
			.addButton((b) =>
				b.setButtonText(L().setModelReset).onClick(() => {
					resetModelCache();
					new Notice(L().setModelResetDone);
				}),
			);

		new Setting(containerEl)
			.setName(L().setRestart)
			.setDesc(L().setRestartDesc)
			.addButton((b) =>
				b.setWarning().setButtonText(L().setRestartGo).onClick(() => {
					s.onboarded = false;
					s.onboardStep = isValidKey(store.apiKey) ? 'workday' : 'key';
					s.profile = null;
					s.rewards = [];
					s.chat = [];
					store.save();
					this.display();
					new Notice(L().setRestartDone);
				}),
			);
	}
}
