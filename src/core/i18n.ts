/**
 * Локализация. Два языка, один словарь, никакой машинерии: строка — либо
 * литерал, либо функция от подстановок. Тип словаря берётся из русского,
 * поэтому забыть ключ в английском нельзя — упадёт сборка.
 *
 * Язык выбирается один раз при загрузке плагина и живёт в модуле: таскать
 * его параметром через каждый экран и каждое уведомление — шум, которого
 * плагин с одним пользователем не заслуживает.
 *
 * Правило простое: интерфейс Obsidian на русском — плагин на русском, иначе
 * английский. Догадки про родственные языки не делаем: серб или украинец
 * скорее предпочтёт английский, чем русский, а тот, кому нужно иначе, ставит
 * язык руками в настройках.
 */

export type Lang = 'ru' | 'en';
export type LangPref = 'auto' | Lang;

/* ── определение языка ─────────────────────────────────────────────────── */

/**
 * Obsidian хранит выбранный язык в localStorage под ключом `language`;
 * для английского ключа может не быть вовсе. Коды приходят в виде `ru`,
 * иногда с регионом — сравниваем по первому сегменту.
 */
export function detectLang(raw: string | null | undefined): Lang {
	if (typeof raw !== 'string') return 'en';
	const base = raw.trim().toLowerCase().split(/[-_]/)[0];
	return base === 'ru' ? 'ru' : 'en';
}

export function resolveLang(pref: LangPref, obsidianLocale: string | null | undefined): Lang {
	return pref === 'auto' ? detectLang(obsidianLocale) : pref;
}

let current: Lang = 'ru';

export function setLang(l: Lang): void {
	current = l;
}

export function lang(): Lang {
	return current;
}

/* ── словарь ───────────────────────────────────────────────────────────── */

