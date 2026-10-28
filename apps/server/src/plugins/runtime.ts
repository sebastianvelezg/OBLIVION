import type { Field, PluginContext, PluginDefinition, WidgetData } from "@oblivion/sdk";
import type { SecretBox } from "../crypto.js";
import { detectImage } from "../security/image.js";
import { createSafeHttp, HttpPolicyError } from "../security/safe-http.js";
import { collectUrls, revealConfig } from "./config.js";
import type { RegisteredWidget } from "./registry.js";
import { viewSchema } from "./schema.js";

interface CacheEntry {
  expires: number;
  data: WidgetData;
}

/** Error de plugin cuyo mensaje es seguro de mostrar al usuario. */
class ExposedError extends Error {}

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_CACHE_TTL_MS = 30 * 60_000;
const IMAGE_CACHE_MAX_BYTES = 24 * 1024 * 1024;

interface ImageEntry {
  expires: number;
  bytes: Uint8Array;
  mime: string;
}

/**
 * Ejecuta `load()` / `image()` de los plugins con caché y sin dos llamadas
 * simultáneas para el mismo widget. Los errores se sanean: nunca viajan
 * secretos ni trazas al navegador.
 */
export class WidgetRuntime {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<WidgetData>>();
  private images = new Map<string, ImageEntry>();
  private imageBytes = 0;

  constructor(
    private readonly box: SecretBox,
    private readonly log: (m: string) => void = console.log,
    private readonly http: typeof createSafeHttp = createSafeHttp,
  ) {}

  invalidate(widgetId: string) {
    this.cache.delete(widgetId);
    for (const [k, v] of this.images) {
      if (k.startsWith(widgetId + "/")) {
        this.imageBytes -= v.bytes.byteLength;
        this.images.delete(k);
      }
    }
  }

  private context(reg: RegisteredWidget, stored: Record<string, unknown>): PluginContext {
    return this.build(reg.plugin, reg.fields, reg.fullType, stored);
  }

  private build(
    plugin: PluginDefinition,
    fields: Field[],
    label: string,
    stored: Record<string, unknown>,
  ): PluginContext {
    return {
      config: revealConfig(fields, stored, this.box),
      http: this.http({
        allowedHosts: plugin.permissions?.network ?? [],
        configuredUrls: collectUrls(fields, stored),
      }),
      log: (m) => this.log(`[${label}] ${String(m).slice(0, 500)}`),
      fail: (m) => {
        throw new ExposedError(String(m).slice(0, 200));
      },
    };
  }

  /** «Probar conexión»: el plugin comprueba la URL/credenciales y responde con un texto para el usuario. */
  async testConnection(
    plugin: PluginDefinition,
    stored: Record<string, unknown>,
  ): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    if (!plugin.test) return { ok: false, error: "Este plugin no puede probar la conexión" };
    try {
      const ctx = this.build(plugin, plugin.connection ?? [], `${plugin.id} (prueba)`, stored);
      const out = await withTimeout(Promise.resolve(plugin.test(ctx)), 15_000);
      return { ok: true, message: typeof out === "string" && out ? out.slice(0, 200) : "Conexión correcta" };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.log(`[${plugin.id}] prueba de conexión: ${detail}`);
      const safe =
        err instanceof HttpPolicyError || err instanceof ExposedError ? detail : "No se pudo probar la conexión";
      return { ok: false, error: safe };
    }
  }

  async getData(
    widgetId: string,
    reg: RegisteredWidget,
    storedConfig: Record<string, unknown>,
  ): Promise<WidgetData> {
    const now = Date.now();
    const hit = this.cache.get(widgetId);
    if (hit && hit.expires > now) return hit.data;

    const running = this.inflight.get(widgetId);
    if (running) return running;

    const p = this.run(reg, storedConfig)
      .then((data) => {
        const ttl = Math.max(5, reg.def.refreshSeconds ?? 60) * 1000;
        // Los errores se cachean poco para no martillear un servicio caído.
        this.cache.set(widgetId, { expires: Date.now() + (data.ok ? ttl : 10_000), data });
        return data;
      })
      .finally(() => this.inflight.delete(widgetId));
    this.inflight.set(widgetId, p);
    return p;
  }

  private async run(reg: RegisteredWidget, stored: Record<string, unknown>): Promise<WidgetData> {
    const { def, fullType } = reg;
    if (!def.load) return { ok: false, error: "Este widget no carga datos en el servidor" };

    try {
      const ctx = this.context(reg, stored);
      const raw = await withTimeout(Promise.resolve(def.load(ctx)), 15_000);
      const parsed = viewSchema.safeParse(raw);
      if (!parsed.success) {
        this.log(`[${fullType}] vista inválida: ${parsed.error.issues[0]?.message}`);
        return { ok: false, error: "El plugin devolvió datos con formato inválido" };
      }
      return { ok: true, view: parsed.data, fetchedAt: Date.now() };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.log(`[${fullType}] error: ${detail}`);
      // Solo se muestran mensajes de política/conexión y los que el plugin marca con ctx.fail().
      const safe =
        err instanceof HttpPolicyError || err instanceof ExposedError
          ? detail
          : "No se pudo obtener la información";
      return { ok: false, error: safe };
    }
  }

  /**
   * Imagen de una `MediaView`. El resultado se valida por su firma real: aunque
   * el servicio (o un plugin) devuelva HTML o un SVG, no se reenvía al navegador.
   */
  async getImage(
    widgetId: string,
    reg: RegisteredWidget,
    stored: Record<string, unknown>,
    key: string,
  ): Promise<{ bytes: Uint8Array; mime: string } | null> {
    if (!reg.def.image) return null;
    const cacheKey = `${widgetId}/${key}`;
    const hit = this.images.get(cacheKey);
    if (hit && hit.expires > Date.now()) return { bytes: hit.bytes, mime: hit.mime };

    try {
      const ctx = this.context(reg, stored);
      const out = await withTimeout(Promise.resolve(reg.def.image(ctx, key)), 15_000);
      const bytes = out?.bytes;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMAGE_BYTES) return null;
      const kind = detectImage(bytes);
      if (!kind) return null;
      this.remember(cacheKey, { expires: Date.now() + IMAGE_CACHE_TTL_MS, bytes, mime: kind.mime });
      return { bytes, mime: kind.mime };
    } catch (err) {
      this.log(`[${reg.fullType}] imagen: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private remember(key: string, entry: ImageEntry) {
    const prev = this.images.get(key);
    if (prev) this.imageBytes -= prev.bytes.byteLength;
    this.images.set(key, entry);
    this.imageBytes += entry.bytes.byteLength;
    // Expulsa lo más antiguo si nos pasamos del tope de memoria.
    for (const [k, v] of this.images) {
      if (this.imageBytes <= IMAGE_CACHE_MAX_BYTES) break;
      this.images.delete(k);
      this.imageBytes -= v.bytes.byteLength;
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("Tiempo agotado")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
