import { crc32, deflateSync } from "node:zlib";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

export const MOCK_API_KEY = "test-api-key-1234567890";

/** PNG de color (degradado) sin dependencias: suficiente para probar carátulas. */
export function makePng(w: number, h: number, hue: number): Buffer {
  const hsl = (y: number): [number, number, number] => {
    const l = 0.55 - (y / h) * 0.3;
    const a = 0.5 * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + hue / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const [r, g, b] = hsl(y);
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const id = (n: number) => n.toString(16).padStart(32, "0");
export const IDS = {
  dune: id(1), severance: id(2), episode: id(3), noImage: id(4), htmlImage: id(5), arcane: id(6),
  // Bibliotecas y un título que solo existe dentro de «Anime».
  libMovies: id(0x101), libSeries: id(0x102), libAnime: id(0x103), frieren: id(7),
};

const LIBRARIES = [
  { Id: IDS.libMovies, Name: "Películas", CollectionType: "movies" },
  { Id: IDS.libSeries, Name: "Series", CollectionType: "tvshows" },
  { Id: IDS.libAnime, Name: "Anime", CollectionType: "tvshows" },
];

const SESSIONS = [
  {
    UserName: "sebas",
    Client: "Jellyfin Web",
    DeviceName: "Chrome",
    NowPlayingItem: {
      Type: "Episode", Name: "Hello, Ms. Cobel", SeriesName: "Severance", ParentIndexNumber: 1, IndexNumber: 3,
      RunTimeTicks: 36_000_000_000,
    },
    PlayState: { PositionTicks: 9_000_000_000, IsPaused: false, PlayMethod: "DirectPlay" },
  },
  {
    UserName: "ana",
    Client: "Android TV",
    DeviceName: "Sala",
    NowPlayingItem: { Type: "Movie", Name: "Dune", ProductionYear: 2021, RunTimeTicks: 90_000_000_000 },
    PlayState: { PositionTicks: 45_000_000_000, IsPaused: true, PlayMethod: "Transcode" },
  },
  { UserName: "invitado", Client: "Web", DeviceName: "Firefox" }, // conectado, sin reproducir
];

// `Lib` y `Genres` solo los usa el simulador para filtrar por ParentId y Genres; el Anime solo aparece al pedir esa biblioteca.
const ITEMS: Record<string, any>[] = [
  { Id: IDS.dune, Name: "Dune", Type: "Movie", ProductionYear: 2021, ImageTags: { Primary: "a" }, Lib: IDS.libMovies, Genres: ["Ciencia ficción"] },
  { Id: IDS.severance, Name: "Severance", Type: "Series", ProductionYear: 2022, ImageTags: { Primary: "b" }, Lib: IDS.libSeries, Genres: ["Drama"] },
  { Id: IDS.arcane, Name: "Arcane", Type: "Series", ProductionYear: 2021, ImageTags: { Primary: "c" }, Lib: IDS.libSeries, Genres: ["Animation"] },
  { Id: IDS.noImage, Name: "Película sin carátula", Type: "Movie", ProductionYear: 1999, Lib: IDS.libMovies, Genres: [] },
  { Id: IDS.htmlImage, Name: "Carátula rota", Type: "Movie", ProductionYear: 2005, ImageTags: { Primary: "d" }, Lib: IDS.libMovies, Genres: [] },
  {
    Id: IDS.episode, Name: "Piloto", Type: "Episode", SeriesName: "Fallout", SeriesId: IDS.arcane,
    ParentIndexNumber: 1, IndexNumber: 1, ProductionYear: 2024,
  },
  { Id: IDS.frieren, Name: "Frieren", Type: "Series", ProductionYear: 2023, ImageTags: { Primary: "e" }, Lib: IDS.libAnime, Genres: ["Anime"], OnlyInLibrary: true },
];

export interface MockJellyfin {
  url: string;
  requests: { path: string; auth: string | undefined }[];
  close(): Promise<void>;
}

export async function startMockJellyfin(port = 0): Promise<MockJellyfin> {
  const requests: MockJellyfin["requests"] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const auth = req.headers.authorization;
    requests.push({ path: url.pathname + url.search, auth });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/System/Info/Public") return json(200, { ServerName: "Casa", Version: "10.10.3" });

    // Todo lo demás exige la API key en el formato oficial.
    if (!auth?.includes(`Token="${MOCK_API_KEY}"`)) return json(401, { error: "unauthorized" });

    if (url.pathname === "/Sessions") return json(200, SESSIONS);
    if (url.pathname === "/Items/Counts") {
      return json(200, { MovieCount: 1234, SeriesCount: 87, EpisodeCount: 5421, SongCount: 0, AlbumCount: 0, BoxSetCount: 12 });
    }
    if (url.pathname === "/Library/MediaFolders") return json(200, { Items: LIBRARIES, TotalRecordCount: LIBRARIES.length });
    if (url.pathname === "/Items") {
      const types = (url.searchParams.get("IncludeItemTypes") ?? "").split(",");
      const limit = Number(url.searchParams.get("Limit") ?? 10);
      const parent = url.searchParams.get("ParentId");
      const genre = url.searchParams.get("Genres");
      const found = ITEMS.filter(
        (i) => types.includes(i.Type) && (parent ? i.Lib === parent : !i.OnlyInLibrary) && (!genre || i.Genres?.includes(genre)),
      );
      return json(200, { Items: found.slice(0, limit), TotalRecordCount: found.length });
    }
    const img = /^\/Items\/([a-f0-9]+)\/Images\/Primary$/.exec(url.pathname);
    if (img) {
      if (img[1] === IDS.htmlImage) {
        res.writeHead(200, { "content-type": "image/png" }); // miente: es HTML
        return res.end("<html><script>alert(1)</script></html>" + " ".repeat(40));
      }
      if (img[1] === IDS.noImage) return json(404, {});
      const body = makePng(80, 120, (parseInt(img[1]!, 16) * 70) % 360);
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(body);
    }
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      return res.end();
    }
    json(404, {});
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// Modo manual: `tsx tests/support/mock-jellyfin.ts` levanta el servidor simulado.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = await startMockJellyfin(Number(process.env.MOCK_PORT ?? 8096));
  console.log(`Jellyfin simulado en ${m.url}  (API key: ${MOCK_API_KEY})`);
}
