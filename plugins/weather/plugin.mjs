// Plugin de ejemplo: clima con Open-Meteo (https://open-meteo.com). No necesita API key.
// Sirve de plantilla: copia esta carpeta, cambia el `id` y empieza a editar.

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "weather",
  name: "Clima",
  version: "0.1.0",
  description: "Clima actual y pronóstico de 5 días (Open-Meteo, sin API key).",
  author: "Oblivion",
  permissions: {
    // Único lugar al que este plugin puede llamar.
    network: ["api.open-meteo.com", "geocoding-api.open-meteo.com"],
  },
  widgets: [
    {
      type: "current",
      name: "Clima",
      description: "Temperatura actual y próximos días para una ciudad.",
      icon: "⛅",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [
        { key: "location", label: "Ciudad", type: "string", required: true, placeholder: "Bogotá" },
        {
          key: "units",
          label: "Unidades",
          type: "select",
          default: "metric",
          options: [
            { value: "metric", label: "Métrico (°C, km/h)" },
            { value: "imperial", label: "Imperial (°F, mph)" },
          ],
        },
      ],

      async load(ctx) {
        const { location, units = "metric" } = ctx.config;
        const place = await geocode(ctx, String(location));
        const imperial = units === "imperial";

        const q = new URLSearchParams({
          latitude: String(place.latitude),
          longitude: String(place.longitude),
          current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
          daily: "weather_code,temperature_2m_max,temperature_2m_min",
          timezone: "auto",
          forecast_days: "6",
          temperature_unit: imperial ? "fahrenheit" : "celsius",
          wind_speed_unit: imperial ? "mph" : "kmh",
        });
        const res = await ctx.http(`https://api.open-meteo.com/v1/forecast?${q}`);
        if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
        const data = res.json();

        const deg = imperial ? "°F" : "°C";
        const cur = data.current;
        const [icon, label] = describe(cur.weather_code);

        const strip = data.daily.time.slice(1, 6).map((day, i) => {
          const j = i + 1;
          return {
            label: new Date(day + "T12:00:00").toLocaleDateString("es", { weekday: "short" }),
            icon: describe(data.daily.weather_code[j])[0],
            value: `${Math.round(data.daily.temperature_2m_max[j])}° / ${Math.round(data.daily.temperature_2m_min[j])}°`,
          };
        });

        return {
          kind: "metric",
          icon,
          value: String(Math.round(cur.temperature_2m)),
          unit: deg,
          caption: `${label} · ${place.name}`,
          rows: [
            { label: "Sensación", value: `${Math.round(cur.apparent_temperature)}${deg}` },
            { label: "Humedad", value: `${cur.relative_humidity_2m}%` },
            { label: "Viento", value: `${Math.round(cur.wind_speed_10m)} ${imperial ? "mph" : "km/h"}` },
          ],
          strip,
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

const geoCache = new Map();

async function geocode(ctx, name) {
  const key = name.toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);
  const q = new URLSearchParams({ name, count: "1", language: "es", format: "json" });
  const res = await ctx.http(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
  if (!res.ok) throw new Error(`Geocodificación respondió ${res.status}`);
  const hit = res.json().results?.[0];
  if (!hit) throw new Error(`No se encontró la ciudad «${name}»`);
  const place = { name: hit.name, latitude: hit.latitude, longitude: hit.longitude };
  geoCache.set(key, place);
  return place;
}

// Códigos WMO → [emoji, texto]
function describe(code) {
  if (code === 0) return ["☀️", "Despejado"];
  if (code === 1) return ["🌤️", "Mayormente despejado"];
  if (code === 2) return ["⛅", "Parcialmente nublado"];
  if (code === 3) return ["☁️", "Nublado"];
  if (code === 45 || code === 48) return ["🌫️", "Niebla"];
  if (code >= 51 && code <= 57) return ["🌦️", "Llovizna"];
  if (code >= 61 && code <= 67) return ["🌧️", "Lluvia"];
  if (code >= 71 && code <= 77) return ["🌨️", "Nieve"];
  if (code >= 80 && code <= 82) return ["🌧️", "Chubascos"];
  if (code === 85 || code === 86) return ["🌨️", "Chubascos de nieve"];
  if (code >= 95) return ["⛈️", "Tormenta"];
  return ["🌡️", "—"];
}
