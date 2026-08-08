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
import { saneRepeat } from './core/recurrence';
import type { Task } from './core/types';
import { toRewards, toRoutine, toTask, toWorkdays } from './core/intake';
import { describeRepeat } from './core/recurrence';

import { extractJson, isValidKey } from './llm/parse';
import { ask, type Msg } from './llm/chat';
import type { OnboardStep } from './core/types';
import type { Store } from './store';

const JSON_ONLY = 'Отвечай ТОЛЬКО валидным JSON без пояснений и без markdown-обёртки.';

const SCALES = `Шкалы: min — оценка в минутах (число). diff — сложность от 0.5 (механика) до 2.0 (тяжёлое, требует включённости). prio — важность от 0.5 (можно не делать) до 2.0 (критично). Сложность и длительность — разные вещи: два часа мыть посуду это min 120 diff 0.6.`;

const PROMPTS: Record<string, string> = {
	workday: `Из ответа человека вытащи, сколько дней в неделю он работает. ${JSON_ONLY} Формат: {"workdays": 5}`,

	routine: `Человек описал свои регулярные дела. Разбери их в список. ${SCALES} perWeek — сколько раз в неделю это бывает (число, можно дробное). ${JSON_ONLY} Формат: {"routine":[{"title":"...","min":60,"diff":1.2,"prio":1.4,"perWeek":5}]}`,

	rewards: `Человек описал, чем себя награждает. Разбери в список. value — насколько это для него ценно, от 0.2 до 5.0. freq — сколько раз в месяц он хотел бы это получать. kind: "restore" если это отдых и восстановление (сон, прогулка, тишина), иначе "normal". ${JSON_ONLY} Формат: {"rewards":[{"title":"...","value":2.0,"freq":8,"kind":"normal"}]}`,

	harmful: `Человек описал, на что залипает и потом жалеет. Разбери в список. value — насколько это его тянет, от 0.2 до 5.0. harm — насколько разрушительно, от 1.0 до 3.0. freq — сколько раз в месяц это случается сейчас. weeklyCap — разумный жёсткий лимит раз в неделю. ${JSON_ONLY} Формат: {"rewards":[{"title":"...","value":1.5,"harm":2.4,"freq":12,"weeklyCap":2}]}`,

	intake: `Разбери фразу человека. Отдельно следи за жалобами на несправедливость оценки — их два разных сорта, и путать их нельзя.

Несправедлива оценка ОДНОЙ задачи («отчёт вовсе не на полтора часа, а на три», «зарядка идёт тяжелее, чем записано», «это дело важнее») — верни adjust и только те поля, которые меняются:
{"kind":"adjust","target":"часть названия задачи","min":180,"diff":1.6,"prio":1.8}

Несправедлива ВСЯ система — верни rebalance:
{"kind":"rebalance","want":"cheaper"} — «награды слишком дорогие», «до них не добраться», «ничего не могу себе позволить»
{"kind":"rebalance","want":"pricier"} — «слишком легко покупается», «баллы девать некуда», «награды ничего не стоят»
{"kind":"rebalance","want":"solve"} — «пересчитай по факту», «в онбординге я наврал», «система в целом кривая», «это несправедливо» без указания стороны

Если жалоба общая и непонятно, в какую сторону — бери "solve": честнее пересчитать приход по фактическим начислениям, чем подкручивать цены наугад.

Дальше — обычный разбор. Если это дело — верни задачу, если это то, чем он себя награждает — награду, иначе none. ${SCALES} due — срок в формате YYYY-MM-DD, только если он явно назван. repeat — раз в сколько дней дело повторяется: 1 для «каждый день» и «ежедневно», 2 для «через день», 7 для «раз в неделю». Ставь repeat только если человек прямо сказал, что дело регулярное. ${JSON_ONLY} Форматы: {"kind":"task","title":"...","min":90,"diff":1.2,"prio":1.4,"due":"2026-08-08","repeat":1} или {"kind":"reward","title":"...","value":2.0,"freq":8,"kind2":"normal"} или {"kind":"none"}`,
};

