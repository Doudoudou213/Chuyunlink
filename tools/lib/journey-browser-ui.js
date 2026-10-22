'use strict';
// Exercise the actual, default-collapsed visitor tools affordance in browser tests.
async function showJourneyTools(page) {
  const tools = page.locator('#journey-tools');
  if (await tools.count() && !await tools.evaluate(node => node.open)) {
    await tools.locator(':scope > summary').click();
  }
}
async function toolClick(page, selector) {
  await showJourneyTools(page);
  await page.locator(selector).click();
}
module.exports = {showJourneyTools, toolClick};
