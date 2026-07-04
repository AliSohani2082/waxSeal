import react from "@vitejs/plugin-react";
import { defineConfig } from "wxt";

export default defineConfig({
	vite: () => ({
		plugins: [react()],
	}),
});
