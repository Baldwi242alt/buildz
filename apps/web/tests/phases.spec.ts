import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// These multi-identity journeys share the real demo's 300-requests/minute IP
// budget. Pace scenarios instead of weakening the service's rate limiter.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 10000));
});

const solar = "b0120000-0000-4000-8000-000000000001";
async function login(page: Page, index = 0, route = "/overview") {
  await page.goto(`/#${route}`);
  await page.getByLabel("Fictional account").selectOption(String(index));
  await page.getByRole("button", { name: "Connect to local demo" }).click();
  await expect(page.locator(".sidebar .brand")).toBeVisible();
}
async function create(page: Page, name: string) {
  await page.goto("/#/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill(name);
  await page
    .getByLabel("The idea")
    .fill("A fictional browser-tested project for remaining BuildZ workflows.");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return page.url().split("/projects/")[1];
}
async function token(request: APIRequestContext, index: number) {
  const response = await request.post("/__buildz_demo/session", {
    data: { userIndex: index },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).access_token as string;
}
async function command(
  request: APIRequestContext,
  accessToken: string,
  path: string,
  data: unknown,
) {
  const response = await request.post(`http://127.0.0.1:3001/v1${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data;
}
function localTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

test("private evidence upload, attachment and authorized download persist without public access", async ({
  page,
  browser,
  request,
}) => {
  await login(page);
  const id = await create(page, `Evidence journey ${Date.now()}`);
  await page.getByRole("link", { name: "Progress", exact: true }).click();
  await page.getByRole("button", { name: "Upload evidence file" }).click();
  const filename = `prototype-${Date.now()}.png`;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("Choose evidence file")
    .setInputFiles({ name: filename, mimeType: "image/png", buffer: bytes });
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page
    .getByRole("button", { name: "Upload evidence", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Share update", exact: true }).click();
  await page
    .getByLabel("What did you work on?")
    .fill(
      "Evidence stays private until explicitly attached to this progress update.",
    );
  await page.getByLabel(`Attach ${filename}`, { exact: true }).check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Share update", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: filename, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: filename, exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: `${filename} · Download ready`, exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe(filename);
  const accessToken = await token(request, 0);
  const list = await request.get(
    `http://127.0.0.1:3001/v1/projects/${id}/files`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const file = (await list.json()).data.find(
    (item: { name: string }) => item.name === filename,
  );
  expect(file).toBeTruthy();
  const unauthorized = await request.get(
    `http://127.0.0.1:3001/v1/files/${file.id}/content`,
    { headers: { Authorization: `Bearer ${await token(request, 1)}` } },
  );
  expect(unauthorized.status()).toBe(404);
  const anonymous = await request.get(
    `http://127.0.0.1:3001/v1/files/${file.id}/content`,
  );
  expect(anonymous.status()).toBe(401);
  const context = await browser.newContext();
  const reloaded = await context.newPage();
  await login(reloaded, 0, `/projects/${id}/progress`);
  await expect(
    reloaded.getByRole("button", { name: filename, exact: true }),
  ).toBeVisible();
  await context.close();
});

test("connected workflows reflow at eight widths and preserve keyboard navigation", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await login(page);
  const routes = [
    "resources",
    "calendar",
    `projects/${solar}/planning`,
    `projects/${solar}/progress`,
  ];
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
    for (const route of routes) {
      await page.goto(`/#/${route}`);
      await expect(page.locator(".workflow-heading").first()).toBeVisible();
      await expect(page.locator(".workflow-loading")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}px`,
      ).toBe(true);
      if ([320, 390, 1440].includes(width))
        await page.screenshot({
          path: testInfo.outputPath(
            `${route.replaceAll("/", "-")}-${width}.png`,
          ),
          fullPage: true,
          animations: "disabled",
        });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Upload evidence file" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Upload evidence file" }),
  ).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("forced-colors-progress.png"),
    fullPage: true,
  });
});

test("remaining workflow screens render with no runtime errors and accessible landmarks", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const routes = [
    "/resources",
    "/availability",
    "/calendar",
    "/bookings",
    "/consultations",
    "/discover",
    "/collaboration",
    "/notifications",
    "/credits",
    ...["support", "progress", "planning", "messages", "showcase"].map(
      (tab) => `/projects/${solar}/${tab}`,
    ),
  ];
  for (const route of routes) {
    await page.goto(`/#${route}`);
    await expect(page.locator("#live-main")).toBeVisible();
    await expect(page.locator(".workflow-heading").first()).toBeVisible();
    await expect(page.locator(".workflow-loading")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(scan.violations, route).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("proposal decision and progress feedback persist across student and staff identities", async ({
  page,
  browser,
}) => {
  await login(page);
  const name = `Support journey ${Date.now()}`;
  const id = await create(page, name);
  await page.getByRole("link", { name: "Support", exact: true }).click();
  await page
    .getByRole("button", { name: "Request support", exact: true })
    .click();
  await page.getByLabel("What will your project achieve?").fill(name);
  await page
    .getByLabel("What support do you need?")
    .fill("A safe room and an advisor to review our prototype.");
  await page.getByLabel("Time allowance requested (minutes)").fill("120");
  await page
    .getByRole("button", { name: "Send proposal", exact: true })
    .click();
  await expect(page.locator(".state-submitted")).toBeVisible();
  await page.getByRole("link", { name: "Progress", exact: true }).click();
  await page.getByRole("button", { name: "Share update", exact: true }).click();
  await page
    .getByLabel("What did you work on?")
    .fill(`First prototype ${name}`);
  await page.getByLabel("Time spent (minutes)").fill("30");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Share update", exact: true })
    .click();
  await expect(
    page.getByText(`First prototype ${name}`, { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext();
  const staff = await context.newPage();
  await staff.route("**/v1/institutions/*/staff", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await login(staff, 3, "/review");
  const card = staff
    .locator(".workflow-record")
    .filter({ has: staff.getByRole("heading", { name, exact: true }) })
    .first();
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await staff
    .getByLabel("Decision and next steps")
    .fill("Approved for a supervised test.");
  await staff.getByLabel("Time allowance granted (minutes)").fill("90");
  await staff
    .getByLabel("Supervisor (optional)")
    .selectOption("66666666-6666-4666-8666-666666666666");
  await staff
    .getByRole("button", { name: "Approve proposal", exact: true })
    .click();
  await expect(staff.getByRole("dialog")).toHaveCount(0);
  await staff.goto(`/#/projects/${id}/progress`);
  await staff.getByRole("button", { name: "Give feedback" }).click();
  await staff
    .getByLabel("Feedback for the team")
    .fill("Good work. Document the next test before proceeding.");
  await staff.getByRole("button", { name: "Save feedback" }).click();
  await expect(
    staff.getByText("Good work. Document the next test before proceeding.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`/#/projects/${id}/support`);
  await expect(page.locator(".state-approved")).toBeVisible();
  await expect(
    page.getByText("Approved for a supervised test.", { exact: true }),
  ).toBeVisible();
  await page.goto(`/#/projects/${id}/progress`);
  await page.getByRole("button", { name: "View feedback" }).click();
  await expect(
    page.getByText("Good work. Document the next test before proceeding.", {
      exact: true,
    }),
  ).toBeVisible();
  await context.close();
});

test("public showcase preserves private fields and accepted join requests grant member access", async ({
  page,
  browser,
}) => {
  await login(page);
  const title = `Public collaboration ${Date.now()}`;
  const id = await create(page, title);
  await page.getByRole("link", { name: "Showcase", exact: true }).click();
  await page.getByRole("button", { name: "Create a showcase" }).click();
  await page
    .getByLabel("Public summary")
    .fill(
      "A deliberately authored public story, without private project details.",
    );
  await page.getByLabel("Topics (optional)").fill("community, browser-test");
  await page
    .getByLabel("I have reviewed these fields and want them to be public")
    .check();
  await page
    .getByRole("button", { name: "Publish showcase", exact: true })
    .click();
  await expect(page.getByLabel("Shareable showcase link")).toBeVisible();
  const context = await browser.newContext();
  const visitor = await context.newPage();
  await visitor.goto(`/showcase/${id}`);
  await expect(
    visitor.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    visitor.getByText(
      "A fictional browser-tested project for remaining BuildZ workflows.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await visitor.getByRole("button", { name: "Sign in to collaborate" }).click();
  await visitor.getByLabel("Fictional account").selectOption("2");
  await visitor.getByRole("button", { name: "Connect to local demo" }).click();
  await expect(
    visitor.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await visitor
    .getByRole("button", { name: "Ask to join", exact: true })
    .click();
  await visitor
    .getByLabel("Introduce yourself and how you’d like to help")
    .fill("I would like to help with the next prototype.");
  await visitor.getByRole("button", { name: "Send join request" }).click();
  await expect(visitor.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await page
    .getByRole("button", { name: "Accept request", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Accept request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await visitor.goto(`/#/projects/${id}`);
  await expect(
    visitor.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    visitor.getByRole("button", { name: "Edit project", exact: true }),
  ).toBeDisabled();
  await context.close();
});

test("team messages persist across identities and an interrupted send reuses the same key", async ({
  page,
  browser,
}) => {
  await login(page, 0, `/projects/${solar}/messages`);
  const message = `Persistent team message ${Date.now()}`;
  let first = true;
  const keys: string[] = [];
  await page.route(`**/v1/projects/${solar}/messages`, async (route) => {
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
  await page.getByLabel("Message your team").fill(message);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Message your team")).toBeDisabled();
  await page.getByRole("button", { name: "Retry same message" }).click();
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const context = await browser.newContext();
  const teammate = await context.newPage();
  await login(teammate, 1, `/projects/${solar}/messages`);
  await expect(teammate.getByText(message, { exact: true })).toHaveCount(1);
  await context.close();
});

test("booking approval, competing reservation denial, cancellation and voucher release use real persisted state", async ({
  page,
  browser,
  request,
}) => {
  const staffToken = await token(request, 3);
  const name = `Booking room ${Date.now()}`;
  const resource = await command(request, staffToken, "/resources", {
    institutionId: "11111111-1111-4111-8111-111111111111",
    name,
    description:
      "A fictional resource created by the browser integration suite.",
    category: "room",
    location: "Demo campus test room",
    latitude: 1.3,
    longitude: 103.8,
    currency: "SGD",
    hourlyRate: 1000,
    externalHourlyRate: 1500,
    crossSchool: true,
    requiresApproval: true,
    safetyCode: null,
    capacity: 5,
  });
  const start = new Date(
    Math.ceil(Date.now() / 3600000) * 3600000 + 4 * 86400000,
  ).toISOString();
  const end = new Date(Date.parse(start) + 3600000).toISOString();
  await command(request, staffToken, `/resources/${resource.id}/windows`, {
    windows: [{ startsAt: start, endsAt: end }],
  });
  const code = `WEB-${Date.now()}`;
  const voucher = await command(request, staffToken, "/vouchers", {
    institutionId: resource.institutionId,
    code,
    currency: "SGD",
    discountMinor: 500,
    budgetMinor: 5000,
    maxRedemptions: 10,
    validUntil: new Date(Date.now() + 10 * 86400000).toISOString(),
  });
  await login(page, 0, `/projects/${solar}/planning`);
  await page.getByLabel("Space or equipment").selectOption(resource.id);
  await page.getByLabel("Search from / exact start").fill(localTime(start));
  await page.getByLabel("Search until / exact end").fill(localTime(end));
  await page.getByLabel("Voucher code (optional)").fill(code);
  await page.getByRole("button", { name: "Quote this exact time" }).click();
  await expect(page.getByLabel("Booking quote")).toContainText("5.00");
  await page.getByRole("button", { name: "Request staff approval" }).click();
  await page
    .getByLabel("I reviewed the time, attendees, total, and resource rules")
    .check();
  await page
    .getByRole("button", { name: "Request booking", exact: true })
    .click();
  await expect(
    page.getByText("Your booking was saved.", { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext();
  const staff = await context.newPage();
  await login(staff, 3, "/bookings");
  const card = staff
    .locator(".workflow-record")
    .filter({ has: staff.getByRole("heading", { name, exact: true }) });
  await card
    .getByRole("button", { name: "Approve booking", exact: true })
    .click();
  await staff
    .getByLabel("Reason / note for the team")
    .fill("Approved for a safe supervised test.");
  await staff
    .getByRole("dialog")
    .getByRole("button", { name: "Approve booking", exact: true })
    .click();
  await expect(card.locator(".state-confirmed")).toBeVisible();
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await login(other, 1, `/projects/${solar}/planning`);
  await other.getByLabel("Space or equipment").selectOption(resource.id);
  await other.getByLabel("Search from / exact start").fill(localTime(start));
  await other.getByLabel("Search until / exact end").fill(localTime(end));
  await other.getByRole("button", { name: "Quote this exact time" }).click();
  await expect(other.getByRole("alert")).toContainText("reserved");
  await expect(other.getByLabel("Booking quote")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  const studentCard = page
    .locator(".workflow-record")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(studentCard.locator(".state-confirmed")).toBeVisible();
  await studentCard
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await page
    .getByLabel("Reason / note for the team")
    .fill("Integration test completed; release the room and credit.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await expect(studentCard.locator(".state-cancelled")).toBeVisible();
  const ledgerResponse = await request.get(
    `http://127.0.0.1:3001/v1/vouchers/${voucher.id}/ledger`,
    { headers: { Authorization: `Bearer ${staffToken}` } },
  );
  expect(ledgerResponse.ok()).toBe(true);
  const entries = (await ledgerResponse.json()).data;
  expect(entries.map((entry: { kind: string }) => entry.kind).sort()).toEqual([
    "redeem",
    "release",
  ]);
  expect(
    entries.reduce(
      (sum: number, entry: { amountMinor: number }) => sum + entry.amountMinor,
      0,
    ),
  ).toBe(0);
  await context.close();
  await otherContext.close();
});

test("consultation receipt survives reload and cancellation frees the host slot", async ({
  page,
  request,
}) => {
  const staffToken = await token(request, 3);
  let start = "";
  let slot: { id: string; location: string } | undefined;
  // Persistent demo fixtures outlive each run. Find a genuinely free host time
  // instead of randomly colliding with slots created by earlier tests.
  for (let attempt = 0; attempt < 48; attempt++) {
    start = new Date(
      Math.ceil(Date.now() / 3600000) * 3600000 +
        14 * 86400000 +
        attempt * 3600000,
    ).toISOString();
    const response = await request.post(
      "http://127.0.0.1:3001/v1/consultation-slots",
      {
        headers: {
          Authorization: `Bearer ${staffToken}`,
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: {
          institutionId: "11111111-1111-4111-8111-111111111111",
          startsAt: start,
          endsAt: new Date(Date.parse(start) + 30 * 60000).toISOString(),
          location: `Test advisor office ${Date.now()}`,
          crossSchool: true,
        },
      },
    );
    const result = await response.json();
    if (response.status() === 409 && result.error?.code === "SLOT_UNAVAILABLE")
      continue;
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    slot = result.data;
    break;
  }
  if (!slot)
    throw new Error(
      "No free fictional host slot remained in the test fixture range.",
    );
  await login(page, 0, "/consultations");
  const card = page.locator(".slot-result").filter({ hasText: slot.location });
  await card.getByRole("button", { name: "Book session" }).click();
  await page.getByLabel("Project", { exact: true }).selectOption(solar);
  const topic = `Advice journey ${Date.now()}`;
  await page.getByLabel("What would you like help with?").fill(topic);
  await page
    .getByRole("button", { name: "Book consultation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: topic, exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel("Fictional account").selectOption("0");
  await page.getByRole("button", { name: "Connect to local demo" }).click();
  const saved = page
    .locator(".workflow-record")
    .filter({ has: page.getByRole("heading", { name: topic, exact: true }) });
  await expect(saved).toContainText(slot.location);
  await expect(saved).toContainText("Northstar Staff");
  await page.goto("/#/calendar");
  await page.getByLabel("Starting date").fill(localTime(start).slice(0, 10));
  await page
    .getByRole("combobox", { name: "View", exact: true })
    .selectOption("1");
  await expect(
    page
      .locator(".agenda-list")
      .getByRole("heading", { name: topic, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Starting date").fill("");
  await expect(page.getByRole("alert")).toContainText("Choose a starting date");
  await page.goto("/#/consultations");
  await saved.getByRole("button", { name: "Cancel consultation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel consultation" })
    .click();
  await expect(saved.locator(".state-cancelled")).toBeVisible();
  await expect(
    page.locator(".slot-result").filter({ hasText: slot.location }),
  ).toBeVisible();
});
