import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

/** Credenciales de los servicios simulados (tercera tanda de integraciones). */
export const LAST = {
  stKey: "syncthing-api-key-1234567890",
  absToken: "abs-api-token-abcdefghijklmnop",
  navUser: "navuser",
  navPass: "nav-pass-123",
  kavUser: "kavita",
  kavPass: "kavita-pass-123",
  kavApiKey: "kavita-opds-key-123456",
  komgaKey: "komga-api-key-1234567890",
  komgaUser: "komga",
  komgaPass: "komga-pass-123",
  mealieToken: "mealie-api-token-abcdefghijklmnop",
  kkKey: "karakeep-key-1234567890",
  lwToken: "linkwarden-token-123456",
  dupPass: "dup-pass-123",
  kopiaUser: "kopia",
  kopiaPass: "kopia-pass-123",
  backrestUser: "backrest",
  backrestPass: "backrest-pass-123",
  sabKey: "0123456789abcdef0123456789abcdef",
  nzbUser: "nzbget",
  nzbPass: "nzb-pass-123",
  delugePass: "deluge-pass-123",
  traefikUser: "traefik",
  traefikPass: "traefik-pass-123",
  gotifyClient: "gotify-client-token-123",
  gotifyApp: "gotify-app-token-456",
  ntfyToken: "ntfy-access-token-123",
  cfToken: "cf-api-token-abcdefghijklmnop",
  cfAccount: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  cfTunnel: "11111111-2222-3333-4444-555555555555",
  cfTunnelDegraded: "99999999-2222-3333-4444-555555555555",
};

export interface MockLast {
  url: string;
  counts: { kavitaLogins: number; dupLogins: number; delugeLogins: number; delugeExpireNext: boolean; navSalts: string[] };
  close(): Promise<void>;
}

const isoAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const dupDate = (min: number) => new Date(Date.now() - min * 60_000).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