const RU = {
	/* панель */
	title: 'ТУДУ · ЭКОНОМИКА',
	tabGoals: 'ЦЕЛИ',
	tabRewards: 'НАГРАДЫ',
	tabChat: 'ЧАТ',
	tabHint: (label: string) => `вкладка ${label}`,
	points: ' баллов',
	noFile: 'Файла задач ещё нет.',
	createFile: (path: string) => `[ создать ${path} ]`,
	emptyTasks: 'Пусто. Напиши задачу в чат — или галочкой в файле.',
	openFile: '[ открыть файл ]',
	toggleHint: (done: boolean, title: string) => `${done ? 'снять' : 'закрыть'} задачу «${title}»`,
	returnsOn: (date: string) => `    вернётся ${date}`,
	minutes: 'мин',
	dueBy: (date: string) => `  до ${date}`,
	pause: 'пауза',
	focus: 'фокус',
	focusHint: (title: string) => `помодоро для «${title}»`,
	resetPomo: 'сбросить помодоро',
	delHint: (title: string) => `удалить «${title}»`,
	delConfirmHint: (title: string) => `нажми ещё раз, чтобы удалить «${title}»`,
	deleted: (title: string) => `удалено: ${title}`,
	today: 'сегодня  ',
	streak: 'серия    ',
	streakDays: (days: number, mult: string) => `${days} дн  ×${mult}`,
	noRewards: 'Наград пока нет. Расскажи о них в чате.',
	buy: '[ КУПИТЬ ]',
	buyHint: (title: string, price: number) => `купить «${title}» за ${price}`,
	incomeShort: (n: number) => `приход ≈ ${n}/мес`,
	chatEmpty: 'Пусто.',
	thinking: '  думает…',
	composeHint: 'завтра дожать отчёт, часа полтора',
	composeHintOnboard: 'ответь как есть',

	/* награды и покупки */
	weekCapReached: 'лимит недели выбран',
	notEnough: (n: number) => `не хватает ${n}`,
	closeTaskFirst: 'сначала закрой задачу',
	cannotBuy: 'Пока нельзя',
	tagHarmful: ' · вредное',
	tagRestore: ' · восстановление',
	perWeekShort: (n: number) => `, ≤${n}/нед`,
	notCheaperThan: (n: number) => `, не чаще ${n} раз в неделю`,

	/* журнал */
	decayNote: (days: number) => `сгорел излишек за ${days} дн.`,
	cappedNote: ' (упёрлось в дневной потолок)',
	overdueNote: (title: string) => `просрочено: ${title}`,

	/* уведомления */
	fileCreateFailed: (path: string) => `Todo Economy: не удалось создать ${path}`,
	reopened: (n: number) => `Todo Economy: снова открыто задач: ${n}`,
	penalized: (n: number) => `Todo Economy: −${n} за просроченное`,
	restOver: 'Перерыв закончился.',
	pomoOver: 'Помодоро закончился — пять минут.',
	rollback: (n: number) => `−${n}  откат`,

	/* команды */
	cmdOpenPanel: 'Открыть панель',
	cmdOpenFile: 'Открыть файл задач',
	cmdRefresh: 'Перечитать файл задач',
	cmdRestartOnboarding: 'Пройти онбординг заново',

	/* сеть и ключ */
	modelSlow: 'Модель не ответила вовремя.',
	modelNotJson: 'Модель прислала не JSON.',
	modelError: 'Модель вернула ошибку.',
	modelEmpty: 'Модель прислала пустой ответ.',
	noModelAnswered: 'Ни одна модель не ответила.',
	keyRejected: 'Ключ не принят. Проверь его в настройках плагина.',
	keyOutOfQuota: 'Квота ключа исчерпана. Пополни счёт OpenRouter или подожди сутки.',
	rateLimited: 'Модель упёрлась в лимит.',
	providerDown: 'Провайдер не отвечает.',
	requestFailed: (status: number) => `Запрос не прошёл (${status}).`,

	/* файл задач */
	stateComment:
		'<!-- служебный блок плагина Todo Economy: баланс, награды, история, серия — руками лучше не трогать -->',
	defaultFileName: 'ТУДУ.md',
	starterFile: `# ТУДУ
Задачи — обычные галочки. Плашка в конце строки хранит оценку в минутах,
сложность и приоритет; её можно править руками, а можно не трогать вовсе.
Написал голую галочку — плагин допишет плашку сам.

`,

	/* шрифт */
	fontMeasureFailed: 'Не удалось обмерить шрифт.',
	fontMono: 'моноширинный',
	fontDuo: 'дуоспейсный',
	fontProportional: 'пропорциональный',
	fontWider: (glyphs: string) => `, шире ячейки: ${glyphs}`,
	frameOwn: 'псевдографика своя',
	frameFallback: 'псевдографика подставная — включён ASCII',
	fontSummary: (kind: string, cell: string, wide: string, frame: string) =>
		`${kind}, ячейка ${cell} px${wide}. ${frame}.`,
	proseSample: 'обычныйтекстзадачидляоценкисреднейшириныбуквы',

	/* настройки */
	setKey: 'Ключ OpenRouter',
	setKeyDesc:
		'Бесплатный и без карты: openrouter.ai/settings/keys. Ключ хранится на этом ' +
		'устройстве и не уезжает вместе с хранилищем — на втором устройстве его нужно ввести заново.',
	setKeyBad: 'Это не похоже на ключ OpenRouter (sk-or-v1-…)',
	setFile: 'Файл задач',
	setFileDesc: 'Один markdown-файл на всё. Плагин не создаёт других заметок.',
	setLang: 'Язык',
	setLangDesc:
		'Авто берёт язык из настроек Obsidian: русский интерфейс — русский плагин, ' +
		'любой другой — английский. Чат и разбор фраз следуют за этим же выбором.',
	setLangAuto: 'авто',
	setLangChanged: 'Язык изменён. Панель обновится сама, а чат продолжит на новом языке.',
	setStrict: 'Строгий режим',
	setStrictDesc:
		'Восстановительные награды — сон, прогулка, отдых — по умолчанию не требуют закрытой ' +
		'задачи. В плохой день человек не закрывает задачи именно потому, что вымотан, и ' +
		'система, которая в этот момент запрещает отдохнуть, добивает вместо того, чтобы вытаскивать.',
	setPanel: 'Панель',
	setFont: 'Шрифт панели',
	setFontDesc:
		'Пусто — брать моноширинный шрифт из настроек Obsidian. Выравнивание держится ' +
		'на разметке, а не на подсчёте символов, поэтому годится и дуоспейсный шрифт: ' +
		'iA Writer Duo S, где m и w в полтора раза шире прочих, рисуется ровно.',
	setGlyphs: 'Псевдографика',
	setGlyphsDesc:
		'Авто проверяет, держит ли шрифт ширину ячейки на ─ │ █ ░. Если этих символов ' +
		'в нём нет, они подставляются из чужого семейства и разъезжаются — тогда панель ' +
		'сама переходит на ASCII. Видишь пустые квадраты — поставь ASCII вручную.',
	setGlyphsAuto: 'авто',
	setGlyphsUnicode: 'юникод',
	setEconomy: 'Экономика',
	setDayCap: 'Потолок начислений за день',
	setSoftCap: 'Порог сгорания',
	setSoftCapDesc:
		'Выше этого баланса излишек тает на 5 % в день. Без него накопленное однажды оплачивает неделю саморазрушения.',
	setResolve: 'Пересчитать по факту',
	setResolveFact: (days: number, monthly: number, assumed: number) =>
		`За ${days} дн. ты зарабатываешь ${monthly}/мес, а система считает по ` +
		`${assumed}/мес из онбординга. Пересчёт заново решит k по фактическому ` +
		'приходу и уберёт ручную поправку.',
	setResolveThin: (days: number) =>
		`Нужно хотя бы ${days} дней закрытых задач. Пока данных мало — можно пересчитать ` +
		'по оценке из онбординга.',
	setResolveByFact: 'По факту',
	setResolveByGuess: 'По оценке',
	setNoRewards: 'Нечего пересчитывать: нет наград.',
	setNoProfile: 'Нечего пересчитывать: нет профиля.',
	setIncomeFact: (n: number) => `Приход ≈ ${n}/мес по факту.`,
	setIncomeDone: (n: number) => `Готово. Приход ≈ ${n} баллов в месяц.`,
	setTune: 'Ручная поправка к ценам',
	setTuneDesc: (tune: number) =>
		`Сейчас ×${tune}. Она появляется, когда просишь в чате сделать дешевле или ` +
		'дороже. Пока поправка не равна единице, цены не решены, а подкручены — пересчёт по ' +
		'факту вернёт их к честным.',
	setTuneDrop: 'Убрать',
	setRemove: 'убрать',
	setMaintenance: 'Обслуживание',
	setModel: 'Модель',
	setModelLast: (model: string) => `Последней отвечала ${model}`,
	setModelNone: 'Пока никто не отвечал.',
	setModelReset: 'Сбросить кэш моделей',
	setModelResetDone: 'Рейтинг моделей будет запрошен заново.',
	setRestart: 'Пройти онбординг заново',
	setRestartDesc: 'Сотрёт профиль, награды и переписку. Баланс, задачи и история покупок останутся.',
	setRestartGo: 'Начать заново',
	setRestartDone: 'Открой панель — чат начнёт сначала.',

	/* повторы */
	repEveryDay: 'каждый день',
	repEveryOther: 'через день',
	repWeekly: 'раз в неделю',
	repBiweekly: 'раз в две недели',
	repWeeks: (n: number) => `раз в ${n} нед.`,
	repDays: (n: number) => `раз в ${n} дн.`,
	badgeDaily: 'ежедн.',
	badgeWeeks: (n: number) => `${n}нед`,
	badgeDays: (n: number) => `${n}дн`,

	/* чат: онбординг */
	qKey:
		'Привет. Чтобы чат заработал, нужен ключ OpenRouter — бесплатный и без карты.\n' +
		'openrouter.ai/settings/keys → Create key → скопировать → вставить сюда.\n\n' +
		'Ключ остаётся на этом устройстве и в хранилище не уезжает.',
	qWorkday: 'Сколько дней в неделю ты обычно работаешь?',
	qRoutine:
		'Расскажи про свои обычные дела — что делаешь регулярно, сколько это занимает и насколько тяжело идёт. Можно списком, можно как есть.',
	qRewards: 'А чем ты себя награждаешь? Что для тебя отдых и что просто приятно.',
	qHarmful:
		'Теперь про вредное: на что залипаешь и потом жалеешь?\n\n' +
		'Отвечать честно выгодно — система не запрещает вредное, она делает его цену честной.',

	/* чат: реплики */
	sysFailed: 'Что-то пошло не так. Попробуй ещё раз.',
	keyMissing: 'Ключ не задан. Вставь ключ OpenRouter — он начинается с sk-or-v1-.',
	badFormat:
		'Модель ответила не по формату. Попробуй сказать то же самое проще — или напиши «пропустить».',
	notAKey: 'Это не похоже на ключ OpenRouter. Он выглядит так: sk-or-v1-…',
	keyAccepted: 'Ключ принят.',
	onboardDone: (path: string) =>
		'Готово. Дальше просто пиши сюда: «завтра дожать отчёт, часа полтора, идёт тяжело, важное» — заведётся задача.\n\n' +
		`Задачи лежат в ${path} обычными галочками, их можно править руками.`,
	confirmAsk: 'Скажи «да», если цены годятся, или «заново», чтобы пересобрать.',
	noRoutineParsed: 'Не разобрал ни одного дела. Попробуй иначе — или «пропустить».',
	noRewardsParsed: 'Не разобрал ни одной награды. Попробуй иначе — или «пропустить».',
	routineSaved: (n: number) => `Записал дел: ${n}.`,
	rewardsSaved: (n: number) => `Записал наград: ${n}.`,
	harmfulSaved: (n: number) => `Записал вредного: ${n}.`,
	tooThin:
		'Слишком мало данных, чтобы решить экономику: нужны хотя бы одно регулярное дело и одна награда. Расскажи ещё раз — или заведи их руками в настройках.',
	solved: (income: number, cap: number, lines: string) =>
		`Посчитал. Приход около ${income} баллов в месяц, потолок за день ${cap}.\n\n` +
		`Цены получились такие:\n${lines}\n\n` +
		'Они решены из твоего прихода, а не выдуманы: если тратить награды с той частотой, что ты назвал, приход ровно сойдётся с тратами.\n\n' +
		'Записать? Скажи «да» или «заново».',
	taskAdded: (title: string, min: number, diff: number, prio: number, tail: string) =>
		`Завёл: ${title}\n  ${min} мин · сложн ${diff} · прио ${prio}${tail}`,
	dueTail: (date: string) => `, срок ${date}`,
	onceHint:
		'\n\n  Это разовое дело: отметишь — и оно закроется насовсем. Если оно регулярное, скажи «повторяй каждый день» или «через день».',
	notATask: 'Не понял, что за задача. Попробуй назвать её и сказать, сколько займёт.',
	notAReward: 'Не понял, что за награда.',
	rewardAdded: (title: string, price: number) => `Завёл награду: ${title} — ${price} баллов`,
	nothingParsed:
		'Это не похоже ни на задачу, ни на награду. Скажи, что нужно сделать или чем себя наградить.',
	taskNotFound: (target: string) =>
		`Не нашёл задачу «${target}» — или под это подходит сразу несколько. Назови точнее.`,
	taskNotNamed: 'Не понял, какую задачу поправить.',
	nothingToPatch:
		'Понял, что оценка не нравится, но не понял, что именно поменять: минуты, сложность, важность или регулярность?',
	repeatOn: (desc: string) => `\n  теперь ${desc} — галочка будет открываться заново`,
	repeatOff: '\n  повтор снят: дело стало разовым',
	patched: (title: string, min: number, diff: number, prio: number, was: number, now: number, tail: string) =>
		`Поправил «${title}»: ${min} мин · сложн ${diff} · прио ${prio}\n` +
		`  начисление ${was} → ${now}${tail}`,

	/* чат: пересчёт */
	rbNoRewards: 'Пересчитывать нечего: наград пока нет.',
	rbThin: (days: number) =>
		`Пока нечего мерить: нужно хотя бы ${days} дней закрытых задач, ` +
		'чтобы посчитать приход по факту, а не по оценке.\n\n' +
		'Могу пока просто сделать награды дешевле или дороже — скажи, в какую сторону.',
	rbClose: 'Оценка из онбординга оказалась близка к правде.',
	rbOver: (n: number) => `Оценка из онбординга была завышена: по факту выходит меньше на ${n}.`,
	rbUnder: (n: number) => `Оценка из онбординга была занижена: по факту выходит больше на ${n}.`,
	rbSolved: (days: number, samples: number, before: number, now: number, verdict: string, dropped: string, prices: string) =>
		`Пересчитал по факту за ${days} дн. (${samples} закрытых задач).\n` +
		`Приход был ${before}/мес по оценке, стал ${now}/мес по факту. ${verdict}\n` +
		dropped +
		`\nНовые цены:\n${prices}`,
	rbTuneDropped: 'Ручную поправку убрал — теперь цены снова решены, а не подкручены.\n',
	rbAtLimit: (tune: number) =>
		`Дальше в эту сторону не пущу: поправка уже на пределе (×${tune}). ` +
		'Если система всё равно кажется кривой, дело не в цене — стоит пересобрать награды ' +
		'или пройти онбординг заново.',
	rbHint: (days: number, monthly: number, assumed: number) =>
		`\n\nКстати, за ${days} дн. ты зарабатываешь ${monthly}/мес против ${assumed} ` +
		'по оценке из онбординга. Скажи «пересчитай по факту» — и цены встанут по-честному, ' +
		'без ручной поправки.',
	rbTuned: (dir: 'cheaper' | 'pricier', tune: number, prices: string, hint: string) =>
		`Сделал ${dir === 'cheaper' ? 'дешевле' : 'дороже'}: поправка ×${tune}.\n\n` +
		`Цены:\n${prices}${hint}`,

	/* промпты модели */
	pScales:
		'Шкалы: min — оценка в минутах (число). diff — сложность от 0.5 (механика) до 2.0 (тяжёлое, требует включённости). prio — важность от 0.5 (можно не делать) до 2.0 (критично). Сложность и длительность — разные вещи: два часа мыть посуду это min 120 diff 0.6.',
	pJsonOnly: 'Отвечай ТОЛЬКО валидным JSON без пояснений и без markdown-обёртки.',
	pWorkday: (jsonOnly: string) =>
		`Из ответа человека вытащи, сколько дней в неделю он работает. ${jsonOnly} Формат: {"workdays": 5}`,
	pRoutine: (scales: string, jsonOnly: string) =>
		`Человек описал свои регулярные дела. Разбери их в список. ${scales} perWeek — сколько раз в неделю это бывает (число, можно дробное). ${jsonOnly} Формат: {"routine":[{"title":"...","min":60,"diff":1.2,"prio":1.4,"perWeek":5}]}`,
	pRewards: (jsonOnly: string) =>
		`Человек описал, чем себя награждает. Разбери в список. value — насколько это для него ценно, от 0.2 до 5.0. freq — сколько раз в месяц он хотел бы это получать. kind: "restore" если это отдых и восстановление (сон, прогулка, тишина), иначе "normal". ${jsonOnly} Формат: {"rewards":[{"title":"...","value":2.0,"freq":8,"kind":"normal"}]}`,
	pHarmful: (jsonOnly: string) =>
		`Человек описал, на что залипает и потом жалеет. Разбери в список. value — насколько это его тянет, от 0.2 до 5.0. harm — насколько разрушительно, от 1.0 до 3.0. freq — сколько раз в месяц это случается сейчас. weeklyCap — разумный жёсткий лимит раз в неделю. ${jsonOnly} Формат: {"rewards":[{"title":"...","value":1.5,"harm":2.4,"freq":12,"weeklyCap":2}]}`,
	pIntake: (scales: string, jsonOnly: string) =>
		`Разбери фразу человека. Отдельно следи за жалобами на несправедливость оценки — их два разных сорта, и путать их нельзя.

Несправедлива оценка ОДНОЙ задачи («отчёт вовсе не на полтора часа, а на три», «зарядка идёт тяжелее, чем записано», «это дело важнее») — верни adjust и только те поля, которые меняются:
{"kind":"adjust","target":"часть названия задачи","min":180,"diff":1.6,"prio":1.8}

Человек просит сделать УЖЕ ЗАВЕДЁННОЕ дело регулярным («работу отмечай каждый день», «прогулка теперь ежедневная», «повторяй мытьё мисок через день») — тоже adjust, но с полем repeat:
{"kind":"adjust","target":"часть названия задачи","repeat":1}
Чтобы снять повтор («больше не повторяй»), верни {"kind":"adjust","target":"...","repeat":0}.

Несправедлива ВСЯ система — верни rebalance:
{"kind":"rebalance","want":"cheaper"} — «награды слишком дорогие», «до них не добраться», «ничего не могу себе позволить»
{"kind":"rebalance","want":"pricier"} — «слишком легко покупается», «баллы девать некуда», «награды ничего не стоят»
{"kind":"rebalance","want":"solve"} — «пересчитай по факту», «в онбординге я наврал», «система в целом кривая», «это несправедливо» без указания стороны

Если жалоба общая и непонятно, в какую сторону — бери "solve": честнее пересчитать приход по фактическим начислениям, чем подкручивать цены наугад.

Дальше — обычный разбор. Если это дело — верни задачу, если это то, чем он себя награждает — награду, иначе none. ${scales} due — срок в формате YYYY-MM-DD, только если он явно назван. repeat — раз в сколько дней дело повторяется: 1 для «каждый день» и «ежедневно», 2 для «через день», 7 для «раз в неделю». Ставь repeat, если регулярность видна из фразы ИЛИ из самого названия дела: «читать каждый день по 30 минут» → repeat 1, «зарядка по утрам» → repeat 1, «убираться раз в неделю» → repeat 7. ${jsonOnly} Форматы: {"kind":"task","title":"...","min":90,"diff":1.2,"prio":1.4,"due":"2026-08-08","repeat":1} или {"kind":"reward","title":"...","value":2.0,"freq":8,"kind2":"normal"} или {"kind":"none"}`,
};

