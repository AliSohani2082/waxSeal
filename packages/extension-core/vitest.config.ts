import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "node",
					include: [
						"test/storage.test.ts",
						"test/peer-store.test.ts",
						"test/background.test.ts",
					],
					environment: "node",
				},
			},
			{
				test: {
					name: "dom",
					include: ["test/content-script.test.ts", "test/popup.test.ts"],
					environment: "jsdom",
				},
			},
		],
	},
});
