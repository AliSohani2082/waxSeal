import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// RSA-2048 keygen takes 1-2s per keypair; tests that generate several
		// keypairs exceed the 5s default under parallel suite load.
		testTimeout: 30000,
	},
});
