/**
 * Чат: онбординг и обычный разбор фраз. Онбординг устроен так же, как в вебе —
 * не форма, а разговор. Отвечай обычными словами, модель сама разберёт, что
 * насколько сложное и приоритетное.
 *
 * Каждый шаг деградирует по-хорошему: невалидный ответ модели не применяется,
 * шаг остаётся на месте, и его всегда можно пропустить словом «пропустить».
 */

import {
	award, effectiveK, estimateMonthlyIncome, price, sane, solveK,
	suggestDayCap, suggestSoftCap,
} from './core/economy';
import { rebalance, findTask, type Complaint } from './core/rebalance';
import { detectRepeat, saneRepeat } from './core/recurrence';
import type { Task } from './core/types';
import { t as L } from './core/i18n';
import { toRewards, toRoutine, toTask, toWorkdays } from './core/intake';
import { describeRepeat } from './core/recurrence';

import { extractJson, isValidKey } from './llm/parse';
import { ask, type Msg } from './llm/chat';
import type { OnboardStep } from './core/types';
import type { Store } from './store';

/**
 * Промпты и вопросы онбординга живут в словаре: модель отвечает на том языке,
 * на котором её спросили, и разбирать русскую фразу английским промптом —
 * верный способ получить кальку вместо названия задачи.
 */
const prompts = (): Record<string, string> => {
	const d = L();
	return {
		workday: d.pWorkday(d.pJsonOnly),
		routine: d.pRoutine(d.pScales, d.pJsonOnly),
		rewards: d.pRewards(d.pJsonOnly),
		harmful: d.pHarmful(d.pJsonOnly),
		intake: d.pIntake(d.pScales, d.pJsonOnly),
	};
};

const questions = (): Record<OnboardStep, string> => ({
	key: L().qKey,
	workday: L().qWorkday,
	routine: L().qRoutine,
	rewards: L().qRewards,
	harmful: L().qHarmful,
	confirm: '',
	done: '',
});

// Короткие согласия ловятся на обоих языках сразу: человек с английским
// интерфейсом вполне может ответить «да», и наоборот.
const SKIP = /^\s*(пропустить|дальше|скип|нет|не знаю|skip|next|no|dunno|—|-)\s*$/i;
const YES = /^\s*(да|ок|окей|поехали|годится|записывай|давай|принято|yes|yep|ok|okay|sure|go|save|\+)\s*$/i;
const AGAIN = /^\s*(заново|сначала|переделать|ещё раз|again|redo|restart|over)\s*$/i;

export class Brain {
	busy = false;

	constructor(private store: Store) {}

	private say(role: 'user' | 'assistant' | 'system', text: string): void {
		this.store.state.chat.push({ role, text, at: Date.now() });
		if (this.store.state.chat.length > 120) this.store.state.chat.shift();
		this.store.save();
	}

	/** Первое, что человек видит в пустом чате. */
	greet(): void {
		if (this.store.state.chat.length) return;
		const s = this.store.state;
		s.onboardStep = isValidKey(this.store.apiKey) ? 'workday' : 'key';
		this.say('assistant', questions()[s.onboardStep]);
	}

	async send(text: string): Promise<void> {
		if (this.busy) return;
		const msg = text.trim();
		if (!msg) return;
		this.say('user', msg);
		this.busy = true;
		try {
			if (this.store.state.onboarded) await this.intake(msg);
			else await this.onboard(msg);
		} catch (e) {
			console.error(e);
			this.say('system', L().sysFailed);
		} finally {
			this.busy = false;
			this.store.save();
		}
	}

	/** Один запрос к модели с разбором JSON. null — разбор не удался. */
	private async parse<T>(system: string, user: string): Promise<T | null> {
		const key = this.store.apiKey;
		if (!isValidKey(key)) {
			this.store.state.onboardStep = 'key';
			this.say('system', L().keyMissing);
			return null;
		}
		const messages: Msg[] = [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		];
		const r = await ask(key, messages);
		if (!r.ok) {
			if (!r.retry) this.store.state.onboardStep = 'key';
			this.say('system', r.message);
			return null;
		}
		this.store.state.lastModel = r.model;
		const parsed = extractJson<T>(r.value);
		if (parsed === null) {
			this.say('system', L().badFormat);
		}
		return parsed;
	}

