import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const solar = "b0120000-0000-4000-8000-000000000001";
async function login(page: Page, index: number) {
  await page.goto("/");
  await page.getByLabel("Fictional account").selectOption(String(index));
  await page.getByRole("button", { name: "Connect to local demo" }).click();
  await expect(page.locator(".sidebar .brand")).toBeVisible();
}
async function exerciseFields(page: Page, scope: Locator) {
  await expect(scope).toBeVisible();
  const fields = scope.locator("input:not([type=hidden]),textarea,select");
  await expect(fields.first()).toBeVisible();
  let typed = 0;
  for (let index = 0; index < (await fields.count()); index++) {
    const field = fields.nth(index);
    if (!(await field.isVisible())) continue;
    const info = await field.evaluate((el) => ({
      tag: el.tagName,
      type: el.getAttribute("type") || "text",
      readonly: el.hasAttribute("readonly"),
      label: el.getAttribute("id"),
      max: Number(el.getAttribute("maxlength")) || 10000,
    }));
    if (info.readonly) continue;
    await expect(
      field,
      `Field ${info.label || index} must be operable`,
    ).toBeEnabled();
    if (info.type === "file") continue;
    if (info.tag === "SELECT") {
      const options = await field.locator("option").all();
      if (options.length > 1) await field.selectOption({ index: 1 });
      continue;
    }
    if (info.type === "checkbox") {
      await field.setChecked(!(await field.isChecked()));
      continue;
    }
    await expect(field).toBeEditable();
    if (["date", "datetime-local", "number"].includes(info.type)) {
      const value =
        info.type === "number"
          ? "12"
          : info.type === "date"
            ? "2026-10-01"
            : "2026-10-01T10:30";
      await field.fill(value);
      await expect(field).toHaveValue(value);
      typed++;
      continue;
    }
    await field.click();
    await expect(field).toBeFocused();
    await field.press("ControlOrMeta+A");
    const value = (
      info.type === "email"
        ? "typing-audit@example.test"
        : "BuildZ typing works"
    ).slice(0, info.max);
    await field.pressSequentially(value, { delay: 4 });
    await expect(field).toHaveValue(value);
    await field.press("End");
    await page.keyboard.insertText(" ✓");
    await expect(field).toHaveValue(`${value} ✓`.slice(0, info.max));
    typed++;
  }
  expect(typed).toBeGreaterThan(0);
}

test("student form typing, paste, focus and draft preservation across ten entry points", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, 0);
  const scenarios = [
    ["/projects", "New project"],
    [`/projects/${solar}`, "Edit project"],
    [`/projects/${solar}`, "Invite teammates"],
    [`/projects/${solar}/support`, "Request support"],
    [`/projects/${solar}/progress`, "Share update"],
    [`/projects/${solar}/showcase`, "Edit showcase"],
    ["/profile", "Edit profile"],
    ["/availability", "Replace full schedule"],
  ];
  for (const [route, button] of scenarios) {
    await page.goto(`/#${route}`);
    await page.getByRole("button", { name: button, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await exerciseFields(page, dialog);
    const before = await dialog
      .locator("input,textarea")
      .evaluateAll((fields) =>
        fields.map((field) => (field as HTMLInputElement).value),
      );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("buildz:refresh")),
    );
    await expect(dialog).toBeVisible();
    expect(
      await dialog
        .locator("input,textarea")
        .evaluateAll((fields) =>
          fields.map((field) => (field as HTMLInputElement).value),
        ),
    ).toEqual(before);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations, button).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await page.goto(`/#/projects/${solar}/messages`);
  await exerciseFields(page, page.locator(".message-composer"));
  await page.goto(`/#/projects/${solar}/planning`);
  const voucher = page.getByLabel("Voucher code (optional)");
  await voucher.click();
  await voucher.pressSequentially("TYPING-WORKS");
  await expect(voucher).toHaveValue("TYPING-WORKS");
  expect(errors).toEqual([]);
});

test("staff resource, credit and consultation forms allow real keyboard editing", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page, 3);
  for (const [route, button] of [
    ["/resources", "Add resource"],
    ["/credits", "Create voucher"],
    ["/consultations", "Offer a session"],
    ["/resources/b0120000-0000-4000-8000-000000000010", "Edit resource"],
    [
      "/resources/b0120000-0000-4000-8000-000000000010",
      "Replace opening schedule",
    ],
  ]) {
    await page.goto(`/#${route}`);
    await page.getByRole("button", { name: button, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await exerciseFields(page, dialog);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations, button).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});

test("a background connection failure keeps the open form and typed draft", async ({
  page,
}) => {
  await login(page, 0);
  await page.goto("/#/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const field = page.getByLabel("Project name");
  await field.pressSequentially("Keep this draft through a connection failure");
  await page.route("**/v1/me", (route) => route.abort("failed"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#live-main > .error-message")).toContainText(
    "Previously loaded details may be out of date",
  );
  await expect(field).toHaveValue(
    "Keep this draft through a connection failure",
  );
  await expect(field).toBeEditable();
  await field.press("End");
  await field.pressSequentially(" safely");
  await expect(field).toHaveValue(
    "Keep this draft through a connection failure safely",
  );
  await page.keyboard.press("Escape");
  await page.unroute("**/v1/me");
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
