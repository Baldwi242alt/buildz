import { ServiceError } from "../lib/errors";

/** Outbound evidence is a link, never an embedded third-party frame or an uploaded file. */
export function safeHttps(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function evidenceLinks(value: string, max = 5) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > max)
    throw new ServiceError(
      `Add no more than ${max} evidence links.`,
      "VALIDATION_ERROR",
    );
  const urls = lines.map(safeHttps);
  if (urls.some((url) => !url))
    throw new ServiceError(
      "Each evidence link must be a complete HTTPS address without a username or password.",
      "VALIDATION_ERROR",
    );
  return urls as string[];
}