	/* ── онбординг ─────────────────────────────────────────────────────── */

	private goTo(step: OnboardStep): void {
		this.store.state.onboardStep = step;
		const q = questions()[step];
		if (q) this.say('assistant', q);
	}

	private async onboard(msg: string): Promise<void> {
		const s = this.store.state;

		if (s.onboardStep === 'key') {
			if (!isValidKey(msg)) {
				this.say('system', L().notAKey);
				return;
			}
			this.store.setApiKey(msg);
			this.say('assistant', L().keyAccepted);
			this.goTo('workday');
			return;
		}

		if (s.onboardStep === 'confirm') {
			if (AGAIN.test(msg)) {
				s.profile = null;
				s.rewards = [];
				this.goTo('workday');
				return;
			}
			if (YES.test(msg)) {
				s.onboarded = true;
				s.onboardStep = 'done';
				this.say('assistant', L().onboardDone(this.store.filePath));
				await this.store.ensureFile();
				return;
			}
			this.say('assistant', L().confirmAsk);
			return;
		}

		const skip = SKIP.test(msg);

		if (s.onboardStep === 'workday') {
			let days = 5;
			if (!skip) {
				const j = await this.parse<unknown>(prompts().workday, msg);
				if (j === null) return;
				days = toWorkdays(j) ?? 5;
			}
			s.profile = { workdays: days, routine: [] };
			this.goTo('routine');
			return;
		}

		if (s.onboardStep === 'routine') {
			if (!skip) {
				const j = await this.parse<unknown>(prompts().routine, msg);
				if (j === null) return;
				const routine = toRoutine((j as Record<string, unknown>).routine ?? j);
				if (!routine.length) {
					this.say('system', L().noRoutineParsed);
					return;
				}
				if (!s.profile) s.profile = { workdays: 5, routine: [] };
				s.profile.routine.push(...routine);
				this.say('assistant', L().routineSaved(routine.length));
			}
			this.goTo('rewards');
			return;
		}

		if (s.onboardStep === 'rewards') {
			if (!skip) {
				const j = await this.parse<unknown>(prompts().rewards, msg);
				if (j === null) return;
				const rewards = toRewards((j as Record<string, unknown>).rewards ?? j, 'normal', s.rewards);
				if (!rewards.length) {
					this.say('system', L().noRewardsParsed);
					return;
				}
				s.rewards.push(...rewards);
				this.say('assistant', L().rewardsSaved(rewards.length));
			}
			this.goTo('harmful');
			return;
		}

		if (s.onboardStep === 'harmful') {
			if (!skip) {
				const j = await this.parse<unknown>(prompts().harmful, msg);
				if (j === null) return;
				const harmful = toRewards((j as Record<string, unknown>).rewards ?? j, 'harmful', s.rewards);
				s.rewards.push(...harmful);
				if (harmful.length) this.say('assistant', L().harmfulSaved(harmful.length));
			}
			this.solve();
		}
	}

	/** Решить систему и показать, что получилось. */
	private solve(): void {
		const s = this.store.state;
		const profile = s.profile ?? { workdays: 5, routine: [] };
		s.profile = profile;

		if (!profile.routine.length || !s.rewards.length) {
			this.say('system', L().tooThin);
			this.goTo('routine');
			return;
		}

		const income = estimateMonthlyIncome(profile);
		s.economy = {
			monthlyIncome: income,
			k: solveK(income, s.rewards),
			dayCap: suggestDayCap(income, profile.workdays),
			softCap: suggestSoftCap(income),
			tune: 1,
		};

		const lines = s.rewards
			.slice()
			.sort((a, b) => price(a, effectiveK(s.economy)) - price(b, effectiveK(s.economy)))
			.map((r) => {
				const tag = r.kind === 'harmful' ? L().tagHarmful : r.kind === 'restore' ? L().tagRestore : '';
				const cap = r.weeklyCap ? L().notCheaperThan(r.weeklyCap) : '';
				return `  ${price(r, effectiveK(s.economy))}  ${r.title}${tag}${cap}`;
			});

		s.onboardStep = 'confirm';
		this.say('assistant', L().solved(income, s.economy.dayCap, lines.join('\n')));
	}

	/* ── обычный разбор ────────────────────────────────────────────────── */

