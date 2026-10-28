import dns from "node:dns/promises";
import net from "node:net";
import type { HttpInit, HttpResponse } from "@oblivion/sdk";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/** Direcciones a las que ningún plugin debería llegar nunca (metadatos cloud, etc.). */
export function isForbiddenAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254
    if (a >= 224) return true; // multicast / reservado
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::") return true; // dirección no especificada
  if (v6 === "::1") return false; // loopback: permitido (servicios en el mismo host)
  if (v6.startsWith("fe80:")) return true; // link-local
  if (v6.startsWith("::ffff:")) return isForbiddenAddress(v6.slice(7));
  if (v6.startsWith("ff")) return true; // multicast
  return false;
}

export class HttpPolicyError extends Error {}

export interface SafeHttpOptions {
  /** Hostnames fijos declarados por el plugin. */
  allowedHosts: string[];
  /** URLs que el usuario escribió en la configuración del widget. */
  configuredUrls: string[];
  /** Solo tests: reemplaza la resolución DNS. */
  lookup?: (host: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
}

async function defaultLookup(host: string): Promise<string[]> {
  const res = await dns.lookup(host, { all: true });
  return res.map((r) => r.address);
}

export function createSafeHttp(opts: SafeHttpOptions) {
  const hosts = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
  const origins = new Set<string>();
  for (const raw of opts.configuredUrls) {
    try {
      const u = new URL(raw);
      if (u.protocol === "http:" || u.protocol === "https:") origins.add(u.origin);
    } catch {
      /* ignorar */
    }
  }
  const lookup = opts.lookup ?? defaultLookup;
  const doFetch = opts.fetchImpl ?? fetch;

  async function check(url: URL) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new HttpPolicyError(`Protocolo no permitido: ${url.protocol}`);
    }
    if (url.username || url.password) {
      throw new HttpPolicyError("No se permiten credenciales dentro de la URL");
    }
    const allowed = hosts.has(url.hostname.toLowerCase()) || origins.has(url.origin);
    if (!allowed) {
      throw new HttpPolicyError(`El plugin no tiene permiso para llamar a ${url.hostname}`);
    }
    const addrs = net.isIP(url.hostname) ? [url.hostname] : await lookup(url.hostname);
    for (const addr of addrs) {
      if (isForbiddenAddress(addr)) {
        throw new HttpPolicyError(`Dirección bloqueada: ${addr}`);
      }
    }
  }

  return async function http(rawUrl: string, init: HttpInit = {}): Promise<HttpResponse> {
    let url = new URL(rawUrl);
    let method = init.method ?? "GET";
    let body = init.body;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await check(url);
      let res: Response;
      try {
        res = await doFetch(url, {
          method,
          headers: init.headers,
          body: method === "GET" ? undefined : body,
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        // Mensajes pensados para el usuario (sin detalles internos del error).
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        throw new HttpPolicyError(
          timedOut ? `${url.host} tardó demasiado en responder` : `No se pudo conectar con ${url.host}`,
        );
      }

      if (init.redirect !== "manual" && res.status >= 300 && res.status < 400 && res.headers.has("location")) {
        if (hop === MAX_REDIRECTS) throw new HttpPolicyError("Demasiadas redirecciones");
        url = new URL(res.headers.get("location")!, url);
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
        }
        continue;
      }

      const raw = await readCapped(res);
      const text = raw.toString("utf8");
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return {
        ok: res.ok,
        status: res.status,
        headers,
        text,
        bytes: new Uint8Array(raw),
        json<T>() {
          return JSON.parse(text) as T;
        },
      };
    }
    throw new HttpPolicyError("Demasiadas redirecciones");
  };
}

async function readCapped(res: Response): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new HttpPolicyError("La respuesta es demasiado grande");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
