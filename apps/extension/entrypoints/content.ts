import { baleAdapter } from "@waxseal/adapter-bale";
import { startContentScript } from "@waxseal/extension-core/content-script";

export default defineContentScript({
	matches: ["https://web.bale.ai/*"],
	main() {
		startContentScript(baleAdapter);
	},
});
