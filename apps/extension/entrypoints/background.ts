// Side-effectful import: extension-core registers all chrome.runtime listeners
// (onInstalled, onMessage) and initialises key/peer stores at module load time.
import "@waxseal/extension-core";

export default defineBackground({
	type: "module",
	main() {},
});
