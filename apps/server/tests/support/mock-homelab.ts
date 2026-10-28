import http from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

export const SPEEDTEST_TOKEN = "st-token-1234567890";

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

/** Resultado en el formato de la API nueva (alexjustesen ≥ 1.2.1). */
const v2Result = (id: number, down: number, up: number, ping: number, minutesAgo: number, status = "completed") => ({
  id,
  service: "faker",
  ping,
  download: (down * 1e6) / 8, // bytes/s
  upload: (up * 1e6) / 8,
  download_bits: down * 1e6,
  upload_bits: up * 1e6,
  download_bits_human: `${down} Mbps`,
  upload_bits_human: `${up} Mbps`,
  healthy: true,
  status,
  scheduled: true,
  data: { server: { name: "Claro Colombia", id: 1 }, isp: "Claro" },
  created_at: iso(minutesAgo),
  updated_at: iso(minutesAgo),
});

export interface MockHomelab {
  url: string;
  requests: { path: string; auth?: string; accept?: string }[];
  /** Cambia lo que responde `/api/v1/results/latest`. */
  setLatestV2(r: unknown): void;
  close(): Promise<void>;
}

/** Servidor que imita Speedtest Tracker (API antigua y nueva) y servicios web de ejemplo. */
export async function startMockHomelab(port = 0): Promise<MockHomelab> {
  const requests: MockHomelab["requests"] = [];
  const defaultLatest = () => v2Result(10, 940.4, 52.3, 11.6, 5);
  let latestV2: unknown = defaultLatest();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    requests.push({ path: url.pathname + url.search, auth: req.headers.authorization, accept: req.headers.accept });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    // ── Speedtest Tracker, API antigua (sin autenticación; valores en Mbps)
    if (url.pathname === "/old/api/speedtest/latest") {
      return json(200, { data: { id: 7, ping: 9.87, download: 94.31, upload: 20.55, created_at: iso(125), scheduled: true } });
    }
    if (url.pathname === "/empty/api/speedtest/latest") return json(200, { data: null });

    // ── Speedtest Tracker, API nueva (Bearer + Accept JSON)
    if (url.pathname.startsWith("/new/api/v1/")) {
      if (req.headers.accept !== "application/json") return json(406, { message: "Not Acceptable" });
      if (req.headers.authorization !== `Bearer ${SPEEDTEST_TOKEN}`) return json(401, { message: "Unauthenticated." });
      if (url.pathname === "/new/api/v1/results/latest") return json(200, latestV2);
      if (url.pathname === "/new/api/v1/results") {
        return json(200, {
          data: [
            v2Result(10, 940.4, 52.3, 11.6, 5),
            v2Result(9, 1204.7, 60, 10.2, 65),
            v2Result(8, 0, 0, 0, 125, "failed"),
            v2Result(7, 310.2, 48.9, 22.4, 185),
          ],
        });
      }
    }

    // ── Servicios web de ejemplo
    if (url.pathname === "/up") return json(200, { ok: true });
    if (url.pathname === "/login-required") return json(401, { error: "login" });
    if (url.pathname === "/boom") return json(500, { error: "boom" });
    if (url.pathname === "/redirect-login") {
      res.writeHead(302, { location: "http://sso.invalid/login" });
      return res.end();
    }
    json(404, {});
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    requests,
    // `undefined` restaura el resultado por defecto.
    setLatestV2: (r) => (latestV2 = r === undefined ? defaultLatest() : r),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = await startMockHomelab(Number(process.env.MOCK_PORT ?? 8765));
  console.log(`Homelab simulado en ${m.url}`);
  console.log(`  Speedtest antigua: ${m.url}/old   ·   nueva: ${m.url}/new  (token: ${SPEEDTEST_TOKEN})`);
  console.log(`  Servicios: /up  /login-required  /boom  /redirect-login`);
}
