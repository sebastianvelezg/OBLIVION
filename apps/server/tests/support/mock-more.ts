import http from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

/** Credenciales de los servicios simulados (segunda tanda de integraciones). */
export const MORE = {
  arrKey: "0123456789abcdef0123456789abcdef",
  paperlessToken: "abcdef0123456789abcdef0123456789abcdef01",
  paperlessUser: "paper",
  paperlessPass: "paper-pass-123",
  upsName: "ups",
  haToken: "ha-long-lived-token-abcdefghijklmnopqrstuvwxyz",
  ncToken: "nc-serverinfo-token-123",
  ncUser: "admin",
  ncAppPass: "nc-app-pass-1234",
  npmUser: "oblivion@casa.lan",
  npmPass: "npm-pass-123",
  wudUser: "wud",
  wudPass: "wud-pass-123",
  wtToken: "watchtower-token-123",
  hcKey: "hc-readonly-key-1234567890",
  beszelUser: "beszel@casa.lan",
  beszelPass: "beszel-pass-123",
};

export interface MockMore {
  url: string;
  counts: { npmLogins: number; beszelLogins: number; haTemplates: string[]; requests: { path: string; auth?: string }[] };
  close(): Promise<void>;
}

const isoAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
/** «Mañana a mediodía» en hora local: da «Mañana 12:00» sin depender de la hora a la que corra el test. */
const dayAt = (offsetDays: number, hour = 12) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const npmDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400_000).toISOString().slice(0, 19).replace("T", " ");
const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

