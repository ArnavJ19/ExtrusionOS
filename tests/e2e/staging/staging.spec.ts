import { expect, test, type Browser, type Page } from "@playwright/test";
import { readStagingEnvironment, stagingOptInRequested } from "./support/environment.ts";

test.skip(!stagingOptInRequested(), "Explicit staging-only environment was not provided.");

const env = stagingOptInRequested() ? readStagingEnvironment() : null;

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function authenticatedPage(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

test("manager login reaches the sub-700 kg consolidation queue", async ({ page }) => {
  await login(page, env!.primaryEmail, env!.primaryPassword);
  await page.goto("/production/consolidation");
  await expect(page.getByRole("heading", { name: "Factory Load Consolidation" })).toBeVisible();
  await expect(page.getByText(/Combine sub-700 kg manufacturing orders/)).toBeVisible();
});

test("dispatch entry exposes the exact physical bundle manifest", async ({ page }) => {
  await login(page, env!.primaryEmail, env!.primaryPassword);
  await page.goto("/dispatches/new");
  await expect(page.getByRole("heading", { name: "Load Physical Dispatch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operator-Verified Bundle Manifest" })).toBeVisible();
  await expect(page.getByText("Scan / Bundle ID *", { exact: true })).toBeVisible();
  await expect(page.getByText("Exact material source *", { exact: true })).toBeVisible();
  await expect(page.getByText("Actual pieces *", { exact: true })).toBeVisible();
  await expect(page.getByText("Gross kg *", { exact: true })).toBeVisible();
  await expect(page.getByText("Tare kg *", { exact: true })).toBeVisible();
  await expect(page.getByText("Measured net", { exact: true })).toBeVisible();
});

test("returned dispatch exposes return-accounting controls when a fixture is supplied", async ({ page }) => {
  test.skip(!env!.creditDispatchId, "Set E2E_STAGING_CREDIT_DISPATCH_ID to a returned/damaged invoiced staging dispatch.");
  await login(page, env!.primaryEmail, env!.primaryPassword);
  await page.goto(`/dispatches/${env!.creditDispatchId}`);
  await expect(page.getByRole("heading", { name: "Return Accounting" })).toBeVisible();
  await expect(page.getByText(/The original invoice remains intact/)).toBeVisible();
  await expect(page.getByText(/Credit note reason|Credit note reversal reason/)).toBeVisible();
});

test("reading a broadcast notification is isolated per user", async ({ browser }) => {
  const title = process.env.E2E_STAGING_NOTIFICATION_TITLE;
  expect(title, "Global setup must seed a notification title").toBeTruthy();

  const primary = await authenticatedPage(browser, env!.primaryEmail, env!.primaryPassword);
  await primary.page.goto("/notifications");
  const primaryTitle = primary.page.getByText(title!, { exact: true });
  await expect(primaryTitle).toBeVisible();
  const primaryNotification = primaryTitle.locator("xpath=ancestor::div[contains(@class,'justify-between')][1]");
  await primaryNotification.getByRole("button", { name: "Mark as read" }).click();
  await expect(primaryNotification.getByRole("button", { name: "Mark as read" })).toBeHidden();
  await primary.page.reload();
  const reloadedPrimaryTitle = primary.page.getByText(title!, { exact: true });
  await expect(reloadedPrimaryTitle).toBeVisible();
  const reloadedPrimaryNotification = reloadedPrimaryTitle.locator("xpath=ancestor::div[contains(@class,'justify-between')][1]");
  await expect(reloadedPrimaryNotification.getByRole("button", { name: "Mark as read" })).toHaveCount(0);

  const secondary = await authenticatedPage(browser, env!.secondaryEmail, env!.secondaryPassword);
  await secondary.page.goto("/notifications");
  const secondaryTitle = secondary.page.getByText(title!, { exact: true });
  await expect(secondaryTitle).toBeVisible();
  const secondaryNotification = secondaryTitle.locator("xpath=ancestor::div[contains(@class,'justify-between')][1]");
  await expect(secondaryNotification.getByRole("button", { name: "Mark as read" })).toBeVisible();

  await primary.context.close();
  await secondary.context.close();
});
