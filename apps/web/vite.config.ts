import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";

// Explicit development adapter for the backend's documented loopback-only issuer.
// This middleware is never present in the production bundle or preview server.
function localDemo(env: Record<string, string>): Plugin {
  return {
    name: "buildz-local-demo",
    configureServer(server) {
      if (env.VITE_BUILDZ_LOCAL_DEMO !== "true") return;
      server.middlewares.use("/__buildz_demo", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
          const host = new URL(`http://${req.headers.host}`).hostname;
          if (
            !["127.0.0.1", "localhost", "[::1]"].includes(host) ||
            (req.headers.origin &&
              new URL(req.headers.origin).host !== req.headers.host)
          ) {
            res.statusCode = 403;
            res.end("{}");
            return;
          }
          const fixtures = JSON.parse(
            await readFile(
              new URL(
                "../../packages/fixtures/identities.json",
                import.meta.url,
              ),
              "utf8",
            ),
          ) as {
            users: { displayName: string; role: string; email: string }[];
          };
          if (req.method === "GET" && req.url === "/actors") {
            res.end(
              JSON.stringify(
                fixtures.users.map((user, index) => ({
                  index,
                  label: `${user.displayName} · ${user.role}`,
                  email: user.email,
                })),
              ),
            );
            return;
          }
          if (
            req.method !== "POST" ||
            req.url !== "/session" ||
            !req.headers["content-type"]?.startsWith("application/json")
          ) {
            res.statusCode = 404;
            res.end("{}");
            return;
          }
          let body = "";
          for await (const chunk of req) {
            body += String(chunk);
            if (body.length > 512) throw new Error("Invalid request");
          }
          const { userIndex } = JSON.parse(body) as { userIndex: number };
          if (!Number.isInteger(userIndex) || !fixtures.users[userIndex])
            throw new Error("Invalid sample account");
          const base = new URL(env.VITE_BUILDZ_API_BASE_URL);
          if (base.protocol !== "http:" || base.hostname !== "127.0.0.1")
            throw new Error("Local demo requires a loopback API");
          const metaResponse = await fetch(new URL("/v1/meta", base), {
            signal: AbortSignal.timeout(8000),
          });
          const meta = (await metaResponse.json()) as {
            data: { auth: { issuer: string } };
          };
          const issuer = new URL(meta.data.auth.issuer);
          if (
            issuer.protocol !== "http:" ||
            issuer.hostname !== "127.0.0.1" ||
            issuer.username ||
            issuer.password
          )
            throw new Error("Local issuer required");
          const tokenResponse = await fetch(new URL("/token", issuer), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIndex }),
            signal: AbortSignal.timeout(8000),
          });
          if (!tokenResponse.ok) throw new Error("Demo issuer unavailable");
          res.end(await tokenResponse.text());
        } catch {
          res.statusCode = 503;
          res.end(
            JSON.stringify({
              error:
                "The local demo is unavailable. Start npm run dev:backend and try again.",
            }),
          );
        }
      });
    },
  };
}
export default defineConfig(({ mode }) => ({
  optimizeDeps: { exclude: ["@buildz/sdk"] },
  plugins: [react(), localDemo(loadEnv(mode, process.cwd(), "VITE_"))],
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/test-results/**", "**/playwright-report/**"] },
  },
}));
