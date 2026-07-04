export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    console.log("Waxseal content script injected.");
  },
});
