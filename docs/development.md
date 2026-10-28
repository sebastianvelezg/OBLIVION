# Desarrollo

Guía para compilar, probar y entender Oblivion por dentro. Si vas a contribuir, lee también [CONTRIBUTING.md](../CONTRIBUTING.md).

- [Arquitectura](#arquitectura)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Entorno de desarrollo](#entorno-de-desarrollo)
- [Pruebas](#pruebas)
- [Cómo está hecho](#cómo-está-hecho)
- [API](#api)
- [Publicar una versión](#publicar-una-versión)

## Arquitectura

```
Navegador ──HTTP──▶ Servidor (Hono, Node)
 React + Vite        ├─ sirve la interfaz compilada (SPA)
                     ├─ API /api  (auth, usuarios, páginas, widgets, apariencia)
                     ├─ SQLite (node:sqlite) en el volumen de datos
                     └─ Plugins (plugin.mjs) ──ctx.http──▶ tus servicios (Jellyfin, …)
```

- **Un solo proceso** y una sola imagen de Docker. El servidor se empaqueta en un único archivo (`tsup`), así que la imagen final no necesita `node_modules`.
- **Sin ORM ni servicios externos:** SQLite con el módulo `node:sqlite` de Node.
- Los **plugins no envían HTML**: devuelven datos (`View`) que la interfaz dibuja. Las llamadas a tus servicios las hace siempre el servidor.

**Stack:** Node.js ≥ 22.13 · TypeScript · Hono · zod · React 19 · Vite · Tailwind CSS 4 · TanStack Query · react-grid-layout.

## Estructura del repositorio

```
apps/
  server/            API (Hono): auth, usuarios, páginas, widgets, apariencia, plugins
    src/
      routes/        auth, users, pages (+widgets), appearance
      plugins/       registro, runtime (caché/errores), esquemas, widgets «core», estado
      security/      cliente HTTP seguro (anti-SSRF), límite de intentos, imágenes
    tests/           pruebas y servidores simulados (tests/support)
  web/               Interfaz (React + Vite + Tailwind)
    src/
      components/    Dashboard, Grid, paneles (Apariencia, Usuarios, Cuenta), diálogos
      widgets/       Widgets del navegador (notas, recordatorios, reloj…) y vistas de plugins
packages/
  sdk/               Tipos y contrato de los plugins (@oblivion/sdk)
plugins/             Plugins incluidos (jellyfin, speedtest, services, weather)
docs/                Documentación
```

## Entorno de desarrollo

Necesitas **Node.js 22.13 o superior**.

```bash
git clone https://github.com/sebastianvelezg/OBLIVION.git
cd OBLIVION
npm ci
npm run dev
```

`npm run dev` arranca el servidor en `http://localhost:3000` (recarga al editar) y Vite en **`http://localhost:5173`**; abre este último: Vite redirige `/api` al servidor. Los datos de desarrollo van a `./data` (ignorada por git).

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor + interfaz con recarga en caliente |
| `npm run typecheck` | Comprueba tipos en los tres paquetes |
| `npm test` | Pruebas del servidor y de la interfaz |
| `npm run build` | Compila la interfaz y empaqueta el servidor |
| `npm start` | Ejecuta el servidor compilado (sirve la interfaz) |

## Pruebas

```bash
npm test
```

- **Servidor** (`apps/server/tests`, ~80 pruebas con el ejecutor de Node + `tsx`): autenticación y límites, CSRF, usuarios y reglas del último administrador, contraseñas temporales, sesiones, cifrado de secretos, protección anti-SSRF, subida de imágenes, estado de widgets y los plugins incluidos.
- **Interfaz** (`apps/web/tests`): el renderizador de Markdown (que no inyecte HTML ni `javascript:`) y utilidades.
- **Plugins contra servicios simulados:** [`tests/support/`](../apps/server/tests/support) tiene servidores falsos de Jellyfin y Speedtest Tracker (incluidas carátulas PNG generadas). Para ejecutarlos a mano: `npx tsx apps/server/tests/support/mock-jellyfin.ts` y `mock-homelab.ts`.

Las pruebas del servidor usan la aplicación en memoria (`app.request(...)`) y una base SQLite en memoria: no abren puertos salvo los servidores simulados en `127.0.0.1`.

## Cómo está hecho

**Seguridad en las rutas.** Un middleware (`authenticate`) carga la sesión; `requireUser` / `requireAdmin` protegen rutas; `csrfGuard` y `mustChangePasswordGuard` se aplican a toda la API. Los límites de intentos viven en memoria.

**Widgets y plugins.** Un *plugin* declara sus widgets (campos de configuración, `load`, opcionalmente `image`). Los widgets que dibuja el propio navegador (notas, reloj…) son del plugin interno `core` y llevan `component`; solo `core` puede usarlo. La configuración se valida contra los campos declarados y los `secret` se cifran (`plugins/config.ts`). El `runtime` ejecuta `load` con caché, sin llamadas duplicadas, y sanea los errores.

**Estado de widgets.** Notas y recordatorios guardan su contenido en `widgets.state`, validado por un esquema por componente (`plugins/state.ts`), distinto de la *configuración*.

**Apariencia.** Un único objeto (`Appearance` en el SDK) validado por zod y guardado en `settings`. El navegador lo traduce a variables CSS (`theme.ts`) y pinta el fondo (`Backdrop`). Una copia en `localStorage` evita el parpadeo al cargar.

**Base de datos.** Migraciones numeradas en `apps/server/src/db.ts` (`PRAGMA user_version`); se aplican solas al arrancar.

## API

Todas las rutas cuelgan de `/api`. Las que modifican exigen la cabecera `X-Requested-With: oblivion`.

| Ruta | Quién | Descripción |
|---|---|---|
| `GET /health` | Todos | Comprobación de salud |
| `GET /auth/status` · `POST /auth/setup` · `POST /auth/login` · `POST /auth/logout` | Todos | Estado, primer arranque, acceso |
| `POST /auth/password` | Sesión | Cambiar contraseña |
| `GET /auth/sessions` · `DELETE /auth/sessions/:id` · `POST /auth/sessions/revoke-others` | Sesión | Mis sesiones |
| `GET /catalog` · `GET /pages` | Sesión | Catálogo de widgets y páginas con sus widgets |
| `POST/PATCH/DELETE /pages…` · `PUT /pages/:id/layout` | Admin | Páginas y disposición |
| `POST /pages/:id/widgets` · `PATCH/DELETE /widgets/:id` · `PUT /widgets/:id/state` | Admin | Widgets |
| `GET /widgets/:id/data` · `GET /widgets/:id/image/:key` | Sesión | Datos e imágenes de un widget de plugin |
| `GET /appearance` | Sesión | Apariencia |
| `PUT /appearance` · `POST /appearance/background` | Admin | Cambiar apariencia / subir foto |
| `GET /appearance/background/:id` | Sesión | La foto de fondo |
| `GET/POST /users` · `PATCH/DELETE /users/:id` · `…/:id/sessions` | Admin | Gestión de usuarios y sesiones |

## Publicar una versión

1. Actualiza `CHANGELOG.md` y la versión de `package.json` (raíz).
2. Etiqueta y sube: `git tag v0.2.0 && git push origin v0.2.0`.
3. El workflow **Release** construye la imagen para `amd64` y `arm64`, la publica en `ghcr.io/sebastianvelezg/oblivion` (`0.2.0`, `0.2` y `latest`) y crea la *release* de GitHub.
4. La primera vez, en GitHub → *Packages → oblivion → Package settings*, cambia la visibilidad a **Public** para que se pueda descargar sin iniciar sesión.
