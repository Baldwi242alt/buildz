import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { intervalState } from "../src/workflows/MonthPicker";

const solar = "b0120000-0000-4000-8000-000000000001";
const staff = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const response = (data: unknown) => ({
  data,
  meta: { requestId: "ui-regression" },
});
async function login(page: Page, route: string, actor = 0) {
  await page.goto(`/#${route}`);
  await page.getByLabel("Fictional account").selectOption(String(actor));
  await page.getByRole("button", { name: "Connect to local demo" }).click();
  await expect(page.locator(".sidebar .brand")).toBeVisible();
}
function span(day: string, from: string, to: string) {
  return {
    startsAt: new Date(`${day}T${from}:00`).toISOString(),
    endsAt: new Date(`${day}T${to}:00`).toISOString(),
  };
}

test("interval classification never assumes unshared time is free and busy wins", () => {
  const day = "2026-10-01";
  const start = +new Date(`${day}T10:00:00`),
    end = start + 30 * 60000;
  expect(intervalState([], [], start, end)).toBe("Not shared");
  expect(
    intervalState(
      [span(day, "10:00", "10:15"), span(day, "10:15", "10:30")],
      [],
      start,
      end,
    ),
  ).toBe("Free");
  expect(
    intervalState(
      [span(day, "09:00", "12:00")],
      [span(day, "10:15", "11:00")],
      start,
      end,
    ),
  ).toBe("Busy");
  expect(intervalState([span(day, "09:00", "10:15")], [], start, end)).toBe(
    "Not shared",
  );
});

// Only new calendar/mentorship responses are intercepted for deterministic UI
// edge cases. Login/project shell uses the local fictional persisted service.
test("month date selection shows every member's free busy or not-shared status and keyboard/reflow", async ({
  page,
}, info) => {
  await page.route("**/v1/projects/*/team-calendar?**", async (route) => {
    const day = new URL(route.request().url()).searchParams.get("startsAt")!;
    const date = new Date(day);
    const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    await route.fulfill({
      json: response({
        members: [
          {
            userId: "free",
            displayName: "Available teammate",
            windows: [span(local, "09:00", "17:00")],
            busy: [],
          },
          {
            userId: "busy",
            displayName: "Busy teammate",
            windows: [span(local, "09:00", "17:00")],
            busy: [span(local, "10:00", "11:00")],
          },
          {
            userId: "unknown",
            displayName: "Private schedule teammate",
            windows: [],
            busy: [],
          },
        ],
      }),
    });
  });
  await login(page, "/calendar");
  await expect(page.locator(".member-availability-list")).toContainText(
    "Not shared",
  );
  await expect(
    page
      .locator(".member-availability-list li")
      .filter({ hasText: "Available teammate" }),
  ).toContainText("Free");
  await expect(
    page
      .locator(".member-availability-list li")
      .filter({ hasText: "Busy teammate" }),
  ).toContainText("Busy");
  await page.getByRole("button", { name: "Next month" }).click();
  const first = page.locator(".month-day").first();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".month-day").nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".month-day").nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".member-availability-list")).toContainText(
    "Available teammate",
  );
  for (const width of [320, 390, 600, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`team-calendar-${width}.png`),
      fullPage: true,
    });
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByLabel("Starting date").fill("");
  await expect(page.getByRole("alert")).toContainText("Choose a starting date");
});

