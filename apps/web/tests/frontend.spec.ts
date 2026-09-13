import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) =>
    console.error("Browser runtime error:", error.message),
  );
});

async function preview(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Hey Mina, let’s make things happen." }),
  ).toBeVisible();
}

test("brand casing, explicit preview, no fake sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to BuildZ." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("School sign-in is not configured.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect to local demo" }),
  ).toBeEnabled();
  await expect(page.locator(".brand")).toHaveText("BuildZ");
});

test("sample tour has a direct path to editable connected project forms", async ({
  page,
}) => {
  await preview(page);
  await page
    .getByRole("button", { name: "Open Sounds Between Classes" })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit local draft" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open connected workspace", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome to BuildZ." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connect to local demo" }).click();
  await page.getByRole("link", { name: "My projects", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("Project name")
    .pressSequentially("My editable BuildZ project");
  await expect(page.getByLabel("Project name")).toHaveValue(
    "My editable BuildZ project",
  );
  await page.keyboard.press("Escape");
});

test("search, filters, empty state, and list/grid views", async ({ page }) => {
  await preview(page);
  await expect(page.locator(".project-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Idea", exact: true }).click();
  await expect(page.locator(".project-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(page.getByText("The finish line is still ahead.")).toBeVisible();
  await page.getByRole("button", { name: "Show all projects" }).click();
  await page
    .getByRole("searchbox", { name: "Search projects" })
    .fill("Accessible");
  await expect(page.locator(".project-card")).toHaveCount(1);
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.locator(".projects-grid")).toHaveClass(/list-view/);
  await page
    .getByRole("searchbox", { name: "Search projects" })
    .fill("no matches");
  await expect(page.getByText("No projects match your search.")).toBeVisible();
});

test("local draft validates, persists on reload, edits, and stays school scoped", async ({
  page,
}) => {
  await preview(page);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("Recycled notebooks");
  await page.getByLabel("The idea").fill("Short");
  await page.getByRole("button", { name: "Save local draft" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 20 characters");
  await page
    .getByLabel("The idea")
    .fill("Turning discarded paper into notebooks for our student community.");
  await page.getByRole("button", { name: "Save local draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Recycled notebooks" }),
  ).toBeVisible();
  await expect(
    page.getByText("This draft is saved only in this browser.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Explore sample workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Recycled notebooks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit local draft" }).click();
  await page.getByLabel("Project name").fill("Recycled notebooks, together");
  await page.getByRole("button", { name: "Save local draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Recycled notebooks, together" }),
  ).toBeVisible();
  const privateUrl = page.url();
  await page
    .getByLabel("Active school")
    .selectOption({ label: "Harbour Arts Institute" });
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /Open Recycled/ })).toHaveCount(
    0,
  );
  await page.goto(privateUrl);
  await expect(page.getByText("This page isn’t available.")).toBeVisible();
});

test("dialog keyboard trapping and return focus", async ({ page }) => {
  await preview(page);
  const button = page.getByRole("button", { name: "New project", exact: true });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Project name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("mobile menu hides offscreen controls and supports Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await preview(page);
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close navigation", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
});

test("preview screenshots and reflow across the responsive continuum", async ({
  page,
}, testInfo) => {
  await preview(page);
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [600, 900],
    [768, 1024],
    [900, 900],
    [1024, 768],
    [1366, 768],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("accessibility scan on sign-in, workspace, and new-project dialog", async ({
  page,
}) => {
  await page.goto("/");
  let report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(report.violations).toEqual([]);
  await page.getByRole("button", { name: "Explore sample workspace" }).click();
  report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(report.violations).toEqual([]);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(report.violations).toEqual([]);
});

test("reduced motion and failed storage preserve the draft input", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await preview(page);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("An idea worth keeping");
  await page
    .getByLabel("The idea")
    .fill("A shared student workshop to explore practical making skills.");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded");
    };
  });
  await page.getByRole("button", { name: "Save local draft" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your text is still here",
  );
  await expect(page.getByLabel("Project name")).toHaveValue(
    "An idea worth keeping",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
});
