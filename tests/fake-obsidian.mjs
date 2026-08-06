/**
 * Подмена модуля `obsidian` для тестов. Подставляется через alias в esbuild,
 * так что store.ts и brain.ts проверяются целиком — вместе с записью в файл и
 * походом к модели, но без запуска приложения и без сети.
 */

export class TFile {
	constructor(path) {
		this.path = path;
		this.name = path.split('/').pop();
	}
}
export class TFolder {}
export class TAbstractFile {}

export class Notice {
	static log = [];
	constructor(message) {
		Notice.log.push(String(message));
	}
}

export class Plugin {}
export class ItemView {}
export class PluginSettingTab {}
export class Setting {}
export class WorkspaceLeaf {}

let net = async () => ({ status: 200, json: {}, text: '{}' });

/** Подставить обработчик сети: (opts) => ответ. */
export function setNet(fn) {
	net = fn;
}

export async function requestUrl(opts) {
	return net(opts);
}

/* ── минимальное хранилище файлов ──────────────────────────────────────── */

export function makeVault(initial = {}) {
	const files = new Map(Object.entries(initial));
	const listeners = [];
	return {
		files,
		on(name, cb) {
			listeners.push([name, cb]);
			return { name, cb };
		},
		getAbstractFileByPath(p) {
			return files.has(p) ? new TFile(p) : null;
		},
		async create(p, content) {
			if (files.has(p)) throw new Error('exists');
			files.set(p, content);
			return new TFile(p);
		},
		async createFolder() {},
		async cachedRead(f) {
			return files.get(f.path) ?? '';
		},
		async read(f) {
			return files.get(f.path) ?? '';
		},
		async process(f, fn) {
			const next = fn(files.get(f.path) ?? '');
			files.set(f.path, next);
			return next;
		},
	};
}

export function makePlugin(vault) {
	const local = new Map();
	let saved = null;
	return {
		app: {
			vault,
			loadLocalStorage: (k) => local.get(k) ?? null,
			saveLocalStorage: (k, v) => (v === null ? local.delete(k) : local.set(k, v)),
		},
		async loadData() {
			return saved;
		},
		async saveData(d) {
			saved = JSON.parse(JSON.stringify(d));
		},
		get saved() {
			return saved;
		},
	};
}