	private async intake(msg: string): Promise<void> {
		const j = await this.parse<Record<string, unknown>>(prompts().intake, msg);
		if (!j) return;
		const kind = String(j.kind ?? '').toLowerCase();

		if (kind === 'task') {
			const t = toTask(j, msg);
			if (!t) {
				this.say('system', L().notATask);
				return;
			}
			// «Работу отмечай каждый день» модель нередко разбирает как новую
			// задачу. Если такая уже есть — это правка регулярности, а не дубль.
			const same = findTask(this.store.tasks, t.title);
			if (same && t.repeat && same.repeat !== t.repeat) {
				await this.adjustTask({ target: t.title, repeat: t.repeat }, msg);
				return;
			}

			const id = await this.store.addTask(t);
			if (!id) return;
			const due = t.due ? L().dueTail(t.due) : '';
			const rep = t.repeat ? `, ${describeRepeat(t.repeat)}` : '';
			// Разовая задача после галочки больше не вернётся — про это лучше
			// сказать сразу, чем через неделю разбираться, почему нет баллов.
			const hint = t.repeat ? '' : L().onceHint;
			this.say('assistant', L().taskAdded(t.title, t.min, t.diff, t.prio, `${due}${rep}${hint}`));
			return;
		}

		if (kind === 'adjust') {
			await this.adjustTask(j, msg);
			return;
		}

		if (kind === 'rebalance') {
			const want = String(j.want ?? j.direction ?? 'solve').toLowerCase();
			const which: Complaint =
				want.startsWith('cheap') ? 'cheaper' : want.startsWith('pric') ? 'pricier' : 'solve';
			const r = rebalance(this.store.state, which);
			this.say('assistant', r.report);
			if (r.applied) this.store.save();
			return;
		}

		if (kind === 'reward') {
			const [r] = toRewards([{ ...j, kind: j.kind2 ?? 'normal' }], 'normal', this.store.state.rewards);
			if (!r) {
				this.say('system', L().notAReward);
				return;
			}
			this.store.state.rewards.push(r);
			this.say('assistant', L().rewardAdded(r.title, price(r, effectiveK(this.store.state.economy))));
			return;
		}

		this.say('assistant', L().nothingParsed);
	}

	/**
	 * Правка оценки одной задачи. Меняются только названные поля — молчаливо
	 * переписать остальные значениями по умолчанию было бы хуже, чем ничего.
	 */
	private async adjustTask(j: Record<string, unknown>, said = ''): Promise<void> {
		const target = String(j.target ?? j.title ?? '').trim();
		const t = findTask(this.store.tasks, target);
		if (!t) {
			this.say('system', target ? L().taskNotFound(target) : L().taskNotNamed);
			return;
		}

		const patch: Partial<Task> = {};
		if (j.min !== undefined) patch.min = sane.min(Number(j.min));
		if (j.diff !== undefined) patch.diff = sane.diff(Number(j.diff));
		if (j.prio !== undefined) patch.prio = sane.prio(Number(j.prio));
		// Снятие повтора — это repeat 0 или явное «не повторяй»: в обоих случаях
		// в patch попадает undefined, и плашка теряет rep.
		const drops = /\b(не\s+повторя|убер[иь].*повтор|переста(нь|ть)\s+повторя|разова)/i.test(said);
		if (j.repeat !== undefined) patch.repeat = saneRepeat(j.repeat);
		else if (drops) patch.repeat = undefined;
		else {
			const guessed = detectRepeat(said);
			if (guessed !== undefined) patch.repeat = guessed;
		}
		const touchesRepeat = 'repeat' in patch;

		if (!Object.keys(patch).length) {
			this.say('system', L().nothingToPatch);
			return;
		}

		const was = award(t);
		const next = await this.store.patchTask(t.id, patch);
		if (!next) return;

		// Включили повтор у уже закрытой задачи — пусть всплывёт сразу, если её
		// срок давно прошёл, а не ждёт следующего запуска Obsidian.
		if (touchesRepeat && next.repeat) await this.store.rollRecurring();

		const rep = touchesRepeat
			? next.repeat ? L().repeatOn(describeRepeat(next.repeat)) : L().repeatOff
			: '';

		this.say('assistant', L().patched(next.title, next.min, next.diff, next.prio, was, award(next), rep));
	}
}
