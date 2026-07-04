export default defineBackground(() => {
  console.log("Waxseal background running", { id: browser.runtime.id });
});
