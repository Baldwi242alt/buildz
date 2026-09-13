import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page, index = 0) {
  await page.goto("/");
  await page.getByLabel("Fictional account").selectOption(String(index));
  await page.getByRole("button", { name: "Connect to local demo" }).click();
  await expect(page.getByRole("heading", { name: /Hey / })).toBeVisible();
}
async function create(page: Page, name: string) {
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill(name);
  await page
    .getByLabel("The idea")
    .fill(
      "Fictional browser integration test for a student-led campus project.",
    );
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  const health = await request.get("http://127.0.0.1:3001/v1/health/ready");
  expect(
    health.ok(),
    "Start npm run dev:backend before running connected tests",
  ).toBe(true);
});

test("real project persists, supports lifecycle, enforces second identity isolation, and accepts an invitation", async ({
  page,
  browser,
}) => {
  const name = `Campus collaboration ${Date.now()}`;
  await login(page);
  await create(page, name);
  const url = page.url();
  await page.reload();
  await page.getByLabel("Fictional account").selectOption("0");
  await page.getByRole("button", { name: "Connect to local demo" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page
    .getByLabel("The idea")
    .fill(
      "Updated through the generated SDK and persisted in the real local database.",
    );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".detail-summary")).toContainText(
    "Updated through the generated SDK",
  );
  await page.getByRole("button", { name: "Move to in progress" }).click();
  await page.getByRole("button", { name: "Update stage", exact: true }).click();
  await expect(page.locator(".detail-title")).toContainText("In progress");
  const context = await browser.newContext();
  const outsider = await context.newPage();
  await login(outsider, 1);
  await outsider.goto(url);
  await expect(outsider.getByRole("alert")).toBeVisible();
  await expect(
    outsider.getByRole("heading", { name, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Invite teammates" }).click();
  await page.getByLabel("Teammate email").fill("bob@harbour.example");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page.getByLabel("Invitation link")).toBeVisible();
  await outsider.goto("http://127.0.0.1:5173/#/invitations");
  const projectId = url.split("/projects/")[1];
  await outsider
    .getByRole("article")
    .filter({ hasText: projectId })
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await outsider
    .getByRole("dialog")
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await expect(
    outsider.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  await expect(
    outsider.getByRole("button", { name: "Edit project", exact: true }),
  ).toBeDisabled();
  await context.close();
});

test("lost mutation response retries the original key without duplicating the project", async ({
  page,
}) => {
  await login(page);
  const name = `Retry-safe project ${Date.now()}`;
  const keys: string[] = [];
  let first = true;
  await page.route("**/v1/projects", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()["idempotency-key"]);
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill(name);
  await page
    .getByLabel("The idea")
    .fill(
      "This request is deliberately interrupted after the database commit.",
    );
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("couldn’t confirm");
  await expect(page.getByLabel("Project name")).toHaveValue(name);
  await expect(page.getByLabel("Project name")).toBeDisabled();
  await page.getByRole("button", { name: "Retry same action" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.getByRole("button", { name: "Back to my projects" }).click();
  await page.getByRole("searchbox", { name: "Search projects" }).fill(name);
  await expect(page.locator(".project-card")).toHaveCount(1);
});

test("version conflict preserves text and requires review", async ({
  page,
}) => {
  await login(page);
  await create(page, `Version test ${Date.now()}`);
  await page.route("**/v1/projects/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "VERSION_CONFLICT",
          message: "Record changed",
          retryable: false,
          requestId: "frontend-conflict-test",
        },
      }),
    });
  });
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page.getByLabel("Project name").fill("Keep this unsaved name");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "changed while you were editing",
  );
  await expect(page.getByLabel("Project name")).toHaveValue(
    "Keep this unsaved name",
  );
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close and review latest" }).click();
  await expect(
    page.getByRole("heading", { name: /Version test/ }),
  ).toBeVisible();
});

test("connected workspace accessibility and failure does not enter sample preview", async ({
  page,
}) => {
  await login(page);
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(report.violations).toEqual([]);
  await page.route("**/v1/me", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Previously loaded details may be out of date",
  );
  await expect(page.locator(".sidebar .brand")).toBeVisible();
  await expect(
    page.getByText("Accessible Campus Guide", { exact: true }),
  ).toHaveCount(0);
});

test("student verification request reaches the school administrator and shows the saved decision", async ({
  page,
  browser,
}) => {
  const statement = `Frontend verification scenario ${Date.now()}`;
  await login(page, 5);
  await page
    .getByRole("link", { name: "School membership", exact: true })
    .click();
  await page
    .getByLabel("Active school")
    .selectOption({ label: "Northstar Demo Polytechnic" });
  await page
    .getByRole("button", { name: "Request verification", exact: true })
    .click();
  await page.getByLabel("Your connection to this school").fill(statement);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Request verification", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({ hasText: statement }),
  ).toBeVisible();
  const context = await browser.newContext();
  const staff = await context.newPage();
  await login(staff, 3);
  await staff
    .getByRole("link", { name: "School membership", exact: true })
    .click();
  await staff
    .getByLabel("Active school")
    .selectOption({ label: "Northstar Demo Polytechnic" });
  const request = staff.getByRole("article").filter({ hasText: statement });
  await request.getByRole("button", { name: "Reject", exact: true }).click();
  await staff
    .getByLabel("Decision reason")
    .fill("Fictional test request: please provide your student reference.");
  await staff
    .getByRole("dialog")
    .getByRole("button", { name: "Reject verification" })
    .click();
  await expect(
    staff.getByRole("article").filter({ hasText: statement }),
  ).toContainText("rejected", { ignoreCase: true });
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: statement }),
  ).toContainText("please provide your student reference");
  await context.close();
});

test("rate limiting respects Retry-After before retrying", async ({ page }) => {
  await login(page);
  let limitOnce = true;
  await page.route("**/v1/projects", async (route) => {
    if (route.request().method() === "POST" && limitOnce) {
      limitOnce = false;
      await route.fulfill({
        status: 429,
        headers: {
          "Retry-After": "2",
          "Access-Control-Expose-Headers": "Retry-After",
        },
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "Wait before retrying.",
            retryable: true,
            requestId: "rate-test",
          },
        }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const name = `Rate limit recovery ${Date.now()}`;
  await page.getByLabel("Project name").fill(name);
  await page
    .getByLabel("The idea")
    .fill("A fictional project to exercise rate-limit recovery.");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Try again in/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Create project", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});
