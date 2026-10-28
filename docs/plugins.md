# Plugins

Un plugin es una carpeta con un archivo **`plugin.mjs`**. No hay paso de compilación: el servidor lo importa al arrancar. Los plugins incluidos (Jellyfin, Speedtest Tracker, Estado de servicios, Clima) están en [`plugins/`](../plugins) y sirven de ejemplo.

- [Instalar plugins propios](#instalar-plugins-propios)
- [Anatomía de un plugin](#anatomía-de-un-plugin)
- [Conexión compartida](#conexión-compartida)
- [Tipos de campo](#tipos-de-campo)
- [Qué puede hacer `load(ctx)`](#qué-puede-hacer-loadctx)
- [Qué devuelve: vistas declarativas](#qué-devuelve-vistas-declarativas)
- [Carátulas](#carátulas-media)
- [Probar un plugin sin el servicio real](#probar-un-plugin-sin-el-servicio-real)
- [Compartir un plugin](#compartir-un-plugin)
- [Confianza y seguridad](#confianza-y-seguridad)

## Instalar plugins propios

Cada plugin es una carpeta dentro de un directorio de plugins:

```
mis-plugins/
  mi-plugin/
    plugin.mjs
```

**Con Docker:** monta tu carpeta y añádela a `OBLIVION_PLUGINS_DIR` *sumándola* a los plugins incluidos (que viven en `/app/plugins`). En `docker-compose.yml`:

```yaml
    environment:
      OBLIVION_PLUGINS_DIR: /app/plugins:/plugins
    volumes:
      - ./mis-plugins:/plugins:ro
```

**Sin Docker:** deja la carpeta dentro de `plugins/` o apunta `OBLIVION_PLUGINS_DIR` a ella (varias, separadas por `:`).

Reinicia Oblivion (`docker compose restart`). El plugin aparece en **+ Widget**. Si un plugin tiene un error, se ignora y el motivo queda en el registro (`docker compose logs`); no impide arrancar.

## Anatomía de un plugin

La forma más rápida de empezar es copiar `plugins/weather/` (o `plugins/services/`) y cambiar el `id`.

```js
/** @type {import('@oblivion/sdk').PluginDefinition} */
export default {
  id: "mi-plugin",            // a-z, 0-9 y guiones; único
  name: "Mi plugin",
  version: "1.0.0",
  permissions: {
    network: ["api.ejemplo.com"],   // hosts fijos a los que puede llamar (opcional)
  },
  widgets: [
    {
      type: "estado",                // se identifica como "mi-plugin.estado"
      name: "Estado del servicio",
      description: "Muestra si el servicio responde.",
      icon: "🟢",
      defaultSize: { w: 3, h: 2 },   // la grilla tiene 12 columnas
      minSize: { w: 2, h: 2 },
      refreshSeconds: 30,
      config: [                      // el editor genera el formulario con esto
        { key: "url", label: "URL del servicio", type: "url", required: true },
        { key: "apiKey", label: "API key", type: "secret" },
      ],
      async load(ctx) {
        const res = await ctx.http(ctx.config.url + "/status", {
          headers: { "X-Api-Key": ctx.config.apiKey },
        });
        return {
          kind: "stats",
          items: [{ label: "Estado", value: res.ok ? "OK" : "Caído", tone: res.ok ? "good" : "bad" }],
        };
      },
    },
  ],
};
```

Los tipos están en [`packages/sdk/src/index.ts`](../packages/sdk/src/index.ts) (`@oblivion/sdk`); el comentario JSDoc de arriba te da autocompletado en tu editor.

## Conexión compartida

Si varios widgets de tu plugin hablan con el mismo servicio, no repitas la URL y la API key en cada uno: declara una **conexión** a nivel de plugin. El usuario la escribe una vez (en **Ajustes → Conexiones** o al añadir el primer widget) y cada widget solo elige cuál usar.

```js
export default {
  id: "mi-plugin",
  // ...
  connection: [                       // campos que se piden una sola vez
    { key: "url", label: "URL del servicio", type: "url", required: true },
    { key: "apiKey", label: "API key", type: "secret", required: true },
  ],
  widgets: [
    {
      type: "estado",
      // ...
      config: [],                     // aquí solo las opciones propias de este widget
      async load(ctx) {
        // ctx.config trae los campos de la conexión Y los del widget
        const res = await ctx.http(ctx.config.url + "/status", { headers: { "X-Api-Key": ctx.config.apiKey } });
        // ...
      },
    },
  ],
};
```

Las claves de `connection` no pueden repetirse en el `config` de ningún widget (el plugin se rechaza). La red sigue igual de restringida: `ctx.http` llega a los campos `url` de la conexión. Si tu plugin no declara `connection`, todo funciona como antes y cada widget guarda su configuración.

### Código compartido entre plugins

Un plugin puede importar módulos de otra carpeta con una ruta relativa. Los plugins de la familia *arr lo hacen con [`plugins/_shared/arr.mjs`](../plugins/_shared/arr.mjs) (`import { arrGet } from "../_shared/arr.mjs"`). Esa carpeta no tiene `plugin.mjs`, así que Oblivion no la carga como plugin.

### Probar la conexión

Si declaras `test(ctx)` a nivel de plugin, el formulario de la conexión muestra el botón **Probar conexión**. Recibe la conexión en `ctx.config` y devuelve un texto de éxito, o llama a `ctx.fail("motivo")`:

```js
async test(ctx) {
  const res = await ctx.http(ctx.config.url + "/status");
  if (!res.ok) ctx.fail("El servicio respondió con error " + res.status);
  return "Conectado";
},
```

### Enlace del título

Si el plugin tiene un campo `url` en su conexión, el título del widget abre esa dirección. Pon `openLink: false` en un widget cuando esa URL sea una API sin interfaz web (como el proxy de Docker).

## Tipos de campo

| `type` | Qué es |
|---|---|
| `string`, `text` | Texto corto / largo |
| `url` | URL **http(s)** validada (se rechaza `javascript:`, `data:`, etc.) |
| `number` | Número, con `min` y `max` opcionales |
| `boolean` | Casilla |
| `select` | Lista con `options: [{ value, label }]` |
| `secret` | API key o token. Se **cifra** al guardarse y **nunca** vuelve al navegador |
| `list` | Lista de elementos con `itemFields` (p. ej. la lista de servicios) |

Cada campo admite `label`, `required`, `default`, `placeholder` y `help`.

## Qué puede hacer `load(ctx)`

- **`ctx.config`**: la configuración del widget junto con la de su conexión (si el plugin la declara). Los `secret` llegan descifrados.
- **`ctx.http(url, init?)`**: **la única forma de salir a la red.** Devuelve `{ ok, status, headers, text, bytes, json() }`. Con `init.redirect = "manual"` no sigue redirecciones (útil para comprobar si un servicio responde).
  - Solo llega a los hosts de `permissions.network` y a las URLs que el usuario escribió en campos `url` de la conexión o del widget, incluidos los `url` dentro de campos `list`. Así un plugin de Jellyfin puede llamar a *el Jellyfin que tú configuraste* y a nada más.
  - Tiene timeout (8 s), tope de respuesta (2 MB), revalida las redirecciones y bloquea siempre direcciones de metadatos cloud / link-local.
  - Si no se puede conectar, el usuario ve «No se pudo conectar con host:puerto» sin que hagas nada.
- **`ctx.fail("mensaje")`**: termina con un error **cuyo mensaje sí se muestra** (p. ej. «Jellyfin rechazó la API key»). Cualquier otro error se oculta tras «No se pudo obtener la información» para no filtrar detalles internos; el detalle queda en el registro.
- **`ctx.log(msg)`**: escribe en el registro del servidor.

El resultado se cachea `refreshSeconds` (mín. 5 s) y no hay dos llamadas simultáneas para el mismo widget.

## Qué devuelve: vistas declarativas

Los plugins **no** envían HTML ni JavaScript al navegador. Devuelven una *vista* y Oblivion la dibuja (todo como texto, escapado):

| `kind` | Uso |
|---|---|
| `metric` | Un valor grande + detalle (`rows`) + tira de pronóstico (`strip`) |
| `stats` | Cuadrícula de cifras (`items: [{ label, value, hint?, tone? }]`) |
| `list` | Filas con título, subtítulo, valor a la derecha y barra de progreso opcional; cada fila puede llevar un `href` (solo `http(s)`) para que el título abra un enlace |
| `media` | Cuadrícula de carátulas (`items: [{ title, subtitle?, image?, badge?, progress? }]`) |
| `message` | Un texto (avisos, errores) |
| `chart` | Gráfica de líneas: `{ unit?, labels?, series: [{ name, points: number[] }], caption? }` (de antiguo a reciente; hasta 4 series de 200 puntos) |
| `sections` | Varias de las vistas anteriores apiladas, cada una con su título (`sections: [{ title?, view }]`, máx. 6, sin anidar). Sirve para un panel que combina varias cosas; si una sección falla, devuelve un `message` en su lugar. |

`tone` puede ser `neutral`, `good`, `warn` o `bad`. Si la vista no cumple el esquema, el widget muestra un error y el detalle queda en el registro.

## Carátulas (`media`)

Un plugin **no** devuelve URLs de imágenes: devuelve una *clave opaca* (`[A-Za-z0-9._~-]`, máx. 100 caracteres) y el widget declara `image(ctx, key)`, que devuelve `{ bytes }`. El navegador pide la imagen a Oblivion (`/api/widgets/<id>/image/<clave>`) y el servidor llama al plugin. Así el navegador nunca contacta con tu servicio ni ve su API key. El servidor comprueba que el resultado sea de verdad JPEG/PNG/WebP/AVIF (máx. 3 MB); si no, responde 404 y el widget muestra una inicial en su lugar.

```js
{
  type: "latest",
  // ...
  async load(ctx) {
    return { kind: "media", items: [{ title: "Dune", badge: "2021", image: "a1b2c3" }] };
  },
  async image(ctx, key) {
    const res = await ctx.http(`${ctx.config.url}/imagenes/${key}.jpg`);
    if (!res.ok) ctx.fail("Sin imagen");
    return { bytes: res.bytes };
  },
}
```

## Probar un plugin sin el servicio real

En [`apps/server/tests/support/`](../apps/server/tests/support) hay servidores simulados (`mock-jellyfin.ts`, `mock-homelab.ts`, `mock-stack.ts` con Glances, qBittorrent, Docker, Pi-hole y más) que levantan un HTTP local con la forma de la API, incluidas carátulas PNG generadas. Los tests de los plugins incluidos los usan de punta a punta ([`jellyfin.test.ts`](../apps/server/tests/jellyfin.test.ts), [`homelab.test.ts`](../apps/server/tests/homelab.test.ts)).

Para verlo a mano:

```bash
npx tsx apps/server/tests/support/mock-jellyfin.ts     # en http://127.0.0.1:8096
```

y apunta un widget a esa URL. Más en [Desarrollo](development.md).

## Compartir un plugin

Sube la carpeta del plugin a un repositorio de GitHub. Quien lo quiera lo clona dentro de su carpeta de plugins. Si publicas uno, añade en su README qué servicio y versión soporta y cómo obtener la API key.

## Confianza y seguridad

Un plugin se ejecuta **dentro del proceso del servidor**. `permissions` y `ctx.http` limitan lo que un plugin bien hecho puede hacer por la vía oficial, pero un plugin malicioso podría usar APIs de Node directamente. **Instala solo plugins cuyo código hayas leído o en cuyo autor confíes.** Detalle en [Seguridad](security.md#plugins).
