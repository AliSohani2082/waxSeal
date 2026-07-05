import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
	defineConfig,
	type Plugin,
	type ResolvedConfig,
	type UserConfig,
} from "vite";

// Root set to extension-core/src so that HTML entry point paths are relative
// (Vite requires HTML inputs to be inside or relative to `root`).
const extensionCoreDir = resolve(__dirname, "../extension-core/src");

/**
 * Rewrites `src="popup.js"` → `src="popup.ts"` in HTML entries so Vite
 * can find the TypeScript source. The resolveId hook intercepts popup.js
 * requests from popup.html and redirects them to popup.ts.
 */
function rewritePopupScriptPlugin(extensionCoreSrcDir: string): Plugin {
	return {
		name: "rewrite-popup-script",
		resolveId(source: string, importer: string | undefined) {
			if (source === "popup.js" && importer?.endsWith("popup.html")) {
				return resolve(extensionCoreSrcDir, "popup.ts");
			}
			return undefined;
		},
	};
}

/**
 * Copies the correct manifest (chrome or firefox) into the resolved outDir
 * after the bundle is written.
 */
function copyManifestPlugin(mode: string, buildPkgDir: string): Plugin {
	let resolvedOutDir = "";

	return {
		name: "copy-manifest",
		configResolved(config: ResolvedConfig) {
			resolvedOutDir = config.build.outDir;
		},
		closeBundle() {
			const manifest =
				mode === "firefox" ? "manifest.firefox.json" : "manifest.chrome.json";
			mkdirSync(resolvedOutDir, { recursive: true });
			copyFileSync(
				resolve(buildPkgDir, manifest),
				resolve(resolvedOutDir, "manifest.json"),
			);
		},
	};
}

export default defineConfig(({ mode }): UserConfig => {
	// Use absolute outDir so Vite places output in packages/build/dist/<mode>
	// regardless of what `root` is set to.
	const outDir = resolve(
		__dirname,
		`dist/${mode === "firefox" ? "firefox" : "chrome"}`,
	);

	// The build runs in two passes into the same outDir:
	//   - default pass: background (module) + popup, code-splitting allowed
	//   - content pass (WAXSEAL_TARGET=content): content-script only, bundled as a
	//     self-contained IIFE. MV3 injects content scripts as CLASSIC scripts, which
	//     cannot use `import`, so the content script must have no external chunks.
	const isContentPass = process.env.WAXSEAL_TARGET === "content";

	const build: UserConfig["build"] = isContentPass
		? {
				target: "es2022",
				modulePreload: { polyfill: false },
				outDir,
				emptyOutDir: false, // preserve background.js / popup from the first pass
				rollupOptions: {
					input: resolve(extensionCoreDir, "content-script.ts"),
					output: {
						format: "iife",
						inlineDynamicImports: true,
						entryFileNames: "content-script.js",
						assetFileNames: "[name][extname]",
					},
				},
				sourcemap: true,
				minify: false, // keep readable for auditing
			}
		: {
				target: "es2022",
				modulePreload: { polyfill: false },
				outDir,
				emptyOutDir: true,
				rollupOptions: {
					input: {
						background: resolve(extensionCoreDir, "background.ts"),
						popup: resolve(extensionCoreDir, "popup.html"),
					},
					output: {
						entryFileNames: "[name].js",
						chunkFileNames: "chunks/[name]-[hash].js",
						assetFileNames: "[name][extname]",
					},
				},
				sourcemap: true,
				minify: false, // keep readable for auditing
			};

	return {
		// root = extensionCoreDir ensures popup.html is within root so Vite
		// can assign it a proper relative filename in the output bundle.
		root: extensionCoreDir,
		build,
		resolve: {
			alias: {
				"@waxseal/crypto-core": resolve(
					__dirname,
					"../crypto-core/src/index.ts",
				),
				"@waxseal/adapter-api": resolve(
					__dirname,
					"../adapters/adapter-api/src/index.ts",
				),
				"@waxseal/adapter-bale": resolve(
					__dirname,
					"../adapters/adapter-bale/src/index.ts",
				),
				"@waxseal/extension-core": resolve(extensionCoreDir, "background.ts"),
			},
		},
		define: {
			__WAXSEAL_MODE__: JSON.stringify(mode),
		},
		plugins: [
			rewritePopupScriptPlugin(extensionCoreDir),
			copyManifestPlugin(mode, __dirname),
		],
	};
});