export async function startMockLast(port = 0): Promise<MockLast> {
  const counts: MockLast["counts"] = { kavitaLogins: 0, dupLogins: 0, delugeLogins: 0, delugeExpireNext: false, navSalts: [] };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const text = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(body);
    };
    const bearer = (t: string) => req.headers.authorization === `Bearer ${t}`;
    const auth = req.headers.authorization;

    // ───────────── Syncthing ─────────────
    if (p.startsWith("/st/rest/")) {
      if (req.headers["x-api-key"] !== LAST.stKey) return text(403, "CSRF Error");
      const r = p.slice("/st/rest/".length);
      if (r === "system/status") return json(200, { myID: "AAAAAAA-BBBBBBB", uptime: 7200 });
      if (r === "system/config") {
        return json(200, {
          folders: [
            { id: "docs", label: "Documentos", paused: false },
            { id: "fotos", label: "Fotos", paused: false },
            { id: "vieja", label: "Vieja", paused: true },
            { id: "sync", label: "Sincronizando", paused: false },
            { id: "err", label: "Con error", paused: false },
          ],
          devices: [
            { deviceID: "AAAAAAA-BBBBBBB", name: "tower" },
            { deviceID: "CCCCCCC-DDDDDDD", name: "portátil" },
            { deviceID: "EEEEEEE-FFFFFFF", name: "móvil" },
            { deviceID: "GGGGGGG-HHHHHHH", name: "viejo", paused: true },
          ],
        });
      }
      if (r === "system/connections") {
        return json(200, { connections: { "CCCCCCC-DDDDDDD": { connected: true }, "EEEEEEE-FFFFFFF": { connected: false, lastSeen: isoAgo(180) }, "GGGGGGG-HHHHHHH": { connected: false } } });
      }
      if (r === "system/error") return json(200, { errors: [{ when: isoAgo(5), message: "algo falló" }] });
      if (r === "db/status") {
        const f = url.searchParams.get("folder");
        const base = { globalBytes: 1e9, globalFiles: 100, needBytes: 0, errors: 0, pullErrors: 0 };
        if (f === "docs") return json(200, { ...base, state: "idle" });
        if (f === "fotos") return json(200, { ...base, state: "scanning" });
        if (f === "sync") return json(200, { ...base, state: "syncing", needBytes: 5e8 });
        if (f === "err") return json(200, { ...base, state: "idle", pullErrors: 2 });
      }
      return json(404, {});
    }

    // ───────────── Audiobookshelf ─────────────
    const abs = /^\/(abs|abs-user)(\/api\/.+)$/.exec(p);
    if (abs) {
      if (!bearer(LAST.absToken)) return json(401, { error: "Unauthorized" });
      switch (abs[2]) {
        case "/api/libraries":
          return json(200, { libraries: [{ id: "l1", name: "Audiolibros", mediaType: "book" }, { id: "l2", name: "Podcasts", mediaType: "podcast" }] });
        case "/api/libraries/l1/stats":
          return json(200, { totalItems: 120, totalAuthors: 40, totalDuration: 3600 * 500, totalSize: 5 * 1024 ** 3 });
        case "/api/libraries/l2/stats":
          return json(200, { totalItems: 30, totalAuthors: 5, totalDuration: 3600 * 50, totalSize: 2 * 1024 ** 3 });
        case "/api/users/online":
          if (abs[1] === "abs-user") return json(403, { error: "forbidden" });
          return json(200, { usersOnline: [{ username: "sebas", session: { displayTitle: "Proyecto Hail Mary", displayAuthor: "Andy Weir" } }] });
      }
      return json(404, {});
    }

    // ───────────── Navidrome (Subsonic) ─────────────
    const nav = /^\/(nav|nav-single|nav-empty)\/rest\/(.+)$/.exec(p);
    if (nav) {
      const u = url.searchParams.get("u");
      const s = url.searchParams.get("s") ?? "";
      counts.navSalts.push(s);
      const ok = u === LAST.navUser && url.searchParams.get("t") === md5(LAST.navPass + s) && url.searchParams.get("f") === "json";
      const sub = (body: object) => json(200, { "subsonic-response": { status: "ok", version: "1.16.1", ...body } });
      if (!ok) return json(200, { "subsonic-response": { status: "failed", version: "1.16.1", error: { code: 40, message: "Wrong username or password" } } });
      switch (nav[2]) {
        case "ping":
          return sub({});
        case "getNowPlaying":
          if (nav[1] === "nav-empty") return sub({ nowPlaying: {} });
          if (nav[1] === "nav-single") return sub({ nowPlaying: { entry: { title: "Solo uno", artist: "Artista", username: "ana", playerName: "Web", minutesAgo: 0 } } });
          return sub({
            nowPlaying: {
              entry: [
                { title: "Karma Police", artist: "Radiohead", username: "ana", playerName: "Feishin", minutesAgo: 0 },
                { title: "Roads", artist: "Portishead", username: "luis", playerName: "DSub", minutesAgo: 5 },
              ],
            },
          });
        case "getAlbumList2":
          return sub({ albumList2: { album: [{ name: "OK Computer", artist: "Radiohead", year: 1997 }, { name: "Dummy", artist: "Portishead", year: 1994 }] } });
        case "getScanStatus":
          return sub({ scanStatus: { scanning: false, count: 12345 } });
      }
      return json(404, {});
    }

    // ───────────── Kavita ─────────────
    const kav = /^\/(kav|kav-old)(\/api\/.+)$/.exec(p);
    if (kav) {
      if (kav[2] === "/api/Account/login" && req.method === "POST") {
        counts.kavitaLogins++;
        const b = JSON.parse(await readBody(req));
        const ok = (b.username === LAST.kavUser && b.password === LAST.kavPass) || (!b.username && b.apiKey === LAST.kavApiKey);
        return ok ? json(200, { token: "kav-jwt-1" }) : json(401, { message: "Invalid username or password" });
      }
      if (!bearer("kav-jwt-1")) return json(401, {});
      if (kav[2] === "/api/Stats/server/stats") return json(200, { seriesCount: 250, volumeCount: 900, chapterCount: 5000, totalFiles: 5400, totalSize: 3 * 1024 ** 4 });
      if (kav[2] === "/api/Series/recently-added-v2") {
        if (kav[1] === "kav-old") return json(404, {});
        return json(200, [{ name: "Berserk", libraryName: "Manga", created: isoAgo(120) }]);
      }
      return json(404, {});
    }

    // ───────────── Komga ─────────────
    const kg = /^\/(komga|komga2)(\/api\/v1\/.+)$/.exec(p);
    if (kg) {
      const okAuth = req.headers["x-api-key"] === LAST.komgaKey || auth === basic(LAST.komgaUser, LAST.komgaPass);
      if (!okAuth) return json(401, {});
      const v2 = kg[1] === "komga2";
      switch (`${req.method} ${kg[2]}`) {
        case "GET /api/v1/libraries":
          return json(200, [{ id: "1", name: "Manga" }, { id: "2", name: "Cómics" }]);
        case "GET /api/v1/series":
          return v2 ? json(404, {}) : json(200, { totalElements: 300, content: [] });
        case "GET /api/v1/books":
          return v2 ? json(404, {}) : json(200, { totalElements: 4500, content: [] });
        case "POST /api/v1/series/list":
          return v2 ? json(200, { totalElements: 301 }) : json(404, {});
        case "POST /api/v1/books/list":
          return v2 ? json(200, { totalElements: 4501 }) : json(404, {});
        case "GET /api/v1/series/latest":
          return json(200, { content: [{ metadata: { title: "One Piece" }, booksCount: 105, lastModified: isoAgo(180) }] });
      }
      return json(404, {});
    }

    // ───────────── Mealie ─────────────
    const me = /^\/(mealie|mealie-v1)(\/api\/.+)$/.exec(p);
    if (me) {
      if (!bearer(LAST.mealieToken)) return json(401, { detail: "Unauthorized" });
      const v1 = me[1] === "mealie-v1";
      const stats = { totalRecipes: 321, totalUsers: 3, totalCategories: 12, totalTags: 40, totalTools: 5 };
      const today = new Date();
      const tomorrow = new Date(today.getTime() + 86400_000);
      const plan = {
        items: [
          { date: ymd(tomorrow), entryType: "lunch", title: "", recipe: { name: "Ensalada" } },
          { date: ymd(today), entryType: "dinner", title: "", recipe: { name: "Lasaña" } },
          { date: ymd(today), entryType: "breakfast", title: "Tostadas", recipe: null },
        ],
      };
      if (me[2] === (v1 ? "/api/groups/statistics" : "/api/households/statistics")) return json(200, stats);
      if (me[2] === (v1 ? "/api/groups/mealplans" : "/api/households/mealplans")) return json(200, plan);
      return json(404, {});
    }

    // ───────────── Karakeep ─────────────
    if (p.startsWith("/kk/api/v1/")) {
      if (!bearer(LAST.kkKey)) return json(401, {});
      if (p === "/kk/api/v1/users/me/stats") return json(200, { numBookmarks: 850, numFavorites: 42, numArchived: 10, numTags: 77, numLists: 6, numHighlights: 3 });
      if (p === "/kk/api/v1/bookmarks") {
        return json(200, {
          bookmarks: [
            { id: "1", title: null, createdAt: isoAgo(60), content: { type: "link", url: "https://example.com/articulo", title: "Un artículo" }, tags: [{ name: "lectura" }, { name: "tech" }] },
            { id: "2", title: "Nota mía", createdAt: isoAgo(600), content: { type: "text", text: "hola" }, tags: [] },
            { id: "3", title: null, createdAt: isoAgo(6000), content: { type: "link", url: "javascript:alert(1)", title: "Peligro" }, tags: [] },
          ],
        });
      }
      return json(404, {});
    }

    // ───────────── Linkwarden ─────────────
    if (p.startsWith("/lw/api/v1/")) {
      if (!bearer(LAST.lwToken)) return json(401, {});
      if (p === "/lw/api/v1/collections") {
        return json(200, { response: [{ id: 2, name: "Recetas", _count: { links: 1 } }, { id: 1, name: "Trabajo", description: "Cosas del curro", _count: { links: 30 } }, { id: 3, name: "Vacía", _count: { links: 0 } }] });
      }
      if (p === "/lw/api/v1/tags") return json(200, { response: [{ id: 1 }, { id: 2 }, { id: 3 }] });
      return json(404, {});
    }

    // ───────────── Duplicati ─────────────
    const dup = /^\/(dup|dup-running)(\/api\/v1\/.+)$/.exec(p);
    if (dup) {
      if (dup[2] === "/api/v1/auth/login" && req.method === "POST") {
        counts.dupLogins++;
        const b = JSON.parse(await readBody(req));
        return b.Password === LAST.dupPass ? json(200, { AccessToken: "dup-jwt-1" }) : json(401, { Error: "Invalid password" });
      }
      if (!bearer("dup-jwt-1")) return json(401, {});
      const running = dup[1] === "dup-running";
      switch (dup[2]) {
        case "/api/v1/backups":
          return json(200, [
            { Backup: { ID: "1", Name: "Documentos", Metadata: { LastBackupFinished: dupDate(120), TargetFilesSize: "5000000000" } }, Schedule: { Time: new Date(Date.now() + 6 * 3600_000).toISOString() } },
            { Backup: { ID: "2", Name: "Fotos", Metadata: { LastBackupFinished: dupDate(100 * 60) } } },
            { Backup: { ID: "3", Name: "Con error", Metadata: { LastBackupFinished: dupDate(300) } } },
            { Backup: { ID: "4", Name: "Nueva", Metadata: {} } },
          ]);
        case "/api/v1/serverstate":
          return json(200, running ? { ActiveTask: { Item1: 1 } } : { ActiveTask: null });
        case "/api/v1/notifications":
          return json(200, [{ BackupID: "3", Type: "Error", Title: "x" }, { BackupID: "2", Type: "Warning" }, { Type: "Error" }]);
        case "/api/v1/progressstate":
          return running ? json(200, { BackupID: "1" }) : json(404, {});
      }
      return json(404, {});
    }

    // ───────────── Kopia ─────────────
    if (p === "/kopia/api/v1/sources") {
      if (auth !== basic(LAST.kopiaUser, LAST.kopiaPass)) return json(401, {});
      const snap = (minAgo: number, errors = 0, size = 2e10) => ({ startTime: isoAgo(minAgo), endTime: isoAgo(minAgo - 1), stats: { totalSize: size, errorCount: errors } });
      return json(200, {
        sources: [
          { source: { host: "tower", userName: "root", path: "/mnt/user/docs" }, status: "IDLE", lastSnapshot: snap(180) },
          { source: { host: "tower", userName: "root", path: "/mnt/user/fotos" }, status: "IDLE", lastSnapshot: snap(100 * 60, 0, 1e11) },
          { source: { host: "tower", userName: "root", path: "/mnt/user/err" }, status: "IDLE", lastSnapshot: snap(60, 3, 1) },
          { source: { host: "tower", userName: "root", path: "/mnt/user/subiendo" }, status: "UPLOADING", lastSnapshot: snap(120) },
          { source: { host: "tower", userName: "root", path: "/mnt/user/nunca" }, status: "IDLE" },
        ],
        multiUser: false,
      });
    }

    // ───────────── Backrest ─────────────
    const br = /^\/(backrest|backrest-auth)\/v1\.Backrest\/GetSummaryDashboard$/.exec(p);
    if (br && req.method === "POST") {
      if (br[1] === "backrest-auth" && auth !== basic(LAST.backrestUser, LAST.backrestPass)) return text(401, "Unauthorized");
      if (req.headers["content-type"] !== "application/json" || (await readBody(req)) !== "{}") return json(400, { code: "invalid_argument" });
      const ts = (minAgo: number) => String(Date.now() - minAgo * 60_000);
      return json(200, {
        planSummaries: [
          { id: "documentos", backupsFailed30days: "0", backupsSuccessLast30days: "28", bytesAddedLast30days: "1073741824", recentBackups: { status: ["STATUS_SUCCESS", "STATUS_SUCCESS"], timestampMs: [ts(180), ts(1620)] } },
          { id: "fotos", backupsFailed30days: "2", backupsSuccessLast30days: "20", bytesAddedLast30days: "0", recentBackups: { status: ["STATUS_ERROR"], timestampMs: [ts(60)] } },
          { id: "nueva", recentBackups: { status: [] } },
          { id: "avisos", backupsFailed30days: "1", backupsSuccessLast30days: "10", recentBackups: { status: ["STATUS_SUCCESS"], timestampMs: [ts(240)] } },
        ],
      });
    }

    // ───────────── SABnzbd ─────────────
    if (p === "/sab/api") {
      if (url.searchParams.get("apikey") !== LAST.sabKey) return json(200, { status: false, error: "API Key Incorrect" });
      if (url.searchParams.get("mode") === "queue" && url.searchParams.get("output") === "json") {
        return json(200, {
          queue: {
            status: "Downloading",
            speed: "5.2 M",
            kbpersec: "5324.8",
            noofslots: 3,
            mbleft: "2048.0",
            timeleft: "0:06:30",
            slots: [
              { filename: "Pelicula.2024", percentage: "42", cat: "movies", status: "Downloading", timeleft: "0:03:00" },
              { filename: "Serie.S01", percentage: "0", cat: "tv", status: "Paused", timeleft: "0:00:00" },
            ],
          },
        });
      }
      return json(200, { error: "not implemented" });
    }

    // ───────────── NZBGet ─────────────
    const nzb = /^\/nzb\/jsonrpc\/(status|listgroups)$/.exec(p);
    if (nzb) {
      if (auth !== basic(LAST.nzbUser, LAST.nzbPass)) return text(401, "Unauthorized");
      if (nzb[1] === "status") return json(200, { version: "1.1", result: { DownloadRate: 3 * 1024 * 1024, RemainingSizeMB: 2048, DownloadedSizeMB: 4096, DownloadPaused: false, ServerPaused: false } });
      return json(200, {
        version: "1.1",
        result: [
          { NZBName: "Peli", FileSizeMB: 1000, RemainingSizeMB: 500, Category: "Movies", Status: "DOWNLOADING" },
          { NZBName: "Pausada", FileSizeMB: 100, RemainingSizeMB: 100, Category: "", Status: "PAUSED" },
        ],
      });
    }

    // ───────────── Deluge ─────────────
    const dl = /^\/(deluge|deluge-off)\/json$/.exec(p);
    if (dl && req.method === "POST") {
      const { method, params } = JSON.parse(await readBody(req));
      if (method === "auth.login") {
        counts.delugeLogins++;
        if (params[0] !== LAST.delugePass) return json(200, { result: false, error: null, id: 1 });
        return json(200, { result: true, error: null, id: 1 }, { "set-cookie": "_session_id=dsess1; Expires=Wed, 01 Jan 2030 00:00:00 GMT; Path=/; HttpOnly" });
      }
      if (method === "web.update_ui") {
        const expired = counts.delugeExpireNext;
        counts.delugeExpireNext = false;
        if (expired || !/_session_id=dsess1/.test(req.headers.cookie ?? "")) return json(200, { result: null, error: { code: 1, message: "Not authenticated" }, id: 1 });
        if (dl[1] === "deluge-off") return json(200, { result: { connected: false }, error: null, id: 1 });
        return json(200, {
          result: {
            connected: true,
            stats: { download_rate: 2 * 1024 * 1024, upload_rate: 102400 },
            torrents: {
              a: { name: "debian", state: "Downloading", progress: 75.5, download_payload_rate: 2097152, upload_payload_rate: 0, eta: 600 },
              b: { name: "seed", state: "Seeding", progress: 100, download_payload_rate: 0, upload_payload_rate: 102400, eta: 0 },
              c: { name: "parado", state: "Paused", progress: 10, download_payload_rate: 0, upload_payload_rate: 0, eta: 0 },
            },
          },
          error: null,
          id: 1,
        });
      }
      return json(200, { result: null, error: { code: 2, message: "unknown" }, id: 1 });
    }

    // ───────────── Traefik ─────────────
    const tf = /^\/(traefik|traefik-auth)(\/api\/.+)$/.exec(p);
    if (tf) {
      if (tf[1] === "traefik-auth" && auth !== basic(LAST.traefikUser, LAST.traefikPass)) return text(401, "Unauthorized");
      if (tf[2] === "/api/overview") {
        return json(200, { http: { routers: { total: 12, warnings: 1, errors: 2 }, services: { total: 10, warnings: 0, errors: 0 }, middlewares: { total: 5, warnings: 0, errors: 0 } } });
      }
      if (tf[2] === "/api/http/routers") {
        return json(200, [
          { name: "a@docker", rule: "Host(`a.casa.lan`)", status: "enabled" },
          { name: "roto@docker", rule: "Host(`roto.casa.lan`)", status: "disabled" },
          { name: "aviso@docker", rule: "Host(`aviso.casa.lan`)", status: "warning" },
        ]);
      }
      return json(404, {});
    }

    // ───────────── Caddy ─────────────
    if (p === "/caddy/reverse_proxy/upstreams") {
      return json(200, [
        { address: "192.168.1.10:8096", num_requests: 2, fails: 0 },
        { address: "192.168.1.11:80", num_requests: 0, fails: 3 },
        { address: "x:1", num_requests: 1, fails: 0 },
      ]);
    }
    if (p === "/caddy-denied/reverse_proxy/upstreams") return text(403, "client is not allowed to access from origin");

    // ───────────── Gotify ─────────────
    if (p.startsWith("/gotify/")) {
      if (req.headers["x-gotify-key"] !== LAST.gotifyClient) return json(401, { error: "Unauthorized" });
      if (p === "/gotify/application") return json(200, [{ id: 1, name: "Backups" }, { id: 2, name: "Watchtower" }]);
      if (p === "/gotify/message") {
        return json(200, {
          messages: [
            { id: 3, appid: 2, title: "Actualizado", message: "jellyfin actualizado", priority: 5, date: isoAgo(10) },
            { id: 2, appid: 1, title: "", message: "Backup falló", priority: 9, date: isoAgo(120) },
            { id: 1, appid: 1, title: "Backup ok", message: "todo bien", priority: 2, date: isoAgo(1440) },
          ],
          paging: { size: 3 },
        });
      }
      return json(404, {});
    }

    // ───────────── ntfy ─────────────
    if (p === "/ntfy/v1/health") return json(200, { healthy: true });
    const nt = /^\/ntfy\/([A-Za-z0-9_,-]+)\/json$/.exec(p);
    if (nt) {
      if (nt[1] === "privado" && !bearer(LAST.ntfyToken)) return json(403, { code: 40301, error: "forbidden" });
      const now = Math.floor(Date.now() / 1000);
      const lines = [
        { id: "o", time: now - 7200, event: "open", topic: "alertas" },
        { id: "a", time: now - 60, event: "message", topic: "alertas", message: "Disco lleno", title: "Alerta", priority: 5, tags: ["warning"] },
        { id: "b", time: now - 3600, event: "message", topic: "casa", message: "Puerta abierta", priority: 4 },
        { id: "c", time: now - 5000, event: "message", topic: "alertas", message: "Hola mundo" },
        { id: "k", time: now, event: "keepalive", topic: "alertas" },
      ];
      const topics = nt[1]!.split(",");
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      return res.end(lines.filter((l) => topics.includes(l.topic)).map((l) => JSON.stringify(l)).join("\n") + "\n");
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
  const m = await startMockLast(Number(process.env.MOCK_PORT ?? 8779));
  console.log(`Servicios simulados (tanda 3) en ${m.url}`);
  console.log("  /st /abs /nav /kav /komga /mealie /kk /lw /dup /kopia /backrest /sab /nzb /deluge /traefik /caddy /gotify /ntfy");
}
