import { test, expect } from "@playwright/test";
import { safeHttps, evidenceLinks } from "../src/workflows/evidence";

test("evidence links reject unsafe schemes and embedded credentials", () => {
  expect(safeHttps("javascript:alert(1)")).toBeNull();
  expect(safeHttps("http://example.org/photo")).toBeNull();
  expect(safeHttps("https://name:password@example.org")).toBeNull();
  expect(safeHttps(" https://example.org/evidence ")).toBe(
    "https://example.org/evidence",
  );
  expect(
    evidenceLinks("\nhttps://example.org/a\nhttps://example.org/b\n"),
  ).toHaveLength(2);
  expect(evidenceLinks("")).toEqual([]);
  expect(() => evidenceLinks("data:text/html,hello")).toThrow("HTTPS");
  expect(() =>
    evidenceLinks(Array(6).fill("https://example.org/a").join("\n")),
  ).toThrow("no more than");
});
