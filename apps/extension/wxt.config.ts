import { defineConfig } from "wxt";

export default defineConfig({
	manifest: {
		name: "waxseal",
		version: "0.1.0",
		description: "End-to-end encryption overlay for Bale web chat.",
		permissions: ["storage", "tabs"],
		host_permissions: ["https://web.bale.ai/*"],
		action: {
			default_title: "waxseal",
		},
	},
});
