import http from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

/** Credenciales de los servicios simulados. */
export const STACK = {
  glancesUser: "glances",
  glancesPass: "glances-pass-123",
  qbitUser: "admin",
  qbitPass: "qbit-pass-123",
  transUser: "trans",
  transPass: "trans-pass-123",
  seerrKey: "seerr-api-key-1234567890",
  pihole6Pass: "pihole-pass-123",
  pihole5Token: "0123456789abcdef0123456789abcdef",
  adguardUser: "adguard",
  adguardPass: "adguard-pass-123",
  immichKey: "immich-admin-key-1234567890",
  immichUserKey: "immich-user-key-1234567890",
  jellystatKey: "jellystat-key-1234567890",
  gluetunKey: "gluetun-key-1234567890",
  capiToken: "capi-token-1234567890",
  capiUser: "capi",
  capiPass: "capi-pass-123",
};

const GB = 1024 ** 3;
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export interface MockStack {
  url: string;
  /** Contadores para comprobar que se reutilizan las sesiones. */
  counts: { qbitLogins: number; transSessions: number; piholeLogins: number; dockerCalls: string[] };
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

const basic = (user: string, pass: string) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

/** Servidor que imita Glances, qBittorrent, Transmission, Jellyseerr, Docker (proxy), Pi-hole, AdGuard y Uptime Kuma. */
export async function startMockStack(port = 0): Promise<MockStack> {
  const counts: MockStack["counts"] = { qbitLogins: 0, transSessions: 0, piholeLogins: 0, dockerCalls: [] };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const text = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/plain", ...headers });
      res.end(body);
    };

    // ───────────── Glances ─────────────
    const g = /^\/(glances|glances-auth)\/api\/([34])\/(.+)$/.exec(p);
    if (g) {
      if (g[1] === "glances-auth" && req.headers.authorization !== basic(STACK.glancesUser, STACK.glancesPass)) {
        return json(401, { error: "unauthorized" });
      }
      switch (g[3]) {
        case "system":
          return json(200, { hostname: "tower", os_name: "Linux", os_version: "6.1.74-Unraid" });
        case "cpu":
          return json(200, { total: 23.4, user: 10, system: 5 });
        case "mem":
          return json(200, { total: 32 * GB, used: 12 * GB, percent: 37.5 });
        case "memswap":
          return json(200, { total: 0, used: 0, percent: 0 });
        case "load":
          return json(200, { min1: 0.82, min5: 0.7, min15: 0.6, cpucore: 8 });
        case "uptime":
          return json(200, "12 days, 3:04:05");
        case "fs":
          return json(200, [
            { device_name: "/dev/md2", mnt_point: "/mnt/disk2", fs_type: "xfs", size: 8e12, used: 7.7e12, free: 0.3e12, percent: 96.2 },
            { device_name: "/dev/md1", mnt_point: "/mnt/disk1", fs_type: "xfs", size: 8e12, used: 6.4e12, free: 1.6e12, percent: 80 },
            { device_name: "/dev/nvme0n1p1", mnt_point: "/mnt/cache", fs_type: "btrfs", size: 1e12, used: 0.2e12, free: 0.8e12, percent: 20 },
            { device_name: "overlay", mnt_point: "/", fs_type: "overlay", size: 5e10, used: 1e10, free: 4e10, percent: 20 },
            { device_name: "shm", mnt_point: "/dev/shm", fs_type: "tmpfs", size: 6e7, used: 0, free: 6e7, percent: 0 },
          ]);
        case "sensors":
          return json(200, [
            { label: "Package id 0", value: 61, unit: "C", type: "temperature_core" },
            { label: "Core 3", value: 88, unit: "C", type: "temperature_core" },
            { label: "sda", value: 38, unit: "C", type: "temperature_hdd" },
            { label: "fan1", value: 1200, unit: "RPM", type: "fan_speed" },
          ]);
      }
      return json(404, {});
    }

    // ───────────── qBittorrent ─────────────
    const q = /^\/(qbit|qbit-open)(\/api\/v2\/.+)$/.exec(p);
    if (q) {
      const open = q[1] === "qbit-open";
      if (q[2] === "/api/v2/auth/login") {
        counts.qbitLogins++;
        const body = new URLSearchParams(await readBody(req));
        const host = req.headers.host;
        const csrfOk = req.headers.referer?.includes(host ?? "?") || req.headers.origin?.includes(host ?? "?");
        if (!csrfOk) return text(403, "Forbidden");
        if (body.get("username") === STACK.qbitUser && body.get("password") === STACK.qbitPass) {
          return text(200, "Ok.", { "set-cookie": "SID=qbit-session-abc; HttpOnly; SameSite=Strict; path=/" });
        }
        return text(200, "Fails.");
      }
      if (!open && !/SID=qbit-session-abc/.test(req.headers.cookie ?? "")) return text(403, "Forbidden");
      if (q[2] === "/api/v2/app/version") return text(200, "v4.6.5");
      if (q[2] === "/api/v2/transfer/info") {
        return json(200, { dl_info_speed: 5.2 * 1024 ** 2, up_info_speed: 800 * 1024, connection_status: "connected" });
      }
      if (q[2] === "/api/v2/torrents/info") {
        const all = [
          { name: "ubuntu-24.04-desktop-amd64.iso", state: "downloading", progress: 0.42, dlspeed: 5.2 * 1024 ** 2, upspeed: 0, eta: 3600, size: 4.7e9 },
          { name: "Archivo estancado", state: "stalledDL", progress: 0.1, dlspeed: 0, upspeed: 0, eta: 8640000, size: 1.2e9 },
          { name: "Película sembrando", state: "uploading", progress: 1, dlspeed: 0, upspeed: 800 * 1024, eta: 8640000, size: 8e9 },
          { name: "Archivo con error", state: "error", progress: 0.5, dlspeed: 0, upspeed: 0, eta: 8640000, size: 2e9 },
        ];
        const f = url.searchParams.get("filter");
        const list =
          f === "downloading"
            ? all.filter((t) => ["downloading", "stalledDL"].includes(t.state))
            : f === "active"
              ? all.filter((t) => t.dlspeed > 0 || t.upspeed > 0)
              : all;
        return json(200, list);
      }
      return json(404, {});
    }

    // ───────────── Transmission ─────────────
    const t = /^\/(trans|trans-auth)\/transmission\/rpc$/.exec(p);
    if (t) {
      if (t[1] === "trans-auth" && req.headers.authorization !== basic(STACK.transUser, STACK.transPass)) {
        return text(401, "Unauthorized");
      }
      if (req.headers["x-transmission-session-id"] !== "trans-sess-1") {
        counts.transSessions++;
        return text(409, "session id", { "x-transmission-session-id": "trans-sess-1" });
      }
      const { method } = JSON.parse(await readBody(req));
      const ok = (args: unknown) => json(200, { result: "success", arguments: args });
      if (method === "session-get") return ok({ version: "4.0.5 (a6fe2de)" });
      if (method === "session-stats") {
        return ok({ downloadSpeed: 2 * 1024 ** 2, uploadSpeed: 100 * 1024, activeTorrentCount: 2, pausedTorrentCount: 1, torrentCount: 4 });
      }
      if (method === "torrent-get") {
        return ok({
          torrents: [
            { name: "debian-12.iso", status: 4, percentDone: 0.75, rateDownload: 2 * 1024 ** 2, rateUpload: 0, eta: 600, error: 0, totalSize: 3.9e9 },
            { name: "Sembrando", status: 6, percentDone: 1, rateDownload: 0, rateUpload: 100 * 1024, eta: -1, error: 0, totalSize: 1e9 },
            { name: "Pausado", status: 0, percentDone: 0.3, rateDownload: 0, rateUpload: 0, eta: -1, error: 0, totalSize: 5e8 },
          ],
        });
      }
      return json(200, { result: "method not recognized" });
    }

    // ───────────── Jellyseerr ─────────────
    if (p.startsWith("/seerr/api/v1/")) {
      if (req.headers["x-api-key"] !== STACK.seerrKey) return json(403, { message: "Forbidden" });
      const r = p.slice("/seerr/api/v1/".length);
      if (r === "auth/me") return json(200, { displayName: "Sebas", email: "s@example.com" });
      if (r === "request/count") return json(200, { total: 12, movie: 8, tv: 4, pending: 2, approved: 6, declined: 1, processing: 1, available: 5 });
      if (r === "request") {
        return json(200, {
          results: [
            { id: 1, type: "movie", status: 1, createdAt: iso(10), media: { tmdbId: 1, status: 2 }, requestedBy: { displayName: "Ana" } },
            { id: 2, type: "tv", status: 2, createdAt: iso(200), media: { tmdbId: 2, status: 5 }, requestedBy: { displayName: "Luis" } },
            { id: 3, type: "movie", status: 3, createdAt: iso(3000), media: { tmdbId: 3, status: 1 }, requestedBy: { username: "pepe" } },
          ],
        });
      }
      if (r === "movie/1") return json(200, { title: "Dune: Parte Dos", releaseDate: "2024-02-27" });
      if (r === "tv/2") return json(200, { name: "Severance", firstAirDate: "2022-02-17" });
      return json(404, {});
    }

    // ───────────── Docker (proxy de solo lectura) ─────────────
    if (p.startsWith("/docker")) {
      counts.dockerCalls.push(`${req.method} ${p}${url.search}`);
      if (p.startsWith("/docker-forbidden/")) return text(403, "Forbidden");
      if (p === "/docker/containers/json") {
        const c = (name: string, state: string, status: string, project?: string) => ({
          Id: name,
          Names: [`/${name}`],
          Image: `img/${name}`,
          State: state,
          Status: status,
          Labels: project ? { "com.docker.compose.project": project } : {},
        });
        return json(200, [
          c("jellyfin", "running", "Up 3 days (healthy)", "media"),
          c("sonarr", "running", "Up 3 days (unhealthy)", "media"),
          c("dockge", "running", "Up 5 hours"),
          c("backup", "exited", "Exited (0) 2 hours ago"),
          c("crasheado", "exited", "Exited (137) 1 minute ago"),
          c("reiniciando", "restarting", "Restarting (1) 5 seconds ago"),
        ]);
      }
      return json(404, {});
    }

    // ───────────── Pi-hole 6 ─────────────
    if (p.startsWith("/ph6/api/")) {
      const r = p.slice("/ph6/api/".length);
      if (r === "auth" && req.method === "POST") {
        counts.piholeLogins++;
        const { password } = JSON.parse(await readBody(req));
        return password === STACK.pihole6Pass
          ? json(200, { session: { valid: true, sid: "ph-sid-1", validity: 1800 } })
          : json(401, { session: { valid: false } });
      }
      if (req.headers.sid !== "ph-sid-1") return json(401, { error: { key: "unauthorized" } });
      if (r === "stats/summary") {
        return json(200, {
          queries: { total: 12345, blocked: 3210, percent_blocked: 26.0, unique_domains: 800 },
          gravity: { domains_being_blocked: 98765 },
        });
      }
      if (r === "dns/blocking") return json(200, { blocking: "enabled" });
      return json(404, {});
    }

    // ───────────── Pi-hole 5 ─────────────
    if (p === "/ph5/admin/api.php") {
      if (url.searchParams.get("auth") !== STACK.pihole5Token) return json(200, []);
      return json(200, { domains_being_blocked: 55000, dns_queries_today: 4000, ads_blocked_today: 1000, ads_percentage_today: 25, status: "enabled" });
    }

    // ───────────── AdGuard Home ─────────────
    if (p.startsWith("/adg/control/")) {
      if (req.headers.authorization !== basic(STACK.adguardUser, STACK.adguardPass)) return text(401, "Unauthorized");
      if (p === "/adg/control/status") return json(200, { version: "v0.107.52", protection_enabled: true, running: true });
      if (p === "/adg/control/stats") return json(200, { num_dns_queries: 20000, num_blocked_filtering: 5000, avg_processing_time: 0.0123 });
      return json(404, {});
    }

    // ───────────── Uptime Kuma ─────────────
    if (p === "/kuma/api/status-page/casa") {
      return json(200, {
        config: { title: "Casa" },
        publicGroupList: [
          { name: "Medios", monitorList: [{ id: 1, name: "Jellyfin" }, { id: 2, name: "Jellyseerr" }] },
          { name: "Red", monitorList: [{ id: 3, name: "Router" }, { id: 4, name: "Pi-hole" }] },
        ],
      });
    }
    if (p === "/kuma/api/status-page/heartbeat/casa") {
      return json(200, {
        heartbeatList: {
          "1": [{ status: 1, ping: 24 }],
          "2": [{ status: 0, ping: null }],
          "3": [{ status: 2, ping: 90 }],
          "4": [{ status: 1, ping: 3 }],
        },
        uptimeList: { "1_24": 1, "2_24": 0.9, "3_24": 0.99, "4_24": 1 },
      });
    }

    // ───────────── Scrutiny ─────────────
    if (p === "/scrutiny/api/summary") {
      const disk = (wwn: string, model: string, dev: string, status: number, temp: number, extra: object = {}) => ({
        device: { wwn, model_name: model, device_name: dev, capacity: 4e12, device_status: status, archived: false, ...extra },
        smart: { temp, power_on_hours: 24 * 400 },
      });
      return json(200, {
        success: true,
        data: {
          summary: {
            a: disk("a", "WDC WD40EFRX", "sda", 0, 33),
            b: disk("b", "Seagate ST4000", "sdb", 2, 34),
            c: disk("c", "Toshiba MG08", "sdc", 1, 41),
            d: disk("d", "Disco viejo", "sdd", 1, 50, { archived: true }),
            e: disk("e", "Samsung SSD", "nvme0n1", 0, 38, { capacity: 1e12 }),
          },
        },
      });
    }

    // ───────────── Immich ─────────────
    if (p === "/immich/api/server/statistics" || p === "/immich-old/api/server-info/statistics") {
      const key = req.headers["x-api-key"];
      if (key === STACK.immichUserKey) return json(403, { message: "Missing required permission: server.statistics" });
      if (key !== STACK.immichKey) return json(401, { message: "Invalid API key" });
      return json(200, {
        photos: 12345,
        videos: 321,
        usage: 5.5 * 1024 ** 4,
        usageByUser: [
          { userId: "1", userName: "Ana", photos: 2000, videos: 20, usage: 1 * 1024 ** 4 },
          { userId: "2", userName: "Sebas", photos: 10345, videos: 301, usage: 4.5 * 1024 ** 4 },
        ],
      });
    }

    // ───────────── Jellystat ─────────────
    if (p === "/jellystat/stats/getViewsByLibraryType") {
      if (req.headers["x-api-token"] !== STACK.jellystatKey) return json(401, { message: "Invalid API token" });
      return json(200, { Audio: 14, Movie: 1203, Series: 4521, Other: 0, days: url.searchParams.get("days") });
    }

    // ───────────── Gluetun ─────────────
    const gl = /^\/(gluetun|gluetun-auth|gluetun-old)(\/v1\/.+)$/.exec(p);
    if (gl) {
      if (gl[1] === "gluetun-auth" && req.headers["x-api-key"] !== STACK.gluetunKey) return json(401, { error: "unauthorized" });
      const old = gl[1] === "gluetun-old";
      switch (gl[2]) {
        case "/v1/publicip/ip":
          return json(200, { public_ip: "185.65.134.10", region: "Antioquia", country: "Colombia", city: "Medellín" });
        case "/v1/vpn/status":
          return old ? json(404, {}) : json(200, { status: "running" });
        case "/v1/openvpn/status":
          return old ? json(200, { status: "stopped" }) : json(404, {});
        case "/v1/portforward":
          return old ? json(404, {}) : json(200, { port: 51820 });
        case "/v1/openvpn/portforwarded":
          return old ? json(200, { port: 4242 }) : json(404, {});
      }
      return json(404, {});
    }

    // ───────────── Feeds RSS / Atom ─────────────
    if (p === "/feed/rss") {
      res.writeHead(200, { "content-type": "application/rss+xml" });
      return res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Blog &amp; Cía</title>
        <item><title><![CDATA[Novedades de Oblivion <b>0.2</b>]]></title><link>https://blog.example/oblivion-0-2</link><pubDate>${new Date(Date.now() - 2 * 3600_000).toUTCString()}</pubDate></item>
        <item><title>Tom &amp; Jerry &#233;pico &#x1F600;</title><link>https://blog.example/tom</link><pubDate>${new Date(Date.now() - 30 * 3600_000).toUTCString()}</pubDate></item>
        <item><title>Enlace peligroso</title><link>javascript:alert(1)</link><pubDate>${new Date(Date.now() - 3600_000).toUTCString()}</pubDate></item>
        <item><title></title><link>https://blog.example/sin-titulo</link></item>
      </channel></rss>`);
    }
    if (p === "/feed/atom") {
      res.writeHead(200, { "content-type": "application/atom+xml" });
      return res.end(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title>
        <entry><title>v1.2.3</title><link rel="self" href="https://api.example/self"/><link rel="alternate" href="https://github.example/rel/v1.2.3"/><updated>${new Date(Date.now() - 10 * 60_000).toISOString()}</updated></entry>
      </feed>`);
    }
    if (p === "/feed/html") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html><body>No soy un feed</body></html>");
    }

    // ───────────── API personalizada ─────────────
    const ca = /^\/(capi|capi-bearer|capi-header|capi-basic)(\/.*)?$/.exec(p);
    if (ca) {
      const auth = req.headers.authorization;
      const ok =
        ca[1] === "capi" ||
        (ca[1] === "capi-bearer" && auth === `Bearer ${STACK.capiToken}`) ||
        (ca[1] === "capi-header" && req.headers["x-api-key"] === STACK.capiToken) ||
        (ca[1] === "capi-basic" && auth === basic(STACK.capiUser, STACK.capiPass));
      if (!ok) return json(401, { error: "unauthorized" });
      if (ca[2] === "/stats") {
        return json(200, {
          data: { users: 42, free: 5.4 * 1024 ** 4, cpu: 23.456, up: 93784, ok: true, name: "tower", tags: ["a", "b", "c"], items: [{ name: "Uno", size: 2048, status: "ok" }, { name: "Dos", size: 3 * 1024 ** 3, status: "fallo" }] },
          total: 7,
        });
      }
      if (ca[2] === "/items") return json(200, [{ name: "Uno", size: 2048, status: "ok" }, { name: "Dos", size: 3 * 1024 ** 3, status: "fallo" }, { name: "Tres", size: 1, status: "ok" }]);
      if (ca[2] === "/wrapped") return json(200, { data: { items: [{ name: "Envuelto" }] } });
      if (ca[2] === "/texto") return text(200, "no soy json");
      if (!ca[2]) return json(200, { ok: true });
      return json(404, {});
    }

    json(404, {});
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    counts,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = await startMockStack(Number(process.env.MOCK_PORT ?? 8777));
  console.log(`Servicios simulados en ${m.url}`);
  console.log("  /glances  /glances-auth  /qbit  /trans  /seerr  /docker  /ph6  /ph5  /adg  /kuma");
  console.log("  /scrutiny  /immich  /jellystat  /gluetun  /feed/rss  /feed/atom  /capi");
}
