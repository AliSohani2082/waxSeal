import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const extensionPath = resolve(__dirname, "../packages/build/dist/chrome");

export default defineConfig({
	testDir: "./tests",
	timeout: 30_000,
	retries: 0,
	workers: 1, // extension contexts share the same user data dir namespace; serialize
	use: {
		// Extensions require non-headless Chromium
		headless: false,
		viewport: { width: 1280, height: 720 },
	},
	projects: [
		{
			name: "chromium-extension",
			use: {
				browserName: "chromium",
				// Note: launchOptions here are defaults; individual tests override via
				// launchPersistentContext() with their own userDataDir
				launchOptions: {
					args: [
						`--disable-extensions-except=${extensionPath}`,
						`--load-extension=${extensionPath}`,
					],
				},
			},
		},
	],
});
