/** Даты в локальной зоне. Все ключи — строки, чтобы переживать JSON. */

const p2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD по локальному времени. */
export function dayKey(d: Date = new Date()): string {
	return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** ISO-неделя: YYYY-Www. Понедельник — первый день. */
export function weekKey(d: Date = new Date()): string {
	const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	// сдвиг к четвергу текущей недели — на нём и стоит номер по ISO
	t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
	const firstThu = new Date(t.getFullYear(), 0, 4);
	firstThu.setDate(firstThu.getDate() + 3 - ((firstThu.getDay() + 6) % 7));
	const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 864e5));
	return `${t.getFullYear()}-W${p2(week)}`;
}

/** Разница в днях между двумя ключами YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
	const pa = a.split('-').map(Number);
	const pb = b.split('-').map(Number);
	const da = Date.UTC(pa[0], pa[1] - 1, pa[2]);
	const db = Date.UTC(pb[0], pb[1] - 1, pb[2]);
	return Math.round((db - da) / 864e5);
}

/** Сдвинуть ключ YYYY-MM-DD на N дней. Переходы месяцев и лет — на Date. */
export function addDays(key: string, n: number): string {
	const [y, m, d] = key.split('-').map(Number);
	return dayKey(new Date(y, m - 1, d + n));
}

export const mmss = (sec: number) => `${p2(Math.floor(sec / 60))}:${p2(sec % 60)}`;