export async function startMockMore(port = 0): Promise<MockMore> {
  const counts: MockMore["counts"] = { npmLogins: 0, beszelLogins: 0, haTemplates: [], requests: [] };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    counts.requests.push({ path: p + url.search, auth: req.headers.authorization });
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const text = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(body);
    };

    // ───────────── *arr ─────────────
    const arr = /^\/(sonarr|radarr|lidarr|prowlarr|bazarr)(\/api\/.+)$/.exec(p);
    if (arr) {
      const header = arr[1] === "bazarr" ? req.headers["x-api-key"] : req.headers["x-api-key"];
      if (header !== MORE.arrKey) return json(401, { error: "Unauthorized" });
      const r = arr[2]!;
      switch (`${arr[1]} ${r}`) {
        case "sonarr /api/v3/system/status":
          return json(200, { appName: "Sonarr", version: "4.0.9.2244" });
        case "sonarr /api/v3/queue":
          return json(200, {
            totalRecords: 3,
            records: [
              { title: "Severance.S01E03", series: { title: "Severance" }, episode: { seasonNumber: 1, episodeNumber: 3, title: "In Perpetuity" }, status: "downloading", trackedDownloadState: "downloading", trackedDownloadStatus: "ok", size: 1e9, sizeleft: 6e8, timeleft: "00:12:34" },
              { title: "Fallout.S01E01", series: { title: "Fallout" }, episode: { seasonNumber: 1, episodeNumber: 1, title: "The End" }, status: "completed", trackedDownloadState: "importPending", trackedDownloadStatus: "warning", size: 2e9, sizeleft: 0, timeleft: "00:00:00" },
              { title: "Roto.S02E02", series: { title: "Serie rota" }, episode: { seasonNumber: 2, episodeNumber: 2, title: "Fallo" }, status: "failed", trackedDownloadState: "failed", trackedDownloadStatus: "error", size: 3e9, sizeleft: 3e9, timeleft: "1.02:00:00" },
            ],
          });
        case "sonarr /api/v3/calendar":
          return json(200, [
            { series: { title: "Andor" }, seasonNumber: 2, episodeNumber: 5, title: "Mañana", airDateUtc: dayAt(1), hasFile: false },
            { series: { title: "Severance" }, seasonNumber: 2, episodeNumber: 1, title: "Hoy", airDateUtc: dayAt(0, 23), hasFile: true },
            { series: { title: "Sin fecha" }, seasonNumber: 1, episodeNumber: 1, title: "x" },
          ]);
        case "sonarr /api/v3/wanted/missing":
          return json(200, { totalRecords: 5, records: [{ series: { title: "Andor" }, seasonNumber: 2, episodeNumber: 4, title: "Faltante", airDateUtc: isoAgo(60 * 24 * 3) }] });

        case "radarr /api/v3/system/status":
          return json(200, { appName: "Radarr", version: "5.8.3" });
        case "radarr /api/v3/queue":
          return json(200, { totalRecords: 1, records: [{ movie: { title: "Dune", year: 2021 }, title: "Dune.2021", status: "downloading", trackedDownloadState: "downloading", trackedDownloadStatus: "ok", size: 8e9, sizeleft: 2e9, timeleft: "1.02:00:00" }] });
        case "radarr /api/v3/calendar":
          return json(200, [
            { title: "Película Nueva", year: 2026, digitalRelease: dayAt(1), hasFile: false },
            { title: "Muy lejos", year: 2030, digitalRelease: dayAt(400), hasFile: false },
            { title: "Solo cines", year: 2026, inCinemas: dayAt(3), hasFile: false },
          ]);
        case "radarr /api/v3/wanted/missing":
          return json(200, { totalRecords: 2, records: [{ title: "Perdida", year: 2019, studio: "A24" }] });

        case "lidarr /api/v1/system/status":
          return json(200, { appName: "Lidarr", version: "2.4.3" });
        case "lidarr /api/v1/queue":
          return json(200, { totalRecords: 1, records: [{ artist: { artistName: "Radiohead" }, album: { title: "OK Computer" }, title: "x", status: "downloading", trackedDownloadState: "downloading", trackedDownloadStatus: "ok", size: 1e8, sizeleft: 5e7, timeleft: "00:05:00" }] });
        case "lidarr /api/v1/calendar":
          return json(200, [{ title: "Nuevo álbum", artist: { artistName: "Artista X" }, releaseDate: dayAt(1) }]);
        case "lidarr /api/v1/wanted/missing":
          return json(200, { totalRecords: 3, records: [{ title: "Perdido", artist: { artistName: "Banda Y" }, releaseDate: dayAt(-30) }] });

        case "prowlarr /api/v1/system/status":
          return json(200, { appName: "Prowlarr", version: "1.21.2" });
        case "prowlarr /api/v1/indexer":
          return json(200, [
            { id: 1, name: "NZBgeek", enable: true, protocol: "usenet" },
            { id: 2, name: "1337x", enable: true, protocol: "torrent" },
            { id: 3, name: "Viejo", enable: false, protocol: "torrent" },
          ]);
        case "prowlarr /api/v1/indexerstatus":
          return json(200, [{ indexerId: 2, disabledTill: new Date(Date.now() + 3600_000).toISOString(), mostRecentFailure: isoAgo(5) }]);

        case "bazarr /api/system/status":
          return json(200, { data: { bazarr_version: "1.4.3" } });
        case "bazarr /api/movies/wanted":
          return json(200, { data: [], total: 12 });
        case "bazarr /api/episodes/wanted":
          return json(200, { data: [], total: 40 });
      }
      return json(404, {});
    }

    // ───────────── Paperless-ngx ─────────────
    if (p.startsWith("/paperless/api/")) {
      const a = req.headers.authorization;
      if (a !== `Token ${MORE.paperlessToken}` && a !== basic(MORE.paperlessUser, MORE.paperlessPass)) return json(401, { detail: "Invalid token." });
      if (p === "/paperless/api/statistics/") {
        return json(200, {
          documents_total: 1234,
          documents_inbox: 3,
          inbox_tag: 1,
          character_count: 5_000_000,
          document_file_type_counts: [
            { mime_type: "image/png", mime_type_count: 200 },
            { mime_type: "application/pdf", mime_type_count: 1000 },
          ],
        });
      }
      if (p === "/paperless/api/documents/") {
        return json(200, { count: 2, results: [{ id: 7, title: "Factura de la luz", created: "2026-10-01" }, { id: 8, title: "", created: "2026-09-15" }] });
      }
      return json(404, {});
    }

    // ───────────── PeaNUT ─────────────
    const nut = /^\/(peanut|peanut-old)\/api\/v1\/devices\/([^/]+)$/.exec(p);
    if (nut) {
      if (nut[1] === "peanut-old") {
        if (nut[2] !== "ups") return json(404, {});
        return json(200, { upsData: { battery_charge: 50, ups_load: 10, ups_status: "OL", ups_realpower_nominal: 400 } });
      }
      if (nut[2] === "ups") {
        return json(200, { "battery.charge": 87, "ups.load": 23, "ups.status": "OL CHRG", "battery.runtime": 5400, "input.voltage": 120.5, "ups.realpower": 150, "device.model": "Back-UPS ES 700G" });
      }
      if (nut[2] === "apagon") return json(200, { "battery.charge": 15, "ups.load": 80, "ups.status": "OB DISCHRG LB", "battery.runtime": 240 });
      if (nut[2] === "bateria") return json(200, { "battery.charge": 60, "ups.load": 30, "ups.status": "OB", "battery.runtime": 1500 });
      return json(404, {});
    }

    // ───────────── Home Assistant ─────────────
    if (p.startsWith("/ha/api")) {
      if (req.headers.authorization !== `Bearer ${MORE.haToken}`) return json(401, { message: "401: Unauthorized" });
      if (p === "/ha/api/") return json(200, { message: "API running." });
      if (p === "/ha/api/template" && req.method === "POST") {
        const { template } = JSON.parse(await readBody(req));
        counts.haTemplates.push(String(template));
        return text(200, JSON.stringify({ lights_on: 3, lights: 8, switches_on: 2, people_home: 1, people: 2, unavailable: 4 }));
      }
      const states: Record<string, unknown> = {
        "sensor.temperatura": { state: "21.46", attributes: { unit_of_measurement: "°C", friendly_name: "Temperatura salón" } },
        "sensor.potencia": { state: "1250.4", attributes: { unit_of_measurement: "W", friendly_name: "Potencia" } },
        "light.sala": { state: "on", attributes: { friendly_name: "Luz sala" } },
        "person.sebas": { state: "not_home", attributes: { friendly_name: "Sebas" } },
        "sensor.caido": { state: "unavailable", attributes: { friendly_name: "Sensor caído" } },
      };
      const m = /^\/ha\/api\/states\/(.+)$/.exec(p);
      if (m && states[m[1]!]) return json(200, { entity_id: m[1], ...(states[m[1]!] as object) });
      return json(404, { message: "Entity not found." });
    }

    // ───────────── Nextcloud ─────────────
    if (p === "/nc/ocs/v2.php/apps/serverinfo/api/v1/info") {
      const a = req.headers.authorization;
      const ok = req.headers["nc-token"] === MORE.ncToken || a === basic(MORE.ncUser, MORE.ncAppPass);
      if (req.headers["ocs-apirequest"] !== "true") return json(412, {});
      if (!ok) return json(401, { ocs: { meta: { status: "failure", statuscode: 997 } } });
      return json(200, {
        ocs: {
          meta: { status: "ok", statuscode: 200 },
          data: {
            nextcloud: {
              system: { version: "29.0.4", freespace: 2 * 1024 ** 4, cpuload: [0.52, 0.4, 0.3], mem_total: 16_000_000, mem_free: 4_000_000 },
              storage: { num_users: 5, num_files: 123456 },
              shares: { num_shares: 42 },
            },
            activeUsers: { last5minutes: 1, last1hour: 2, last24hours: 3 },
          },
        },
      });
    }

    // ───────────── Nginx Proxy Manager ─────────────
    if (p === "/npm/api/tokens" && req.method === "POST") {
      counts.npmLogins++;
      const { identity, secret } = JSON.parse(await readBody(req));
      if (identity === MORE.npmUser && secret === MORE.npmPass) return json(200, { token: "npm-jwt-1", expires: new Date(Date.now() + 3600_000).toISOString() });
      return json(401, { error: { message: "Invalid password" } });
    }
    if (p.startsWith("/npm/api/nginx/")) {
      if (req.headers.authorization !== "Bearer npm-jwt-1") return json(403, { error: { message: "Forbidden" } });
      if (p === "/npm/api/nginx/proxy-hosts") {
        return json(200, [
          { id: 1, domain_names: ["jf.casa.lan", "jellyfin.casa.lan"], forward_scheme: "http", forward_host: "192.168.1.10", forward_port: 8096, enabled: 1, certificate_id: 5, meta: { nginx_online: true } },
          { id: 2, domain_names: ["roto.casa.lan"], forward_scheme: "http", forward_host: "192.168.1.11", forward_port: 80, enabled: 1, certificate_id: 0, meta: { nginx_online: false, nginx_err: "boom" } },
          { id: 3, domain_names: ["off.casa.lan"], forward_scheme: "https", forward_host: "192.168.1.12", forward_port: 443, enabled: 0, certificate_id: 0, meta: {} },
        ]);
      }
      if (p === "/npm/api/nginx/certificates") {
        return json(200, [
          { id: 1, nice_name: "*.casa.lan", domain_names: ["*.casa.lan"], provider: "letsencrypt", expires_on: npmDate(5.5) },
          { id: 2, nice_name: "otro", domain_names: ["otro.lan"], provider: "other", expires_on: npmDate(90.5) },
          { id: 3, nice_name: "vencido", domain_names: ["viejo.lan"], provider: "letsencrypt", expires_on: npmDate(-3) },
          { id: 4, nice_name: "pronto", domain_names: ["pronto.lan"], provider: "letsencrypt", expires_on: npmDate(15.5) },
        ]);
      }
      return json(404, {});
    }

    // ───────────── What's Up Docker ─────────────
    if (p === "/wud/api/containers" || p === "/wud-auth/api/containers") {
      if (p.startsWith("/wud-auth") && req.headers.authorization !== basic(MORE.wudUser, MORE.wudPass)) return text(401, "Unauthorized");
      return json(200, [
        { name: "jellyfin", updateAvailable: true, image: { name: "jellyfin/jellyfin", tag: { value: "10.9.1" } }, updateKind: { kind: "tag", localValue: "10.9.1", remoteValue: "10.10.0", semverDiff: "minor" } },
        { name: "traefik", updateAvailable: true, image: { name: "traefik", tag: { value: "2.11" } }, updateKind: { kind: "tag", localValue: "2.11", remoteValue: "3.0.0", semverDiff: "major" } },
        { name: "dockge", updateAvailable: false, image: { name: "louislam/dockge", tag: { value: "1" } } },
        { name: "latest-app", updateAvailable: true, image: { name: "app/latest", tag: { value: "latest" } }, updateKind: { kind: "digest", remoteValue: "sha256:abcdef" } },
      ]);
    }

    // ───────────── Watchtower ─────────────
    if (p === "/wt/v1/metrics") {
      if (req.headers.authorization !== `Bearer ${MORE.wtToken}`) return text(401, "Unauthorized");
      return text(
        200,
        [
          "# HELP watchtower_containers_scanned Number of containers scanned for changes by watchtower during the last scan",
          "# TYPE watchtower_containers_scanned gauge",
          "watchtower_containers_scanned 24",
          "# TYPE watchtower_containers_updated gauge",
          "watchtower_containers_updated 2",
          "# TYPE watchtower_containers_failed gauge",
          "watchtower_containers_failed 1",
          "# TYPE watchtower_scans_total counter",
          "watchtower_scans_total 105",
          "watchtower_scans_skipped 3",
        ].join("\n") + "\n",
      );
    }
    if (p === "/wt-off/v1/metrics") return text(404, "not found");

    // ───────────── Gatus ─────────────
    if (p === "/gatus/api/v1/endpoints/statuses") {
      return json(200, [
        { name: "Jellyfin", group: "media", key: "media_jellyfin", results: [{ status: 200, success: true, duration: 24_000_000 }, { status: 200, success: true, duration: 25_000_000 }] },
        { name: "Router", group: "red", key: "red_router", results: [{ success: true, duration: 3_000_000 }, { success: false, duration: 0 }] },
        { name: "Vacío", group: "", key: "_vacio", results: [] },
      ]);
    }

    // ───────────── Healthchecks ─────────────
    if (p === "/hc/api/v3/checks/") {
      if (req.headers["x-api-key"] !== MORE.hcKey) return json(401, { error: "wrong api key" });
      const all = [
        { name: "Backup diario", slug: "backup", status: "up", last_ping: isoAgo(120), tags: "backup" },
        { name: "Rsync a la nube", slug: "rsync", status: "down", last_ping: isoAgo(60 * 30), tags: "backup" },
        { name: "Script de limpieza", slug: "limpieza", status: "grace", last_ping: isoAgo(60 * 25), tags: "" },
        { name: "Pausado", slug: "pausa", status: "paused", last_ping: null, tags: "" },
      ];
      const tag = url.searchParams.get("tag");
      return json(200, { checks: tag ? all.filter((c) => c.tags.split(" ").includes(tag)) : all });
    }

    // ───────────── Netdata ─────────────
    const nd = /^\/(netdata|netdata-nochart)(\/api\/v1\/.+)$/.exec(p);
    if (nd) {
      if (nd[2] === "/api/v1/info") return json(200, { version: "v1.45.0", alarms: { normal: 20, warning: 2, critical: 1 } });
      if (nd[1] === "netdata-nochart") return json(500, {});
      const chart = url.searchParams.get("chart");
      const t = Math.floor(Date.now() / 1000);
      if (chart === "system.cpu") {
        return json(200, {
          labels: ["time", "guest_nice", "guest", "steal", "softirq", "irq", "user", "system", "nice", "iowait"],
          data: [
            [t, 0, 7, 0, 1, 0, 20, 10, 0, 0], // 31 % (el «guest» no se suma)
            [t - 20, 0, 0, 0, 0, 0, 10, 5, 0, 0], // 15 %
            [t - 40, 0, 0, 0, 0, 0, 3, 2, 0, 0], // 5 %
          ],
        });
      }
      if (chart === "system.ram") {
        return json(200, {
          labels: ["time", "free", "used", "cached", "buffers"],
          data: [
            [t, 4000, 8000, 3000, 1000], // 50 %
            [t - 20, 6000, 6000, 3000, 1000], // 37.5 %
            [t - 40, 7000, 4000, 4000, 1000], // 25 %
          ],
        });
      }
      return json(404, {});
    }

    // ───────────── Beszel (PocketBase) ─────────────
    const bz = /^\/(beszel|beszel-admin)(\/api\/.+)$/.exec(p);
    if (bz) {
      const admin = bz[1] === "beszel-admin";
      if (req.method === "POST") {
        const { identity, password } = JSON.parse(await readBody(req));
        const good = identity === MORE.beszelUser && password === MORE.beszelPass;
        const path = bz[2];
        if (path === "/api/collections/users/auth-with-password") {
          if (admin) return json(404, {});
          counts.beszelLogins++;
          return good ? json(200, { token: "pb-token-1" }) : json(400, { message: "Failed to authenticate." });
        }
        if (path === "/api/collections/_superusers/auth-with-password") return json(404, {});
        if (path === "/api/admins/auth-with-password") {
          counts.beszelLogins++;
          return good ? json(200, { token: "pb-token-1" }) : json(400, { message: "Failed to authenticate." });
        }
        return json(404, {});
      }
      if (bz[2] === "/api/collections/systems/records") {
        if (req.headers.authorization !== "pb-token-1") return json(401, { message: "The request requires valid record authorization token." });
        return json(200, {
          page: 1,
          items: [
            { name: "tower", status: "up", info: { cpu: 23.4, mp: 41.2, dp: 67.8, bb: 1000 } },
            { name: "nas2", status: "down", info: {} },
            { name: "pi", status: "up", info: { cpu: 95, mp: 30, dp: 10 } },
          ],
        });
      }
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
  const m = await startMockMore(Number(process.env.MOCK_PORT ?? 8778));
  console.log(`Servicios simulados (tanda 2) en ${m.url}`);
  console.log("  /sonarr /radarr /lidarr /prowlarr /bazarr /paperless /peanut /ha /nc /npm /wud /wt /gatus /hc /netdata /beszel");
}