const QUESTIONS: Record<OnboardStep, string> = {
	key: 'Привет. Чтобы чат заработал, нужен ключ OpenRouter — бесплатный и без карты.\nopenrouter.ai/settings/keys → Create key → скопировать → вставить сюда.\n\nКлюч остаётся на этом устройстве и в хранилище не уезжает.',
	workday: 'Сколько дней в неделю ты обычно работаешь?',
	routine: 'Расскажи про свои обычные дела — что делаешь регулярно, сколько это занимает и насколько тяжело идёт. Можно списком, можно как есть.',
	rewards: 'А чем ты себя награждаешь? Что для тебя отдых и что просто приятно.',
	harmful: 'Теперь про вредное: на что залипаешь и потом жалеешь?\n\nОтвечать честно выгодно — система не запрещает вредное, она делает его цену честной.',
	confirm: '',
	done: '',
};

const SKIP = /^\s*(пропустить|дальше|скип|нет|не знаю|—|-)\s*$/i;
const YES = /^\s*(да|ок|окей|поехали|годится|записывай|давай|принято|\+)\s*$/i;
const AGAIN = /^\s*(заново|сначала|переделать|ещё раз)\s*$/i;

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
		this.say('assistant', QUESTIONS[s.onboardStep]);
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
			this.say('system', 'Что-то пошло не так. Попробуй ещё раз.');
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
			this.say('system', 'Ключ не задан. Вставь ключ OpenRouter — он начинается с sk-or-v1-.');
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
			this.say('system', 'Модель ответила не по формату. Попробуй сказать то же самое проще — или напиши «пропустить».');
		}
		return parsed;
	}

	/* ── онбординг ─────────────────────────────────────────────────────── */

	private goTo(step: OnboardStep): void {
		this.store.state.onboardStep = step;
		if (QUESTIONS[step]) this.say('assistant', QUESTIONS[step]);
	}

	private async onboard(msg: string): Promise<void> {
		const s = this.store.state;

		if (s.onboardStep === 'key') {
			if (!isValidKey(msg)) {
				this.say('system', 'Это не похоже на ключ OpenRouter. Он выглядит так: sk-or-v1-…');
				return;
			}
			this.store.setApiKey(msg);
			this.say('assistant', 'Ключ принят.');
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
				this.say('assistant',
					'Готово. Дальше просто пиши сюда: «завтра дожать отчёт, часа полтора, идёт тяжело, важное» — заведётся задача.\n\nЗадачи лежат в ' + this.store.filePath + ' обычными галочками, их можно править руками.');
				await this.store.ensureFile();
				return;
			}
			this.say('assistant', 'Скажи «да», если цены годятся, или «заново», чтобы пересобрать.');
			return;
		}

		const skip = SKIP.test(msg);

		if (s.onboardStep === 'workday') {
			let days = 5;
			if (!skip) {
				const j = await this.parse<unknown>(PROMPTS.workday, msg);
				if (j === null) return;
				days = toWorkdays(j) ?? 5;
			}
			s.profile = { workdays: days, routine: [] };
			this.goTo('routine');
			return;
		}

		if (s.onboardStep === 'routine') {
			if (!skip) {
				const j = await this.parse<unknown>(PROMPTS.routine, msg);
				if (j === null) return;
				const routine = toRoutine((j as Record<string, unknown>).routine ?? j);
				if (!routine.length) {
					this.say('system', 'Не разобрал ни одного дела. Попробуй иначе — или «пропустить».');
					return;
				}
				if (!s.profile) s.profile = { workdays: 5, routine: [] };
				s.profile.routine.push(...routine);
				this.say('assistant', `Записал дел: ${routine.length}.`);
			}
			this.goTo('rewards');
			return;
		}

		if (s.onboardStep === 'rewards') {
			if (!skip) {
				const j = await this.parse<unknown>(PROMPTS.rewards, msg);
				if (j === null) return;
				const rewards = toRewards((j as Record<string, unknown>).rewards ?? j, 'normal', s.rewards);
				if (!rewards.length) {
					this.say('system', 'Не разобрал ни одной награды. Попробуй иначе — или «пропустить».');
					return;
				}
				s.rewards.push(...rewards);
				this.say('assistant', `Записал наград: ${rewards.length}.`);
			}
			this.goTo('harmful');
			return;
		}

		if (s.onboardStep === 'harmful') {
			if (!skip) {
				const j = await this.parse<unknown>(PROMPTS.harmful, msg);
				if (j !== null) {
					const harmful = toRewards((j as Record<string, unknown>).rewards ?? j, 'harmful', s.rewards);
					s.rewards.push(...harmful);
					if (harmful.length) this.say('assistant', `Записал вредного: ${harmful.length}.`);
				}
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
			this.say('system',
				'Слишком мало данных, чтобы решить экономику: нужны хотя бы одно регулярное дело и одна награда. Расскажи ещё раз — или заведи их руками в настройках.');
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
				const tag = r.kind === 'harmful' ? ' · вредное' : r.kind === 'restore' ? ' · восстановление' : '';
				const cap = r.weeklyCap ? `, не чаще ${r.weeklyCap} раз в неделю` : '';
				return `  ${price(r, effectiveK(s.economy))}  ${r.title}${tag}${cap}`;
			});

		s.onboardStep = 'confirm';
		this.say('assistant',
			`Посчитал. Приход около ${income} баллов в месяц, потолок за день ${s.economy.dayCap}.\n\nЦены получились такие:\n${lines.join('\n')}\n\nОни решены из твоего прихода, а не выдуманы: если тратить награды с той частотой, что ты назвал, приход ровно сойдётся с тратами.\n\nЗаписать? Скажи «да» или «заново».`);
	}

	/* ── обычный разбор ────────────────────────────────────────────────── */

	private async intake(msg: string): Promise<void> {
		const j = await this.parse<Record<string, unknown>>(PROMPTS.intake, msg);
		if (!j) return;
		const kind = String(j.kind ?? '').toLowerCase();

		if (kind === 'task') {
			const t = toTask(j);
			if (!t) {
				this.say('system', 'Не понял, что за задача. Попробуй назвать её и сказать, сколько займёт.');
				return;
			}
			const id = await this.store.addTask(t);
			if (!id) return;
			const due = t.due ? `, срок ${t.due}` : '';
			const rep = t.repeat ? `, ${describeRepeat(t.repeat)}` : '';
			this.say('assistant',
				`Завёл: ${t.title}\n  ${t.min} мин · сложн ${t.diff} · прио ${t.prio}${due}${rep}`);
			return;
		}

		if (kind === 'adjust') {
			await this.adjustTask(j);
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
				this.say('system', 'Не понял, что за награда.');
				return;
			}
			this.store.state.rewards.push(r);
			this.say('assistant',
				`Завёл награду: ${r.title} — ${price(r, effectiveK(this.store.state.economy))} баллов`);
			return;
		}

		this.say('assistant', 'Это не похоже ни на задачу, ни на награду. Скажи, что нужно сделать или чем себя наградить.');
	}

	/**
	 * Правка оценки одной задачи. Меняются только названные поля — молчаливо
	 * переписать остальные значениями по умолчанию было бы хуже, чем ничего.
	 */
	private async adjustTask(j: Record<string, unknown>): Promise<void> {
		const target = String(j.target ?? j.title ?? '').trim();
		const t = findTask(this.store.tasks, target);
		if (!t) {
			this.say('system',
				target
					? `Не нашёл задачу «${target}» — или под это подходит сразу несколько. Назови точнее.`
					: 'Не понял, какую задачу поправить.');
			return;
		}

		const patch: Partial<Task> = {};
		if (j.min !== undefined) patch.min = sane.min(Number(j.min));
		if (j.diff !== undefined) patch.diff = sane.diff(Number(j.diff));
		if (j.prio !== undefined) patch.prio = sane.prio(Number(j.prio));
		if (j.repeat !== undefined) patch.repeat = saneRepeat(j.repeat);

		if (!Object.keys(patch).length) {
			this.say('system', 'Понял, что оценка не нравится, но не понял, что именно поменять: минуты, сложность или важность?');
			return;
		}

		const was = award(t);
		const next = await this.store.patchTask(t.id, patch);
		if (!next) return;

		this.say('assistant',
			`Поправил «${next.title}»: ${next.min} мин · сложн ${next.diff} · прио ${next.prio}\n` +
			`  начисление ${was} → ${award(next)}`);
	}
}
