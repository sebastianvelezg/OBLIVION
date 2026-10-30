import { Hono } from "hono";
import { z } from "zod";
import { CONFIG_DOC_IDS } from "@oblivion/sdk";
import { requireAdmin, type AppEnv } from "../auth.js";
import { applyPlan, buildPlan, currentDocs, type Docs } from "../configdocs.js";
import type { AppDeps } from "../app.js";

const body = z.object({
  documents: z.object(Object.fromEntries(CONFIG_DOC_IDS.map((id) => [id, z.string().max(500_000).optional()]))).strict(),
});

/**
 * Configuración en texto: las conexiones, las páginas con sus widgets y la apariencia como
 * documentos YAML que se pueden leer, revisar (sin guardar nada) y aplicar de golpe.
 */
export function configRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get("/config", requireAdmin, (c) => c.json(currentDocs(deps)));

  // «Revisar»: valida y cuenta qué cambiaría, sin escribir nada.
  app.post("/config/plan", requireAdmin, async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);
    return c.json(buildPlan(deps, parsed.data.documents as Docs).result);
  });

  app.put("/config", requireAdmin, async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);
    const { plan, result } = buildPlan(deps, parsed.data.documents as Docs);
    if (!plan) return c.json({ ...result, error: "Hay errores en los documentos" }, 400);
    applyPlan(deps, plan, c.get("user")!.username);
    return c.json({ ...result, ...currentDocs(deps) });
  });

  return app;
}