test("venue board distinguishes opening hours and conflicts and transfers a free slot to booking", async ({
  page,
}, info) => {
  await page.route("**/v1/resources/*/calendar?**", async (route) => {
    const date = new Date(
      new URL(route.request().url()).searchParams.get("startsAt")!,
    );
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    await route.fulfill({
      json: response({
        windows: [span(day, "09:00", "17:00")],
        busy: [span(day, "10:00", "11:00")],
      }),
    });
  });
  await login(page, "/bookings");
  await page.getByRole("button", { name: "Next month" }).click();
  const venue = await page
    .getByRole("combobox", { name: "Venue", exact: true })
    .inputValue();
  await expect(page.locator(".venue-time-slot.availability-busy")).toHaveCount(
    2,
  );
  await expect(
    page.locator(".venue-time-slot.availability-closed").first(),
  ).toBeDisabled();
  await page.locator(".venue-time-slot.availability-free").first().click();
  await page
    .getByRole("combobox", { name: "Booking project", exact: true })
    .selectOption(solar);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`venue-calendar-${width}.png`),
      fullPage: true,
    });
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("link", { name: "Plan this booking" }).click();
  await expect(
    page.getByRole("combobox", { name: "Space or equipment", exact: true }),
  ).toHaveValue(venue);
  await expect(page.getByLabel("Search from")).not.toHaveValue("");
});

test("project mentorship request sends explicit consented message without private summary", async ({
  page,
}) => {
  let sent: Record<string, unknown> | undefined;
  let attempts = 0;
  await page.route("**/v1/mentors?**", (route) =>
    route.fulfill({
      json: response([
        {
          userId: staff,
          displayName: "Test mentor",
          institutionId: "11111111-1111-4111-8111-111111111111",
        },
      ]),
    }),
  );
  await page.route("**/v1/projects/*/mentorships", async (route) => {
    if (route.request().method() === "POST") {
      attempts++;
      if (attempts === 1) {
        await route.fulfill({
          status: 422,
          json: {
            error: {
              code: "VALIDATION_ERROR",
              message: "Please review your request before retrying.",
              requestId: "test",
            },
          },
        });
        return;
      }
      sent = route.request().postDataJSON();
      await route.fulfill({ json: response({ id: "test", state: "pending" }) });
    } else await route.fulfill({ json: response([]) });
  });
  await login(page, `/projects/${solar}`);
  await page.getByRole("button", { name: "Request for mentorship" }).click();
  await page
    .getByLabel("What would you like mentorship with?")
    .pressSequentially("Please help our fictional team plan a prototype.");
  await page.getByRole("button", { name: "Send mentorship request" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Please review your request",
  );
  await expect(
    page.getByLabel("What would you like mentorship with?"),
  ).toHaveValue("Please help our fictional team plan a prototype.");
  await expect(
    page.getByLabel("What would you like mentorship with?"),
  ).toBeEditable();
  await page.getByRole("button", { name: "Send mentorship request" }).click();
  await expect(page.getByRole("status")).toContainText("Mentorship requested");
  expect(sent).toEqual({
    mentorId: staff,
    message: "Please help our fictional team plan a prototype.",
  });
  await expect(
    page.getByRole("group", { name: "Project visibility" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Public", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A window into your project" }),
  ).toBeVisible();
});

test("public nonmembers see mentorship membership guidance without retrying private reads", async ({
  page,
}) => {
  const id = "aaaaaaaa-1111-4111-8111-111111111111";
  await page.route(`**/v1/public/projects/${id}`, (route) =>
    route.fulfill({
      json: response({
        id,
        title: "Public fictional project",
        summary: "Only this curated story is public.",
        tags: [],
        seeking: "",
        projectType: "engineering",
        published: true,
        version: 1,
        updatedAt: new Date().toISOString(),
        shareUrl: `http://localhost/showcase/${id}`,
      }),
    }),
  );
  await page.route(`**/v1/projects/${id}`, (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: { code: "NOT_FOUND", message: "Not found", requestId: "test" },
      },
    }),
  );
  await login(page, "/overview");
  await page.goto(`/#/showcase/${id}`);
  await page.getByRole("button", { name: "Request for mentorship" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Only accepted project members can request mentorship",
  );
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Try again" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Send mentorship request" }),
  ).toHaveCount(0);
});

