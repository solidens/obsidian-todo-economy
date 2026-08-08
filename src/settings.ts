import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import {
	effectiveK, estimateMonthlyIncome, incomeFromHistory, MIN_SPAN_DAYS,
	price, solveK, suggestDayCap, suggestSoftCap,
} from './core/economy';
import { rebalance } from './core/rebalance';
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
		probe.style.cssText = 'position:absolute;left:-9999px;visibility:hidden';
		probe.style.fontFamily = s.panelFont.trim()
			? `${s.panelFont.trim()}, var(--font-monospace)`
			: 'var(--font-monospace)';
		let text: string;
		try {
			text = describeFont(probeFont(probe, GLYPH_SETS.unicode));
		} catch {
			text = 'Не удалось обмерить шрифт.';
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
			.setName('Ключ OpenRouter')
			.setDesc(
				'Бесплатный и без карты: openrouter.ai/settings/keys. Ключ хранится на этом ' +
				'устройстве и не уезжает вместе с хранилищем — на втором устройстве его нужно ввести заново.',
			)
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
					if (k && !isValidKey(k)) new Notice('Это не похоже на ключ OpenRouter (sk-or-v1-…)');
				});
			});

		new Setting(containerEl)
			.setName('Файл задач')
			.setDesc('Один markdown-файл на всё. Плагин не создаёт других заметок.')
			.addText((t) =>
				t.setPlaceholder('ТУДУ.md')
					.setValue(s.tasksFile)
					.onChange((v) => {
						s.tasksFile = v.trim() || 'ТУДУ.md';
						store.save();
						void store.refreshTasks();
					}),
			);

		new Setting(containerEl)
			.setName('Строгий режим')
			.setDesc(
				'Восстановительные награды — сон, прогулка, отдых — по умолчанию не требуют закрытой ' +
				'задачи. В плохой день человек не закрывает задачи именно потому, что вымотан, и ' +
				'система, которая в этот момент запрещает отдохнуть, добивает вместо того, чтобы вытаскивать.',
			)
			.addToggle((t) =>
				t.setValue(s.strictRestore).onChange((v) => {
					s.strictRestore = v;
					store.save();
				}),
			);

		containerEl.createEl('h3', { text: 'Панель' });

		new Setting(containerEl)
			.setName('Шрифт панели')
			.setDesc(
				'Пусто — брать моноширинный шрифт из настроек Obsidian. Выравнивание держится ' +
				'на разметке, а не на подсчёте символов, поэтому годится и дуоспейсный шрифт: ' +
				'iA Writer Duo S, где m и w в полтора раза шире прочих, рисуется ровно.',
			)
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
			.setName('Псевдографика')
			.setDesc(
				'Авто проверяет, держит ли шрифт ширину ячейки на ─ │ █ ░. Если этих символов ' +
				'в нём нет, они подставляются из чужого семейства и разъезжаются — тогда панель ' +
				'сама переходит на ASCII. Видишь пустые квадраты — поставь ASCII вручную.',
			)
			.addDropdown((d) =>
				d.addOptions({ auto: 'авто', unicode: 'юникод', ascii: 'ASCII' })
					.setValue(s.glyphMode)
					.onChange((v) => {
						s.glyphMode = v as State['glyphMode'];
						store.save();
						this.plugin.refitViews();
						this.refreshFontNote();
					}),
			);

		containerEl.createEl('h3', { text: 'Экономика' });

		new Setting(containerEl)
			.setName('Потолок начислений за день')
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
			.setName('Порог сгорания')
			.setDesc('Выше этого баланса излишек тает на 5 % в день. Без него накопленное однажды оплачивает неделю саморазрушения.')
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
			.setName('Пересчитать по факту')
			.setDesc(
				fact
					? `За ${fact.spanDays} дн. ты зарабатываешь ${fact.monthly}/мес, а система считает по ` +
						`${s.economy.monthlyIncome}/мес из онбординга. Пересчёт заново решит k по фактическому ` +
						'приходу и уберёт ручную поправку.'
					: `Нужно хотя бы ${MIN_SPAN_DAYS} дней закрытых задач. Пока данных мало — можно пересчитать ` +
						'по оценке из онбординга.',
			)
			.addButton((b) =>
				b.setButtonText(fact ? 'По факту' : 'По оценке').onClick(() => {
					if (!s.rewards.length) {
						new Notice('Нечего пересчитывать: нет наград.');
						return;
					}
					if (fact) {
						const r = rebalance(s, 'solve');
						store.save();
						this.display();
						new Notice(r.applied ? `Приход ≈ ${s.economy.monthlyIncome}/мес по факту.` : r.report);
						return;
					}
					if (!s.profile) {
						new Notice('Нечего пересчитывать: нет профиля.');
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
					new Notice(`Готово. Приход ≈ ${income} баллов в месяц.`);
				}),
			);

		if (s.economy.tune !== 1) {
			new Setting(containerEl)
				.setName('Ручная поправка к ценам')
				.setDesc(
					`Сейчас ×${s.economy.tune}. Она появляется, когда просишь в чате сделать дешевле или ` +
					'дороже. Пока поправка не равна единице, цены не решены, а подкручены — пересчёт по ' +
					'факту вернёт их к честным.',
				)
				.addButton((b) =>
					b.setButtonText('Убрать').onClick(() => {
						s.economy.tune = 1;
						store.save();
						this.display();
					}),
				);
		}

		if (s.rewards.length) {
			const list = containerEl.createEl('ul', { cls: 'te-settings-list' });
			for (const r of s.rewards.slice().sort((a, b) => price(a, effectiveK(s.economy)) - price(b, effectiveK(s.economy)))) {
				const tag = r.kind === 'harmful' ? ' · вредное' : r.kind === 'restore' ? ' · восстановление' : '';
				const cap = r.weeklyCap ? `, ≤${r.weeklyCap}/нед` : '';
				const li = list.createEl('li');
				li.createSpan({ text: `${price(r, effectiveK(s.economy))}  ${r.title}${tag}${cap}` });
				li.createEl('button', { text: 'убрать' }).addEventListener('click', () => {
					s.rewards = s.rewards.filter((x) => x.id !== r.id);
					store.save();
					this.display();
				});
			}
		}

		containerEl.createEl('h3', { text: 'Обслуживание' });

		new Setting(containerEl)
			.setName('Модель')
			.setDesc(s.lastModel ? `Последней отвечала ${s.lastModel}` : 'Пока никто не отвечал.')
			.addButton((b) =>
				b.setButtonText('Сбросить кэш моделей').onClick(() => {
					resetModelCache();
					new Notice('Рейтинг моделей будет запрошен заново.');
				}),
			);

		new Setting(containerEl)
			.setName('Пройти онбординг заново')
			.setDesc('Сотрёт профиль, награды и переписку. Баланс, задачи и история покупок останутся.')
			.addButton((b) =>
				b.setWarning().setButtonText('Начать заново').onClick(() => {
					s.onboarded = false;
					s.onboardStep = isValidKey(store.apiKey) ? 'workday' : 'key';
					s.profile = null;
					s.rewards = [];
					s.chat = [];
					store.save();
					this.display();
					new Notice('Открой панель — чат начнёт сначала.');
				}),
			);
	}
}
