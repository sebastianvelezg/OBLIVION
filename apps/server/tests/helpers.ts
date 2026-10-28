import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { definePlugin } from "@oblivion/sdk";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SecretBox } from "../src/crypto.js";
import { openDb } from "../src/db.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { WidgetRuntime } from "../src/plugins/runtime.js";

process.env.NODE_ENV = "test";

export const PASSWORD = "correct horse battery staple";

const REAL_PLUGINS = path.resolve(import.meta.dirname, "../../../plugins");

export async function makeApp(
  extra: Partial<ReturnType<typeof loadConfig>> = {},
  opts: { realPlugins?: boolean } = {},
) {
  const config = {
    ...loadConfig({ OBLIVION_DATA_DIR: "/nonexistent", OBLIVION_WEB_DIR: "/nonexistent" }),
    scryptN: 2 ** 10, // rápido en tests
    uploadsDir: fs.mkdtempSync(path.join(os.tmpdir(), "oblivion-test-uploads-")),
    ...extra,
  };
  const db = openDb(":memory:");
  const box = new SecretBox(randomBytes(32));
  // Con `realPlugins` se carga la carpeta plugins/ del repositorio (jellyfin, weather...).
  const registry = opts.realPlugins ? await PluginRegistry.load([REAL_PLUGINS], () => {}) : new PluginRegistry();
  if (!opts.realPlugins) {
    const { corePlugin } = await import("../src/plugins/core.js");
    registry.register(corePlugin);
  }
  registry.register(
    definePlugin({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      widgets: [
        {
          type: "echo",
          name: "Echo",
          description: "devuelve su config",
          defaultSize: { w: 2, h: 2 },
          config: [
            { key: "name", label: "Nombre", type: "string", required: true },
            { key: "token", label: "Token", type: "secret" },
          ],
          load: (ctx) => ({
            kind: "message",
            text: `hola ${ctx.config.name} ${ctx.config.token ?? ""}`.trim(),
          }),
        },
      ],
    }),
  );
  const runtime = new WidgetRuntime(box, () => {});
  const app = createApp({ config, db, box, registry, runtime });
  return { app, db, box, registry, runtime, config };
}

type App = Awaited<ReturnType<typeof makeApp>>["app"];

/** Cliente mínimo que conserva la cookie de sesión. */
export function client(app: App) {
  let cookie = "";
  async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const raw = body instanceof Uint8Array;
    const res = await app.request(url, {
      method,
      headers: {
        ...(raw ? {} : { "content-type": "application/json" }),
        "x-requested-with": "oblivion",
        host: "localhost",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0]!;
      cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }
  return {
    get: (p: string) => call("GET", p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => call("POST", p, b ?? {}, h),
    put: (p: string, b: unknown) => call("PUT", p, b),
    patch: (p: string, b: unknown) => call("PATCH", p, b),
    del: (p: string) => call("DELETE", p),
    raw: call,
    get cookie() {
      return cookie;
    },
  };
}

export async function loggedInAdmin(app: App) {
  const c = client(app);
  const res = await c.post("/api/auth/setup", { username: "admin", password: PASSWORD });
  if (res.status !== 201) throw new Error("setup falló: " + JSON.stringify(res.json));
  return c;
}