test("global collaboration separates received owner requests and outgoing requests", async ({
  page,
}) => {
  await page.route("**/v1/projects/*/collaboration-requests?**", (route) =>
    route.fulfill({
      json: response([
        {
          id: "incoming",
          projectId: solar,
          requesterId: "fictional-requester",
          createdAt: new Date().toISOString(),
          message: "Incoming fictional collaboration example.",
          kind: "advice",
          state: "pending",
          version: 1,
          response: null,
        },
      ]),
    }),
  );
  await page.route("**/v1/me/collaboration-requests?**", (route) =>
    route.fulfill({ json: response([]) }),
  );
  await login(page, "/collaboration");
  await expect(
    page.getByRole("combobox", { name: "Requests received by project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Incoming collaboration requests" }),
  ).toContainText("Incoming fictional collaboration example.");
  await expect(
    page.getByRole("button", { name: "Accept request", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your collaboration requests" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Accept request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "does not add them to the private project",
  );
  await page.keyboard.press("Escape");
});

test("real private-project mentorship requires mentor consent and persists acceptance and cancellation", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  const session = await request.post("/__buildz_demo/session", {
    data: { userIndex: 0 },
  });
  expect(session.ok()).toBe(true);
  const token = (await session.json()).access_token;
  const title = `Mentorship browser example ${Date.now()}`;
  const created = await request.post("http://127.0.0.1:3001/v1/projects", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      title,
      summary:
        "Private prototype notes that are never copied to a mentorship request.",
      projectType: "engineering",
      leadInstitutionId: "11111111-1111-4111-8111-111111111111",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const project = (await created.json()).data;
  await login(page, `/projects/${project.id}`);
  await expect(
    page.getByRole("button", { name: "Private", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Request for mentorship" }).click();
  await page
    .getByRole("combobox", { name: "Mentor", exact: true })
    .selectOption("66666666-6666-4666-8666-666666666666");
  await page
    .getByLabel("What would you like mentorship with?")
    .fill("Please help us plan a safe fictional prototype test.");
  await page.getByRole("button", { name: "Send mentorship request" }).click();
  await expect(page.getByRole("status")).toContainText("Mentorship requested");
  await page.goto("/#/consultations");
  const studentRecord = page
    .locator(".mentorship-record")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(studentRecord.locator(".state-pending")).toBeVisible();
  // A pending request must not appear among projects allowed to book this host.
  await page
    .getByRole("button", { name: "Book session", exact: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("combobox", { name: "Project", exact: true })
      .locator(`option[value="${project.id}"]`),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const context = await browser.newContext();
  try {
    const mentorPage = await context.newPage();
    await login(mentorPage, "/consultations", 3);
    const mentorRecord = mentorPage.locator(".mentorship-record").filter({
      has: mentorPage.getByRole("heading", { name: title, exact: true }),
    });
    await expect(mentorRecord).toContainText(
      "Please help us plan a safe fictional prototype test.",
    );
    await expect(mentorRecord).not.toContainText(project.summary);
    await mentorRecord
      .getByRole("button", { name: "Accept mentorship" })
      .click();
    await mentorPage
      .getByRole("dialog")
      .getByRole("button", { name: "Accept mentorship", exact: true })
      .click();
    await expect(mentorRecord.locator(".state-accepted")).toBeVisible();
    await page.goto("/#/overview");
    await page.goto("/#/consultations");
    await expect(studentRecord.locator(".state-accepted")).toBeVisible();
    await page
      .getByRole("button", { name: "Book session", exact: true })
      .first()
      .click();
    await expect(
      page
        .getByRole("combobox", { name: "Project", exact: true })
        .locator(`option[value="${project.id}"]`),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await mentorRecord
      .getByRole("button", { name: "Cancel mentorship" })
      .click();
    await mentorPage
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel mentorship", exact: true })
      .click();
    await expect(mentorRecord.locator(".state-cancelled")).toBeVisible();
    const result = await request.get(
      `http://127.0.0.1:3001/v1/projects/${project.id}/mentorships`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect((await result.json()).data[0].state).toBe("cancelled");
  } finally {
    await context.close();
  }
});
