import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { price, solveK, suggestDayCap, suggestSoftCap, estimateMonthlyIncome } from './core/economy';
import { isValidKey } from './llm/parse';
import { resetModelCache } from './llm/models';
import type TodoEconomyPlugin from './main';

export class EconomySettingsTab extends PluginSettingTab {
	private plugin: TodoEconomyPlugin;

	constructor(app: App, plugin: TodoEconomyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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

		new Setting(containerEl)
			.setName('Пересчитать цены')
			.setDesc('Заново решить k по накопленному профилю и текущему списку наград.')
			.addButton((b) =>
				b.setButtonText('Пересчитать').onClick(() => {
					if (!s.profile || !s.rewards.length) {
						new Notice('Нечего пересчитывать: нет профиля или наград.');
						return;
					}
					const income = estimateMonthlyIncome(s.profile);
					s.economy = {
						monthlyIncome: income,
						k: solveK(income, s.rewards),
						dayCap: suggestDayCap(income, s.profile.workdays),
						softCap: suggestSoftCap(income),
					};
					store.save();
					this.display();
					new Notice(`Готово. Приход ≈ ${income} баллов в месяц.`);
				}),
			);

		if (s.rewards.length) {
			const list = containerEl.createEl('ul', { cls: 'te-settings-list' });
			for (const r of s.rewards.slice().sort((a, b) => price(a, s.economy.k) - price(b, s.economy.k))) {
				const tag = r.kind === 'harmful' ? ' · вредное' : r.kind === 'restore' ? ' · восстановление' : '';
				const cap = r.weeklyCap ? `, ≤${r.weeklyCap}/нед` : '';
				const li = list.createEl('li');
				li.createSpan({ text: `${price(r, s.economy.k)}  ${r.title}${tag}${cap}` });
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
