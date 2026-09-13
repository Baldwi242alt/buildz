function publicUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.protocol !== "https:" &&
      !(import.meta.env.DEV && local && url.protocol === "http:")
    )
      return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return value.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export const config = {
  apiBaseUrl: publicUrl(import.meta.env.VITE_BUILDZ_API_BASE_URL),
  authUrl: publicUrl(import.meta.env.VITE_BUILDZ_AUTH_URL),
  authPublishableKey:
    import.meta.env.VITE_BUILDZ_AUTH_PUBLISHABLE_KEY?.trim() || null,
  previewAvailable: import.meta.env.DEV,
  localDemo:
    import.meta.env.DEV && import.meta.env.VITE_BUILDZ_LOCAL_DEMO === "true",
};