/**
 * Тип словаря выводится из русского и намеренно без `as const`: иначе каждая
 * строка стала бы своим литеральным типом, и английский перевод перестал бы
 * подходить по типу. Забыть ключ по-прежнему нельзя — этого достаточно.
 */
type Dict = typeof RU;

const EN: Dict = {
	title: 'TODO · ECONOMY',
	tabGoals: 'GOALS',
	tabRewards: 'REWARDS',
	tabChat: 'CHAT',
	tabHint: (label: string) => `${label} tab`,
	points: ' points',
	noFile: 'No task file yet.',
	createFile: (path: string) => `[ create ${path} ]`,
	emptyTasks: 'Empty. Type a task into the chat — or tick a box in the file.',
	openFile: '[ open file ]',
	toggleHint: (done: boolean, title: string) => `${done ? 'reopen' : 'complete'} task "${title}"`,
	returnsOn: (date: string) => `    returns ${date}`,
	minutes: 'min',
	dueBy: (date: string) => `  by ${date}`,
	pause: 'pause',
	focus: 'focus',
	focusHint: (title: string) => `pomodoro for "${title}"`,
	resetPomo: 'reset pomodoro',
	delHint: (title: string) => `delete "${title}"`,
	delConfirmHint: (title: string) => `click again to delete "${title}"`,
	deleted: (title: string) => `deleted: ${title}`,
	today: 'today    ',
	streak: 'streak   ',
	streakDays: (days: number, mult: string) => `${days} d  ×${mult}`,
	noRewards: 'No rewards yet. Tell the chat about them.',
	buy: '[ BUY ]',
	buyHint: (title: string, price: number) => `buy "${title}" for ${price}`,
	incomeShort: (n: number) => `income ≈ ${n}/mo`,
	chatEmpty: 'Empty.',
	thinking: '  thinking…',
	composeHint: 'finish the report tomorrow, about an hour and a half',
	composeHintOnboard: 'answer in your own words',

	weekCapReached: 'weekly limit reached',
	notEnough: (n: number) => `${n} short`,
	closeTaskFirst: 'close a task first',
	cannotBuy: 'Not yet',
	tagHarmful: ' · harmful',
	tagRestore: ' · restorative',
	perWeekShort: (n: number) => `, ≤${n}/wk`,
	notCheaperThan: (n: number) => `, at most ${n} per week`,

	decayNote: (days: number) => `surplus decayed over ${days} d`,
	cappedNote: ' (hit the daily cap)',
	overdueNote: (title: string) => `overdue: ${title}`,

	fileCreateFailed: (path: string) => `Todo Economy: could not create ${path}`,
	reopened: (n: number) => `Todo Economy: tasks reopened: ${n}`,
	penalized: (n: number) => `Todo Economy: −${n} for overdue tasks`,
	restOver: 'Break is over.',
	pomoOver: 'Pomodoro is over — take five.',
	rollback: (n: number) => `−${n}  undone`,

	cmdOpenPanel: 'Open panel',
	cmdOpenFile: 'Open task file',
	cmdRefresh: 'Reread task file',
	cmdRestartOnboarding: 'Restart onboarding',

	modelSlow: 'The model did not answer in time.',
	modelNotJson: 'The model sent something other than JSON.',
	modelError: 'The model returned an error.',
	modelEmpty: 'The model sent an empty answer.',
	noModelAnswered: 'No model answered.',
	keyRejected: 'Key rejected. Check it in the plugin settings.',
	keyOutOfQuota: 'Key quota is spent. Top up OpenRouter or wait a day.',
	rateLimited: 'The model hit its rate limit.',
	providerDown: 'The provider is not responding.',
	requestFailed: (status: number) => `Request failed (${status}).`,

	stateComment:
		'<!-- Todo Economy internal block: balance, rewards, history, streak — better left alone -->',
	defaultFileName: 'TODO.md',
	starterFile: `# TODO
Tasks are ordinary checkboxes. The badge at the end of a line holds the estimate
in minutes, the difficulty and the priority; edit it by hand or ignore it
entirely. Write a bare checkbox and the plugin fills the badge in for you.

`,

	fontMeasureFailed: 'Could not measure the font.',
	fontMono: 'monospaced',
	fontDuo: 'duospaced',
	fontProportional: 'proportional',
	fontWider: (glyphs: string) => `, wider than the cell: ${glyphs}`,
	frameOwn: 'box drawing is native',
	frameFallback: 'box drawing is substituted — ASCII enabled',
	fontSummary: (kind: string, cell: string, wide: string, frame: string) =>
		`${kind}, cell ${cell} px${wide}. ${frame}.`,
	proseSample: 'ordinarytasktextusedtomeasureaverageletterwidth',

	setKey: 'OpenRouter key',
	setKeyDesc:
		'Free, no card required: openrouter.ai/settings/keys. The key is stored on this ' +
		'device and does not travel with the vault — on a second device you enter it again.',
	setKeyBad: 'That does not look like an OpenRouter key (sk-or-v1-…)',
	setFile: 'Task file',
	setFileDesc: 'One markdown file for everything. The plugin creates no other notes.',
	setLang: 'Language',
	setLangDesc:
		'Auto follows the Obsidian interface language: a Russian interface gives a Russian ' +
		'plugin, anything else gives English. The chat and phrase parsing follow the same choice.',
	setLangAuto: 'auto',
	setLangChanged: 'Language changed. The panel refreshes itself, and the chat continues in the new language.',
	setStrict: 'Strict mode',
	setStrictDesc:
		'Restorative rewards — sleep, a walk, rest — do not require a completed task by default. ' +
		'On a bad day a person fails to close tasks precisely because they are drained, and a ' +
		'system that forbids rest at that moment finishes them off instead of pulling them out.',
	setPanel: 'Panel',
	setFont: 'Panel font',
	setFontDesc:
		'Leave empty to use the monospace font from Obsidian settings. Alignment relies on ' +
		'markup rather than character counting, so a duospaced font works too: iA Writer Duo S, ' +
		'where m and w are half again as wide as the rest, still renders evenly.',
	setGlyphs: 'Box drawing',
	setGlyphsDesc:
		'Auto checks whether the font keeps cell width on ─ │ █ ░. If those glyphs are missing, ' +
		'they get substituted from another family and the frame falls apart — then the panel ' +
		'switches to ASCII on its own. Seeing empty squares? Set ASCII by hand.',
	setGlyphsAuto: 'auto',
	setGlyphsUnicode: 'unicode',
	setEconomy: 'Economy',
	setDayCap: 'Daily earning cap',
	setSoftCap: 'Decay threshold',
	setSoftCapDesc:
		'Above this balance the surplus melts by 5 % a day. Without it, one big pile pays for a week of self-destruction.',
	setResolve: 'Resolve from actuals',
	setResolveFact: (days: number, monthly: number, assumed: number) =>
		`Over ${days} d you earn ${monthly}/mo, while the system assumes ${assumed}/mo from ` +
		'onboarding. Resolving again solves k from the actual income and drops the manual tweak.',
	setResolveThin: (days: number) =>
		`At least ${days} days of completed tasks are needed. Data is thin so far — you can resolve ` +
		'from the onboarding estimate instead.',
	setResolveByFact: 'From actuals',
	setResolveByGuess: 'From estimate',
	setNoRewards: 'Nothing to resolve: no rewards.',
	setNoProfile: 'Nothing to resolve: no profile.',
	setIncomeFact: (n: number) => `Income ≈ ${n}/mo from actuals.`,
	setIncomeDone: (n: number) => `Done. Income ≈ ${n} points a month.`,
	setTune: 'Manual price tweak',
	setTuneDesc: (tune: number) =>
		`Currently ×${tune}. It appears when you ask the chat for cheaper or pricier rewards. ` +
		'While the tweak is not 1, prices are nudged rather than solved — resolving from actuals ' +
		'brings them back to honest.',
	setTuneDrop: 'Drop',
	setRemove: 'remove',
	setMaintenance: 'Maintenance',
	setModel: 'Model',
	setModelLast: (model: string) => `Last answered by ${model}`,
	setModelNone: 'Nobody has answered yet.',
	setModelReset: 'Reset model cache',
	setModelResetDone: 'The model ranking will be fetched again.',
	setRestart: 'Restart onboarding',
	setRestartDesc: 'Wipes the profile, rewards and chat. Balance, tasks and purchase history stay.',
	setRestartGo: 'Start over',
	setRestartDone: 'Open the panel — the chat starts from the beginning.',

	repEveryDay: 'every day',
	repEveryOther: 'every other day',
	repWeekly: 'weekly',
	repBiweekly: 'every two weeks',
	repWeeks: (n: number) => `every ${n} weeks`,
	repDays: (n: number) => `every ${n} days`,
	badgeDaily: 'daily',
	badgeWeeks: (n: number) => `${n}w`,
	badgeDays: (n: number) => `${n}d`,

	qKey:
		'Hi. The chat needs an OpenRouter key to work — free, no card.\n' +
		'openrouter.ai/settings/keys → Create key → copy → paste it here.\n\n' +
		'The key stays on this device and never travels with the vault.',
	qWorkday: 'How many days a week do you usually work?',
	qRoutine:
		'Tell me about your usual business — what you do regularly, how long it takes and how hard it feels. A list works, plain words work too.',
	qRewards: 'And how do you reward yourself? What counts as rest, and what is simply nice.',
	qHarmful:
		'Now the harmful side: what do you get stuck on and regret afterwards?\n\n' +
		'Honesty pays here — the system does not forbid harmful things, it just prices them honestly.',

	sysFailed: 'Something went wrong. Try again.',
	keyMissing: 'No key set. Paste an OpenRouter key — it starts with sk-or-v1-.',
	badFormat: 'The model answered off-format. Try saying the same thing more simply — or write "skip".',
	notAKey: 'That does not look like an OpenRouter key. It looks like this: sk-or-v1-…',
	keyAccepted: 'Key accepted.',
	onboardDone: (path: string) =>
		'Done. From here just write to me: "finish the report tomorrow, about an hour and a half, hard going, important" — and a task appears.\n\n' +
		`Tasks live in ${path} as ordinary checkboxes, and you can edit them by hand.`,
	confirmAsk: 'Say "yes" if the prices work, or "again" to rebuild them.',
	noRoutineParsed: 'I could not make out a single activity. Try another wording — or "skip".',
	noRewardsParsed: 'I could not make out a single reward. Try another wording — or "skip".',
	routineSaved: (n: number) => `Activities saved: ${n}.`,
	rewardsSaved: (n: number) => `Rewards saved: ${n}.`,
	harmfulSaved: (n: number) => `Harmful ones saved: ${n}.`,
	tooThin:
		'Too little to solve the economy: at least one regular activity and one reward are needed. Tell me again — or add them by hand in the settings.',
	solved: (income: number, cap: number, lines: string) =>
		`Solved. Income is about ${income} points a month, the daily cap is ${cap}.\n\n` +
		`Prices came out like this:\n${lines}\n\n` +
		'They are solved from your income rather than invented: spend the rewards at the frequency you named and income meets spending exactly.\n\n' +
		'Save this? Say "yes" or "again".',
	taskAdded: (title: string, min: number, diff: number, prio: number, tail: string) =>
		`Added: ${title}\n  ${min} min · diff ${diff} · prio ${prio}${tail}`,
	dueTail: (date: string) => `, due ${date}`,
	onceHint:
		'\n\n  This is a one-off: tick it and it closes for good. If it is a regular thing, say "repeat every day" or "every other day".',
	notATask: 'I did not catch the task. Try naming it and saying how long it takes.',
	notAReward: 'I did not catch the reward.',
	rewardAdded: (title: string, price: number) => `Reward added: ${title} — ${price} points`,
	nothingParsed: 'That looks like neither a task nor a reward. Tell me what to do or how to reward yourself.',
	taskNotFound: (target: string) =>
		`I could not find the task "${target}" — or several match it. Name it more precisely.`,
	taskNotNamed: 'I did not catch which task to adjust.',
	nothingToPatch:
		'I get that the estimate feels wrong, but not what to change: minutes, difficulty, importance or how often it repeats?',
	repeatOn: (desc: string) => `\n  now ${desc} — the checkbox will reopen itself`,
	repeatOff: '\n  repeat removed: the task is a one-off now',
	patched: (title: string, min: number, diff: number, prio: number, was: number, now: number, tail: string) =>
		`Adjusted "${title}": ${min} min · diff ${diff} · prio ${prio}\n` +
		`  award ${was} → ${now}${tail}`,

	rbNoRewards: 'Nothing to rebalance: there are no rewards yet.',
	rbThin: (days: number) =>
		`Nothing to measure yet: at least ${days} days of completed tasks are needed ` +
		'to compute income from actuals rather than from the estimate.\n\n' +
		'For now I can simply make rewards cheaper or pricier — say which way.',
	rbClose: 'The onboarding estimate turned out close to the truth.',
	rbOver: (n: number) => `The onboarding estimate was too high: actuals come out ${n} lower.`,
	rbUnder: (n: number) => `The onboarding estimate was too low: actuals come out ${n} higher.`,
	rbSolved: (days: number, samples: number, before: number, now: number, verdict: string, dropped: string, prices: string) =>
		`Resolved from actuals over ${days} d (${samples} completed tasks).\n` +
		`Income was ${before}/mo by estimate, now ${now}/mo by actuals. ${verdict}\n` +
		dropped +
		`\nNew prices:\n${prices}`,
	rbTuneDropped: 'I dropped the manual tweak — prices are solved again rather than nudged.\n',
	rbAtLimit: (tune: number) =>
		`I will not go further that way: the tweak is already at its limit (×${tune}). ` +
		'If the system still feels wrong, the problem is not the price — rebuild the rewards ' +
		'or run onboarding again.',
	rbHint: (days: number, monthly: number, assumed: number) =>
		`\n\nBy the way, over ${days} d you earn ${monthly}/mo against ${assumed} ` +
		'estimated at onboarding. Say "resolve from actuals" and prices settle honestly, ' +
		'without a manual tweak.',
	rbTuned: (dir: 'cheaper' | 'pricier', tune: number, prices: string, hint: string) =>
		`Made them ${dir === 'cheaper' ? 'cheaper' : 'pricier'}: tweak ×${tune}.\n\n` +
		`Prices:\n${prices}${hint}`,

	pScales:
		'Scales: min — estimate in minutes (a number). diff — difficulty from 0.5 (mechanical) to 2.0 (heavy, demands full attention). prio — importance from 0.5 (skippable) to 2.0 (critical). Difficulty and duration are different things: two hours of washing dishes is min 120 diff 0.6.',
	pJsonOnly: 'Answer with valid JSON ONLY — no explanations, no markdown fence.',
	pWorkday: (jsonOnly: string) =>
		`From the person's answer, extract how many days a week they work. ${jsonOnly} Format: {"workdays": 5}`,
	pRoutine: (scales: string, jsonOnly: string) =>
		`The person described their regular activities. Break them into a list. ${scales} perWeek — how many times a week it happens (a number, fractions allowed). ${jsonOnly} Format: {"routine":[{"title":"...","min":60,"diff":1.2,"prio":1.4,"perWeek":5}]}`,
	pRewards: (jsonOnly: string) =>
		`The person described how they reward themselves. Break it into a list. value — how valuable it is to them, from 0.2 to 5.0. freq — how many times a month they would like it. kind: "restore" if it is rest and recovery (sleep, a walk, quiet), otherwise "normal". ${jsonOnly} Format: {"rewards":[{"title":"...","value":2.0,"freq":8,"kind":"normal"}]}`,
	pHarmful: (jsonOnly: string) =>
		`The person described what they get stuck on and regret. Break it into a list. value — how strongly it pulls them, from 0.2 to 5.0. harm — how destructive it is, from 1.0 to 3.0. freq — how often it happens per month right now. weeklyCap — a sensible hard limit per week. ${jsonOnly} Format: {"rewards":[{"title":"...","value":1.5,"harm":2.4,"freq":12,"weeklyCap":2}]}`,
	pIntake: (scales: string, jsonOnly: string) =>
		`Parse the person's phrase. Watch out for complaints about unfair estimates — there are two different kinds and they must not be confused.

ONE task is estimated unfairly ("the report is not an hour and a half, it is three", "the workout is harder than written down", "this matters more") — return adjust with only the fields that change:
{"kind":"adjust","target":"part of the task title","min":180,"diff":1.6,"prio":1.8}

The person asks to make an ALREADY EXISTING task regular ("mark work every day", "the walk is daily now", "repeat washing the bowls every other day") — also adjust, but with a repeat field:
{"kind":"adjust","target":"part of the task title","repeat":1}
To remove the repeat ("stop repeating it"), return {"kind":"adjust","target":"...","repeat":0}.

The WHOLE system is unfair — return rebalance:
{"kind":"rebalance","want":"cheaper"} — "rewards are too expensive", "I can never reach them", "I cannot afford anything"
{"kind":"rebalance","want":"pricier"} — "too easy to buy", "points pile up with nowhere to go", "rewards cost nothing"
{"kind":"rebalance","want":"solve"} — "resolve from actuals", "I lied during onboarding", "the whole system is off", "this is unfair" without saying which way

If the complaint is general and the direction is unclear, take "solve": recomputing income from actual awards is more honest than nudging prices blindly.

Otherwise do the ordinary parse. If it is something to do — return a task; if it is something they reward themselves with — a reward; otherwise none. ${scales} due — a deadline in YYYY-MM-DD, only if it is stated explicitly. repeat — how many days between repetitions: 1 for "every day" and "daily", 2 for "every other day", 7 for "weekly". Set repeat when the regularity is visible from the phrase OR from the task title itself: "read for 30 minutes every day" → repeat 1, "morning workout" → repeat 1, "clean the flat weekly" → repeat 7. ${jsonOnly} Formats: {"kind":"task","title":"...","min":90,"diff":1.2,"prio":1.4,"due":"2026-08-08","repeat":1} or {"kind":"reward","title":"...","value":2.0,"freq":8,"kind2":"normal"} or {"kind":"none"}`,
};

/** Строки текущего языка. */
export function t(): Dict {
	return current === 'ru' ? RU : EN;
}
