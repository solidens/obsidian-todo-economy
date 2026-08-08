/**
 * Чистые модули собираются в .test-build/, чтобы `node --test` мог их
 * импортировать без TypeScript в рантайме. Ничего из Obsidian сюда не
 * попадает — если попадёт, сборка упадёт на внешнем импорте.
 *
 * Второй проход собирает связующие модули с подменённым `obsidian`: так
 * store.ts и brain.ts проверяются целиком, вместе с записью в файл.
 */
import esbuild from 'esbuild';

/**
 * Подмена должна остаться ВНЕШНИМ модулем, а не влиться в бандл: иначе у
 * store.js будет своя копия класса TFile, и `instanceof` в тесте не сойдётся.
 */
const fakeObsidian = {
	name: 'fake-obsidian',
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({
			path: '../../tests/fake-obsidian.mjs',
			external: true,
		}));
	},
};

const common = {
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node20',
	logLevel: 'warning',
};

await esbuild.build({
	...common,
	entryPoints: [
		'src/core/economy.ts',
		'src/core/types.ts',
		'src/core/ledger.ts',
		'src/core/tasks-md.ts',
		'src/core/recurrence.ts',
		'src/core/rebalance.ts',
		'src/core/intake.ts',
		'src/core/time.ts',
		'src/llm/parse.ts',
		'src/ui/ascii.ts',
	],
	outdir: '.test-build',
	external: ['obsidian'],
});

await esbuild.build({
	...common,
	entryPoints: ['src/store.ts', 'src/brain.ts'],
	outdir: '.test-build/wired',
	plugins: [fakeObsidian],
});
