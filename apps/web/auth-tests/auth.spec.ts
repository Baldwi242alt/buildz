import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("configured login fields accept keyboard input and surface real-provider errors", async ({
  page,
}) => {
  await page.route("https://buildz-auth.example.test/**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error_code: "invalid_credentials",
        msg: "Invalid login credentials",
      }),
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("Email address", { exact: true })
    .pressSequentially("student@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .pressSequentially("typing-passphrase");
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "student@example.test",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "typing-passphrase",
  );
  await page.getByLabel("Show password", { exact: true }).check();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid login credentials",
  );
  await expect(page.getByLabel("Password", { exact: true })).toBeEditable();
});

test("signup validates matching passwords, submits only profile metadata and explains email confirmation", async ({
  page,
}) => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  await page.route("https://buildz-auth.example.test/**", async (route) => {
    requests.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        aud: "authenticated",
        role: "authenticated",
        email: "new@example.test",
        email_confirmed_at: null,
        confirmation_sent_at: new Date().toISOString(),
        user_metadata: { display_name: "New Builder" },
        identities: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Display name", { exact: true })
    .pressSequentially("New Builder");
  await dialog
    .getByLabel("Email address", { exact: true })
    .pressSequentially("new@example.test");
  await dialog
    .getByLabel("Create password", { exact: true })
    .fill("A long passphrase 123");
  await dialog
    .getByLabel("Confirm password", { exact: true })
    .fill("Another long passphrase");
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("don’t match");
  expect(requests).toHaveLength(0);
  await dialog
    .getByLabel("Confirm password", { exact: true })
    .fill("A long passphrase 123");
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Check your inbox");
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain("/auth/v1/signup");
  expect(requests[0].url).toContain(
    "redirect_to=http%3A%2F%2F127.0.0.1%3A5174",
  );
  expect(requests[0].body.data).toEqual({ display_name: "New Builder" });
  await expect(page.locator(".sidebar")).toHaveCount(0);
});

test("recovery submits a root callback and returns a neutral confirmation", async ({
  page,
}) => {
  let body: unknown;
  let url = "";
  await page.route("https://buildz-auth.example.test/**", async (route) => {
    body = route.request().postDataJSON();
    url = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Email address")
    .pressSequentially("recover@example.test");
  await dialog.getByRole("button", { name: "Request reset link" }).click();
  await expect(dialog.getByRole("status")).toContainText("Check your inbox");
  expect(body).toMatchObject({ email: "recover@example.test" });
  expect(url).toContain("redirect_to=http%3A%2F%2F127.0.0.1%3A5174");
});
