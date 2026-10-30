# Integraciones

Cada integración es un [plugin](plugins.md). Para añadir un widget: **Editar → + Widget** y elige el que quieras.

**Conexiones.** Los servicios que necesitan URL y credenciales (Jellyfin, Speedtest Tracker) usan una *conexión*: la escribes **una sola vez** y todos los widgets de ese servicio la comparten. Al añadir tu primer widget de Jellyfin se te pide crearla; los siguientes solo eligen cuál usar. Se gestionan en **Ajustes → Conexiones** (crear, editar, borrar); las claves se guardan cifradas y no se pueden leer de vuelta, solo reemplazar. Si cambias la URL o la clave de una conexión, todos sus widgets se actualizan a la vez. No puedes borrar una conexión mientras algún widget la use.

> **Estado de las pruebas:** estas integraciones se desarrollaron según la documentación oficial de cada servicio y se verifican con servidores simulados (ver [Desarrollo](development.md#pruebas)). Si tu versión se comporta distinto, abre un *issue* con el mensaje que muestra el widget y la versión del servicio.

- [Antes de empezar: la URL del servicio](#antes-de-empezar-la-url-del-servicio)
- [Probar la conexión y abrir el servicio](#probar-la-conexión-y-abrir-el-servicio)
- [Jellyfin](#jellyfin)
- [Jellyseerr](#jellyseerr)
- [Sonarr, Radarr, Lidarr, Prowlarr y Bazarr](#sonarr-radarr-lidarr-prowlarr-y-bazarr)
- [qBittorrent y Transmission](#qbittorrent-y-transmission)
- [SABnzbd, NZBGet y Deluge](#sabnzbd-nzbget-y-deluge)
- [Speedtest Tracker](#speedtest-tracker)
- [Estado del servidor (Glances)](#estado-del-servidor-glances)
- [Salud de los discos (Scrutiny)](#salud-de-los-discos-scrutiny)
- [UPS (PeaNUT)](#ups-peanut)
- [Netdata y Beszel](#netdata-y-beszel)
- [Immich](#immich)
- [Jellystat](#jellystat)
- [Tailscale](#tailscale)
- [Gluetun (VPN)](#gluetun-vpn)
- [Feeds RSS](#feeds-rss)
- [API personalizada](#api-personalizada)
- [Buscador y Saludo](#buscador-y-saludo)
- [Contenedores de Docker (solo lectura)](#contenedores-de-docker-solo-lectura)
- [Pi-hole y AdGuard Home](#pi-hole-y-adguard-home)
- [Uptime Kuma, Gatus y Healthchecks](#uptime-kuma-gatus-y-healthchecks)
- [What's Up Docker y Watchtower](#whats-up-docker-y-watchtower)
- [Home Assistant](#home-assistant)
- [Nextcloud y Paperless-ngx](#nextcloud-y-paperless-ngx)
- [Nginx Proxy Manager](#nginx-proxy-manager)
- [Traefik, Caddy y Cloudflare Tunnel](#traefik-caddy-y-cloudflare-tunnel)
- [Copias de seguridad: Duplicati, Kopia y Backrest](#copias-de-seguridad-duplicati-kopia-y-backrest)
- [Syncthing](#syncthing)
- [Audiobookshelf y Navidrome](#audiobookshelf-y-navidrome)
- [Kavita y Komga](#kavita-y-komga)
- [Mealie](#mealie)
- [Karakeep y Linkwarden](#karakeep-y-linkwarden)
- [Notificaciones: Gotify y ntfy](#notificaciones-gotify-y-ntfy)
- [Estado de servicios](#estado-de-servicios-dockge-portainer-tu-nas)
- [Clima](#clima)
- [Errores frecuentes](#errores-frecuentes)

## Antes de empezar: la URL del servicio

Oblivion hace las llamadas **desde el servidor (desde el contenedor)**, no desde tu navegador. Por eso:

- ❌ `http://localhost:8096` — dentro del contenedor, `localhost` es el propio contenedor.
- ✅ `http://192.168.1.10:8096` — la IP de tu servidor en la red local.
- ✅ `http://jellyfin:8096` — solo si Jellyfin y Oblivion están en la **misma red de Docker**.

Oblivion solo puede llamar a la URL que escribas en la conexión (o en el widget, si no usa conexión) y bloquea siempre direcciones sensibles (como el servicio de metadatos de la nube). Ver [Seguridad](security.md#red-de-los-plugins-anti-ssrf).

## Probar la conexión y abrir el servicio

- **Probar conexión:** en el formulario de cualquier conexión (al crearla o en **Ajustes → Conexiones**) el botón **Probar conexión** comprueba la URL y las credenciales con lo que hay escrito *sin guardar nada* y te dice qué pasó («Conectado a Jellyfin (v10.10)» o el motivo del fallo). Si dejas un secreto en blanco al editar, se usa el guardado.
- **Abrir el servicio:** si el widget muestra un título, al pulsarlo se abre la URL de su conexión en otra pestaña (si no hay título, aparece un icono ↗ al pasar el ratón). Puedes poner otro enlace, o quitarlo, en **Aspecto de este widget → Enlace del título**.

## Jellyfin

Cuatro widgets: **Reproduciendo ahora**, **Biblioteca**, **Últimos añadidos** y **Panel de Jellyfin**, que junta los tres en uno.

**1. Crea una API key en Jellyfin:** *Panel de control → Claves de API → «+»*, ponle un nombre (p. ej. «Oblivion») y copia la clave.

**2. En Oblivion:** *Editar → + Widget → Jellyfin* y, en «Nueva conexión», rellena (esto solo se hace una vez):

| Campo | Valor |
|---|---|
| **URL de Jellyfin** | La que usas para entrar, p. ej. `http://192.168.1.10:8096` (puede llevar subruta, como `/jellyfin`). |
| **API key** | La clave del paso 1. |

| Widget | Muestra |
|---|---|
| **Reproduciendo ahora** | Quién ve qué, con barra de progreso, si está en pausa y si el servidor está **transcodificando** (en ámbar). Se refresca cada 10 s. |
| **Biblioteca** | Películas, series, episodios, colecciones (y canciones/álbumes si tienes), más el nombre y la versión del servidor. |
| **Últimos añadidos** | Carátulas de lo último de tu biblioteca (películas, series, episodios o álbumes, y cuántos mostrar). Con **Filas por biblioteca** enseña una fila de carátulas por cada biblioteca o género (ver abajo). |

**Una fila por biblioteca.** En *Últimos añadidos* abre **Filas por biblioteca** y añade una fila por cada cosa que quieras ver: un título, la **biblioteca de Jellyfin** (su nombre; sin tildes ni mayúsculas da igual), qué mostrar, un género opcional y cuántas carátulas. Las filas se desplazan hacia los lados y se reparten el alto del widget; en **Contenido interior → Tamaño de las piezas** eliges lo grandes que son las carátulas. Si el nombre de una biblioteca no existe, la fila te dice cuáles hay. Desde el texto:

```yaml
- id: novedades
  type: jellyfin.latest
  connection: jellyfin
  layout: { x: 0, y: 0, w: 8, h: 12 }
  config:
    rows:
      - { title: Películas, library: Películas, kind: Movie, limit: 14 }
      - { title: Series, library: Series, kind: Series, limit: 12 }
      - { title: Anime, library: Anime, kind: Series, limit: 12 }
```

| **Panel de Jellyfin** | Un solo widget con las secciones que elijas (reproduciendo, biblioteca, últimos añadidos), con casillas para activar cada una. Si solo falla una sección, se avisa en ella; si falla la conexión, ves el error de la conexión. |

Las carátulas las pide el servidor a Jellyfin y se las sirve a tu navegador: **el navegador nunca habla con Jellyfin ni ve tu API key.**

## Jellyseerr

Un widget, **Solicitudes**: cuántas hay pendientes, procesando y disponibles, y las últimas que llegaron (título, quién las pidió y su estado). Funciona también con **Overseerr**.

**API key:** Jellyseerr → *Ajustes → General → Clave de API*. URL típica: `http://192.168.1.10:5055`. Solo se hacen lecturas.

## Sonarr, Radarr, Lidarr, Prowlarr y Bazarr

La familia *arr comparte API y forma de conectarse: **URL** (la de su interfaz web) y **API key** (*Ajustes → General → Seguridad → Clave API*). Cada app es un plugin con su propia conexión, y todas tienen **Probar conexión**.

| App | Widgets |
|---|---|
| **Sonarr** | **Cola de descargas** (progreso, estado y tiempo restante de cada episodio), **Próximos episodios** (los próximos *N* días, con «Hoy 20:00» / «Mañana») y **Episodios que faltan** (cuántos y los últimos). |
| **Radarr** | **Cola de descargas**, **Próximos estrenos** (digital, en disco o en cines) y **Películas que faltan**. |
| **Lidarr** | **Cola de descargas**, **Próximos álbumes** y **Álbumes que faltan**. |
| **Prowlarr** | **Indexadores**: cuántos están activos, con fallos temporales (con la hora a la que reintenta) o desactivados. |
| **Bazarr** | **Subtítulos pendientes**: películas y episodios sin subtítulos. |

En las colas, el **verde** es lo que se importó bien, el **ámbar** lo que espera o tiene un aviso y el **rojo** lo que falló.

## qBittorrent y Transmission

Cada uno tiene un widget **Descargas**: velocidad de descarga y subida, cuántos torrents hay y la lista de los activos con su progreso, estado y tiempo restante.

| | qBittorrent | Transmission |
|---|---|---|
| **URL** | La de su interfaz web, p. ej. `http://192.168.1.10:8080` | La de su interfaz web, p. ej. `http://192.168.1.10:9091` |
| **Acceso** | Usuario y contraseña de la interfaz web. Si tienes marcado *Omitir autenticación para clientes en localhost / subred*, déjalos en blanco. | Usuario y contraseña solo si los activaste. |
| **Opciones** | Listar *activos*, *solo descargando* o *todos*; cantidad. | Listar *activos* o *todos*; cantidad. |

En qBittorrent, activa la interfaz web en *Opciones → Interfaz web*. Si ves *«bloqueó esta IP»*, ha habido demasiados intentos fallidos: espera unos minutos y revisa la contraseña.

## SABnzbd, NZBGet y Deluge

Como qBittorrent: un widget **Descargas** con la velocidad, lo que queda y la cola, con progreso de cada descarga.

| | SABnzbd | NZBGet | Deluge |
|---|---|---|---|
| **Tipo** | Usenet | Usenet | Torrent |
| **URL** | `http://IP:8080` | `http://IP:6789` | La **interfaz web**, `http://IP:8112` |
| **Acceso** | **API key** (*Configuración → General → Seguridad → Clave API*) | Usuario y contraseña (por defecto `nzbget` / `tegbzn6789`: cámbialos) | La **contraseña de la interfaz web** (por defecto `deluge`: cámbiala) |

SABnzbd solo acepta la clave en la dirección (`?apikey=…`): Oblivion la añade al llamar y nunca llega al navegador. En **Deluge**, la interfaz web tiene que estar conectada a un demonio (*Ajustes → Gestor de conexiones*); si no lo está, el widget te lo dice. Deluge puede listar solo los torrents **activos** o todos.

## Speedtest Tracker

Dos widgets: **Último test de velocidad** e **Historial de velocidad** (solo con la API nueva). El historial se dibuja como una **gráfica de líneas** (descarga y subida, de antiguo a reciente, con el ping medio); en el widget puedes elegir **Lista** si prefieres la versión en filas.

La conexión (URL, versión y token) se escribe una vez y la comparten los dos widgets. Speedtest Tracker tiene dos APIs según la versión, y debes elegir la tuya en el campo **Versión de la API**:

| Tu versión | Elige | Autenticación |
|---|---|---|
| `henrywhitaker3/speedtest-tracker`, o `alexjustesen/speedtest-tracker` **anterior a 1.2.1** | **Antigua** | Ninguna |
| `alexjustesen/speedtest-tracker` **1.2.1 o posterior** (p. ej. la imagen de linuxserver) | **Nueva** | Token de API |

**Con la API nueva:** en Speedtest Tracker entra a `/admin/api-tokens`, crea un token con el permiso **Read Results** y pégalo en el campo **Token de API** de la conexión.

La URL es la de tu Speedtest Tracker (p. ej. `http://192.168.1.10:8765`). El widget muestra descarga, subida, ping y hace cuánto se midió; si el último test falló, te avisa.

> En la API antigua los valores de velocidad se interpretan en **Mbps**. Si ves cifras absurdas, abre un issue indicando tu versión.

## Estado del servidor (Glances)

[Glances](https://nicolargo.github.io/glances/) es un monitor de sistema con API. En **Unraid** lo encuentras en la tienda de aplicaciones (*Community Applications*, busca «Glances»). Para que vea el servidor entero y no solo su contenedor, ejecútalo en modo **host** (red *host*) con acceso de solo lectura a `/mnt`, y arráncalo en modo web (`glances -w`, puerto `61208`).

Tres widgets con una sola conexión (`http://IP-DEL-SERVIDOR:61208`; elige *Glances 4* o *3* según tu versión):

| Widget | Muestra |
|---|---|
| **Estado del sistema** | CPU, memoria, carga, tiempo encendido y nombre del servidor, con colores de aviso (ámbar > 75 % de CPU / 80 % de RAM; rojo más arriba). |
| **Discos** | Una fila por disco con barra de uso, usado/total y libre. En Unraid, pon `/mnt` en *«Solo montajes que empiecen por»* para ver el array (`/mnt/disk1`, `/mnt/disk2`…), la caché y los pools sin el ruido de Docker. Ámbar al 85 % y rojo al 95 %. |
| **Temperaturas** | Sensores de temperatura (CPU, placa, discos) de mayor a menor; ámbar desde 70 °C y rojo desde 85 °C. |

Si Glances tiene contraseña (`--username`/`--password`), ponla en la conexión.

## Salud de los discos (Scrutiny)

[Scrutiny](https://github.com/AnalogJ/scrutiny) lee los datos SMART de tus discos. En **Unraid** está en la tienda de aplicaciones (busca «Scrutiny»; la versión *omnibus* trae todo en un contenedor). Su API no pide autenticación: solo la URL (`http://IP-DEL-SERVIDOR:8080`).

El widget **Salud de los discos** muestra cuántos están **sanos, con aviso o con fallos** y una fila por disco con su modelo, `/dev/sdX`, capacidad, temperatura y días encendido. Los que fallan salen primero; los discos que archives en Scrutiny no cuentan.

## Immich

Widget **Biblioteca de fotos**: fotos, vídeos, espacio usado y lo que ocupa cada usuario. Funciona con las rutas de las versiones recientes de Immich y con las antiguas.

**API key:** Immich → tu usuario → *Ajustes de la cuenta → Claves de API → Nueva clave*. Las estadísticas del servidor **exigen una cuenta de administrador**; con una clave de usuario normal verás «no tiene permiso». URL típica: `http://192.168.1.10:2283`.

## Jellystat

[Jellystat](https://github.com/CyferShepard/Jellystat) guarda las estadísticas de reproducción de tu Jellyfin. El widget **Reproducciones** muestra cuántas películas, episodios y canciones se han visto en los últimos *N* días (30 por defecto). **API key:** *Ajustes → Clave de API* (Jellystat 1.1.6 o posterior).

## Tailscale

Widget **Dispositivos**: cuáles de tu tailnet están en línea, con su dirección, sistema y versión; avisa de los que tienen **actualización** o la **clave caducada**. Genera una clave en [login.tailscale.com → Settings → Keys](https://login.tailscale.com/admin/settings/keys) y pégala en la conexión (déjalo en `-` en *Tailnet* para usar el de la clave). Es el único plugin que sale a Internet: solo llama a `api.tailscale.com` y únicamente lee la lista de dispositivos.

## Gluetun (VPN)

Widget **Estado de la VPN**: si la VPN está activa, tu IP pública, la ubicación y el puerto reenviado. Usa el servidor de control de Gluetun (puerto `8000`). Si lo protegiste con una API key, ponla en la conexión; si no, tienes que permitir esas rutas en su archivo de autenticación (`/gluetun/auth/config.toml`):

```toml
[[roles]]
name = "oblivion"
routes = ["GET /v1/publicip/ip", "GET /v1/vpn/status", "GET /v1/portforward"]
auth = "apikey"
apikey = "pon-aquí-una-clave-larga"
```

El plugin prueba las rutas de las versiones antiguas de Gluetun si las nuevas no existen. La VPN y el puerto son datos extra: si faltan, simplemente no se muestran.

## Feeds RSS

Widget **Titulares RSS**: las últimas noticias de uno o varios feeds RSS/Atom (blogs, *releases* de GitHub como `https://github.com/usuario/repo/releases.atom`, Hacker News…), mezcladas por fecha, cada una con **enlace al artículo** (se abre en otra pestaña). No necesita claves: añade los feeds en la lista del widget.

El texto de un feed es ajeno al dashboard, así que se muestra siempre como texto y solo se aceptan enlaces `http(s)`. Si un feed redirige a *otro dominio*, el widget lo bloquea por seguridad: usa su dirección final.

## API personalizada

Para servicios que aún no tienen plugin: conectas **cualquier API JSON** sin programar.

1. **Conexión:** la URL base (p. ej. `http://192.168.1.10:8080`) y la autenticación: *ninguna*, *token Bearer*, *clave en una cabecera* (p. ej. `X-Api-Key`) o *usuario y contraseña*.
2. **Widget «Valores de una API»:** la ruta (`/api/stats`) y una lista de campos, cada uno con una **etiqueta**, una **ruta en el JSON** y un **formato**.
3. **Widget «Lista de una API»:** la ruta, dónde está la lista dentro del JSON y qué campo es el título, el subtítulo y el valor de la derecha.

Las rutas en el JSON se escriben como `data.users`, `stats.disks[0].name`, `$.total` o `items.length` (para contar elementos). Los formatos son: texto, número, porcentaje, tamaño (`bytes` → GB/TB), duración (segundos → *d h min*) y Sí/No. Si un campo no existe se muestra «—».

Solo hace peticiones `GET` y solo a la URL de la conexión (la ruta debe empezar por `/`). No ejecuta código: las rutas solo leen propiedades. El botón **Probar conexión** comprueba que el servidor responde.

## Buscador y Saludo

Dos widgets básicos que no llaman a ningún servicio:

- **Buscador:** una barra que abre Google, DuckDuckGo, Bing, Brave, Startpage, YouTube, GitHub o Wikipedia en otra pestaña, o un buscador propio (escribe `%s` donde va la búsqueda, p. ej. `https://buscador.casa/?q=%s`).
- **Saludo:** «Buenos días, *tu nombre*» según la hora, con la fecha.

## UPS (PeaNUT)

Para un servidor el UPS es tan importante como los discos. [PeaNUT](https://github.com/Brandawg93/PeaNUT) es una interfaz web y una API sobre **NUT** (Network UPS Tools), que soporta APC, Eaton, CyberPower y casi cualquier UPS con USB. En **Unraid** instala el plugin **NUT** (para que Unraid lea el UPS) y **PeaNUT** desde la tienda de aplicaciones.

Conexión: la URL de PeaNUT (`http://IP-DEL-SERVIDOR:8080`) y el **nombre del UPS en NUT** (por defecto `ups`). El widget **Estado del UPS** muestra:

| Dato | Detalle |
|---|---|
| **Estado** | *Con corriente* (verde), *Con batería* (ámbar), *Batería baja* (rojo), *Cambiar batería* o *Sobrecarga*. |
| **Batería** | Porcentaje, y si está cargando o descargando. Ámbar bajo el 50 %, rojo bajo el 20 %. |
| **Carga** | Porcentaje de lo que consume el UPS y, si PeaNUT lo da, los vatios. |
| **Autonomía** | Minutos que aguantaría con batería (ámbar bajo 10 min, rojo bajo 5). |
| **Entrada** | Voltaje de la red. |

## Netdata y Beszel

Dos alternativas a Glances para vigilar recursos.

- **Netdata** (`http://IP:19999`, sin clave): el widget **Resumen del sistema** muestra las **alarmas** (normales, avisos y críticas) y una **gráfica de CPU y memoria** de los últimos minutos. Si la gráfica no está disponible, se muestran solo las alarmas.
- **Beszel** (`http://IP:8090`): usa el correo y la contraseña de un usuario de Beszel (basta uno que solo vea los sistemas). El widget **Sistemas** lista cada servidor con su estado y el uso de CPU, memoria y disco; los caídos salen primero.

## Contenedores de Docker (solo lectura)

Dockge no tiene API, pero Docker sí: este widget muestra qué contenedores están **en marcha, detenidos o con problemas** (con fallos de salud, reiniciándose o que terminaron con error), agrupados por *stack* de Compose cuando lo tienen.

> ⚠️ **Seguridad: no montes `/var/run/docker.sock` en Oblivion ni expongas el puerto `2375` del demonio.** Quien alcance el socket de Docker puede controlar todo el servidor. Usa un **proxy de solo lectura** que deje pasar únicamente la lista de contenedores.

Con [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy) (en Unraid también está en la tienda de aplicaciones; en Dockge, pega este compose como un stack nuevo):

```yaml
services:
  docker-proxy:
    image: tecnativa/docker-socket-proxy
    container_name: docker-proxy
    restart: unless-stopped
    environment:
      CONTAINERS: 1   # lo único que se permite: listar contenedores
      POST: 0         # nada de crear, parar ni borrar
      # todo lo demás (IMAGES, EXEC, VOLUMES, NETWORKS, SERVICES…) queda en 0 por defecto
    ports:
      - "192.168.1.10:2375:2375"   # la IP de tu servidor: solo en tu red local
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

Y en Oblivion crea la conexión con la URL del proxy, p. ej. `http://192.168.1.10:2375` (**nunca** abras ese puerto en tu router; también puedes poner Oblivion y el proxy en la misma red de Docker y usar `http://docker-proxy:2375`). El plugin solo hace `GET /containers/json`; el botón **Probar conexión** lo comprueba y, si el proxy no permite listar, te dice que actives `CONTAINERS=1`.

## Pi-hole y AdGuard Home

Un widget **resumen** para cada uno: porcentaje de consultas DNS **bloqueadas**, total de consultas, bloqueadas y (Pi-hole) dominios en las listas o (AdGuard) tiempo medio de respuesta, además de si la protección está activa.

| | Pi-hole | AdGuard Home |
|---|---|---|
| **URL** | `http://192.168.1.2` | `http://192.168.1.2:3000` |
| **Acceso** | **v6:** la contraseña de su interfaz (o una *contraseña de aplicación*; déjala vacía si no tiene). **v5:** el *token de API* (*Ajustes → API → Mostrar token*). Elige la versión en la conexión. | Usuario y contraseña de su interfaz. |

## Uptime Kuma, Gatus y Healthchecks

Tres formas de vigilar que todo sigue vivo:

- **Uptime Kuma:** ver [la sección siguiente](#uptime-kuma).
- **Gatus** (`http://IP:8080`, sin clave): el widget **Endpoints** muestra cuántos están arriba o caídos, la **disponibilidad** reciente y la latencia de cada uno; los caídos salen primero y puedes mostrar solo esos.
- **Healthchecks** (healthchecks.io o tu propia instancia): vigila **tareas programadas y copias de seguridad**: cada script avisa con un *ping* y Healthchecks marca las que dejan de hacerlo. Usa una API key **de solo lectura** (*Proyecto → Ajustes → API keys → Read-only*). El widget **Tareas** muestra *al día / caídas / en gracia / pausadas*, y cuándo fue el último aviso de cada una. Puedes filtrar por **etiqueta** (p. ej. `backup`) o ver solo las que fallan.

## Uptime Kuma

Un widget **Monitores** con el estado, la latencia y la disponibilidad de 24 h de los monitores de una **página de estado** de Uptime Kuma. En Uptime Kuma crea una *Página de estado*, añade los monitores y copia su *slug* (la última parte de `/status/<slug>`). Esa API es pública y no necesita clave: Oblivion solo lee lo que ya publicas allí. Los que fallan salen primero, y puedes mostrar solo esos.

## What's Up Docker y Watchtower

Dos formas de saber qué contenedores tienen una versión nueva. Combinan bien con el widget de [Docker](#contenedores-de-docker-solo-lectura).

- **What's Up Docker** (`http://IP:3000`; usuario y contraseña solo si activaste autenticación básica): vigila tus contenedores **sin tocarlos** y avisa. El widget **Actualizaciones** muestra cuántos vigila y cuántos tienen novedad, con el salto (*Mayor* en rojo, *Menor* o *Parche* en ámbar) y de qué versión a cuál; puedes listar solo los que se pueden actualizar o todos.
- **Watchtower** (actualiza solo): arráncalo con la API HTTP y las métricas (`--http-api-metrics` y `WATCHTOWER_HTTP_API_TOKEN=<clave>`). El widget **Último análisis** muestra cuántos contenedores revisó, cuántos actualizó y cuántos fallaron, y los análisis totales.

## Home Assistant

- **Token:** en Home Assistant, tu perfil → pestaña *Seguridad* → **Tokens de acceso de larga duración**. URL típica: `http://192.168.1.10:8123`.
- **Entidades:** muestra el estado de las que elijas (hasta 20). Escribe su ID (*Herramientas de desarrollador → Estados*, p. ej. `sensor.temperatura_salon`) y, si quieres, un nombre. Los números salen con su unidad (`21.5 °C`, `1250 W`) y los estados comunes en español («Encendido», «Fuera», «No disponible»). Una entidad que no existe se marca en su fila, sin romper el resto.
- **Resumen de la casa:** luces encendidas, interruptores activos, personas en casa y entidades no disponibles. Lo calcula el propio Home Assistant con una plantilla de **solo lectura**.

Oblivion no puede encender ni apagar nada: solo lee estados.

## Nextcloud y Paperless-ngx

- **Nextcloud:** el widget **Servidor** muestra usuarios activos (24 h y ahora), usuarios, archivos, compartidos, espacio libre, memoria y carga. Necesita la app **«Información del sistema»** (serverinfo) y una cuenta de **administrador**. Dos formas de entrar: el **token** de esa app (*Administración → Información del sistema*) o tu usuario con una **contraseña de aplicación** (*Seguridad → Dispositivos y sesiones*; no uses tu contraseña real).
- **Paperless-ngx:** dos widgets. **Documentos**: total, los de la **bandeja de entrada** y los tipos de archivo. **Bandeja de entrada**: los documentos que esperan clasificarse. Autentica con un **token de API** (*Mi perfil*) o, si prefieres, con usuario y contraseña.

## Nginx Proxy Manager

Dos widgets con el usuario (correo) y la contraseña de NPM (conviene crear uno de **solo lectura** para Oblivion; la URL es la del panel, puerto `81`):

- **Hosts proxy:** cuántos están activos, desactivados o con error de configuración, y cada dominio con su destino y si usa HTTPS.
- **Certificados:** ordenados por caducidad, con el aviso **ámbar** a menos de 21 días y **rojo** a menos de 7 (o ya caducados). Útil para enterarte *antes* de que falle una renovación.

Oblivion inicia sesión por la API de NPM, guarda el token solo en memoria y lo renueva solo.

## Traefik, Caddy y Cloudflare Tunnel

- **Traefik** (`http://IP:8080`, la API de Traefik): el widget **Resumen** muestra cuántos routers, servicios y middlewares hay, con sus **errores y avisos**, y lista los routers con problemas y su regla. Si proteges la API con autenticación básica, pon el usuario y la contraseña. No uses `--api.insecure` fuera de tu red.
- **Caddy** (`http://IP:2019`, la API de **administración**): el widget **Destinos** muestra cada destino de tus proxies inversos con sus peticiones activas y fallos. Por defecto esa API solo escucha en `localhost`: para llegar desde Oblivion hay que cambiar `admin` en el Caddyfile y **no exponerla fuera de tu red**, porque puede cambiar la configuración de Caddy. Oblivion solo hace `GET`.
- **Cloudflare Tunnel:** el widget **Túnel** muestra si está *activo, degradado o caído*, sus conexiones, los centros de datos y la IP de origen. Crea un **token** en *Mi perfil → Tokens de API* con el permiso *Cuenta · Cloudflare Tunnel · Lectura*, y copia el **ID de la cuenta** y el **ID del túnel** de *Zero Trust → Redes → Túneles*. Es el único de estos que sale a Internet: solo llama a `api.cloudflare.com`.

## Copias de seguridad: Duplicati, Kopia y Backrest

Lo que más conviene vigilar: una copia que falla en silencio es peor que no tenerla. Los tres muestran, para cada trabajo, **cuándo fue la última copia** y la ponen en **ámbar** si lleva demasiado sin hacerse y en **rojo** si terminó con errores.

| | Duplicati | Kopia | Backrest |
|---|---|---|---|
| **URL** | `http://IP:8200` | El **servidor** de Kopia, `http://IP:51515` | `http://IP:9898` |
| **Acceso** | La **contraseña** de su interfaz (necesita la versión **2.1** o posterior) | Usuario y contraseña del servidor | Usuario y contraseña, si activaste autenticación |
| **Muestra** | Cada trabajo con su última copia, la siguiente programada, avisos y errores, y si hay una en curso | Cada origen con su último *snapshot*, tamaño y errores; avisa si pasaron más de 48 h | Cada plan con su último resultado y el balance de 30 días (éxitos, fallos y datos añadidos) |

> **Kopia:** su servidor usa por defecto **HTTPS con un certificado autofirmado**, que Oblivion no acepta (igual que con otros servicios). Arráncalo con `--insecure` (solo en tu red local) o con un certificado válido.

## Syncthing

Widget **Sincronización**: cada carpeta como *sincronizada*, *escaneando*, *sincronizando (con %)*, *pausada* o *con errores*, cuántos dispositivos están conectados (y desde cuándo no ves a los desconectados) y los errores. **API key:** *Acciones → Configuración → Clave API de la interfaz gráfica* (URL `http://IP:8384`).

## Audiobookshelf y Navidrome

- **Audiobookshelf** (`http://IP:13378`, **token de API** del usuario): widget **Bibliotecas** con elementos, duración y tamaño de cada una, y **quién está escuchando ahora** (esto último solo con un usuario administrador; si no, simplemente no se muestra).
- **Navidrome** (`http://IP:4533`, usuario y contraseña): widgets **Reproduciendo ahora** (quién escucha qué y en qué app) y **Últimos álbumes** con el tamaño de la biblioteca. Usa la API Subsonic, que **nunca envía la contraseña**: cada petición lleva un *token* (md5 de contraseña + sal aleatoria), como las apps de Navidrome. Crea un usuario solo para Oblivion.

## Kavita y Komga

Un widget **Biblioteca** en cada uno: totales (series, volúmenes o libros, archivos, tamaño) y las **series añadidas más recientemente**.

- **Kavita** (`http://IP:5000`): usuario y contraseña (o la clave de API / OPDS de un usuario, dejando el usuario vacío). Conviene crear un usuario solo para Oblivion. El token se guarda en memoria y se renueva solo.
- **Komga** (`http://IP:25600`): una **API key** (*Ajustes de la cuenta → Claves de API*) o usuario y contraseña. Funciona con las versiones antiguas y las nuevas de su API.

## Mealie

Dos widgets (**token:** tu perfil → *API Tokens*; `http://IP:9925`): **Recetas** (recetas, categorías, etiquetas, herramientas y usuarios) y **Menú de la semana**, con lo que hay planificado hoy («Hoy», «Mañana»…) ordenado por desayuno, almuerzo y cena. Funciona con Mealie v1 y v2.

## Karakeep y Linkwarden

- **Karakeep** (antes Hoarder; **clave de API**): **Marcadores** (marcadores, favoritos, archivados, etiquetas y listas) y **Últimos marcadores**, con **enlace** a cada página (solo `http`/`https`).
- **Linkwarden** (**token** en *Ajustes → Access Tokens*): **Resumen** con colecciones, enlaces y etiquetas, y las colecciones más grandes.

## Notificaciones: Gotify y ntfy

- **Gotify** (`http://IP:8080`): usa un token de **cliente** (*Clientes → crear*; el de una aplicación no puede leer). El widget **Notificaciones** muestra las últimas con su aplicación; las de prioridad alta salen en ámbar y las críticas en rojo.
- **ntfy** (ntfy.sh o tu servidor): indica uno o varios **temas** y el periodo (de 1 hora a todo lo que guarde el servidor). Si el tema requiere acceso, pon un **token**. Es una consulta puntual: Oblivion no se queda escuchando.

## Estado de servicios (Dockge, Portainer, tu NAS…)

Un **semáforo** para cualquier servicio con interfaz web. No usa API ni credenciales: hace una petición a cada URL y mira si contesta.

Configura una lista de **Nombre + URL** (hasta 30), por ejemplo `Dockge → http://192.168.1.10:5001`.

| Resultado | Significado |
|---|---|
| 🟢 **N ms** | Responde (2xx, 3xx o incluso 401/403: el servicio está vivo aunque pida login). Ámbar si tarda más de 1,5 s. |
| 🔴 **Error 5xx** | Responde, pero con un error de servidor. |
| 🔴 **Caído** | No conecta o tarda más de 8 s; el widget dice el motivo. |

**Sobre Dockge:** no ofrece una API pública (su interfaz usa un canal interno con usuario y contraseña), así que no hay un widget con la lista de sus stacks. Lo que sí puedes hacer es vigilar que esté arriba con este widget y abrirlo con un acceso directo en el widget **Enlaces** (o verlo dentro del dashboard con **Página web**, si Dockge lo permite).

> Los servicios `https://` con **certificado autofirmado** aparecen como «Caído». Usa su dirección `http://` de la red local o un certificado válido.

## Clima

Widget **Clima** (plugin `weather`): temperatura actual, sensación, humedad, viento y pronóstico de 5 días, con datos de [Open-Meteo](https://open-meteo.com). **No necesita API key.** Escribe tu ciudad y elige unidades métricas o imperiales.

## Errores frecuentes

El widget muestra el motivo del fallo. Los más habituales:

| Mensaje | Qué hacer |
|---|---|
| *No se pudo conectar con `host:puerto`* | La URL es incorrecta, el servicio está apagado o usaste `localhost`. Revisa [la URL del servicio](#antes-de-empezar-la-url-del-servicio). |
| *`host` tardó demasiado en responder* | El servicio no contestó en 8 s. Comprueba que esté sano y accesible desde el servidor. |
| *Jellyfin rechazó la API key* | La clave es incorrecta o la revocaste. Crea otra. |
| *Speedtest Tracker rechazó el token* | El token no existe o no tiene el permiso **Read Results**. |
| *No se encontró la API…* | Elegiste la versión de la API equivocada, o la URL no apunta al servicio. |
| *qBittorrent / Transmission / Pi-hole / AdGuard rechazó el usuario o la contraseña* | Credenciales incorrectas en la conexión (el botón **Probar conexión** lo confirma al momento). |
| *El proxy no deja listar contenedores* | En `docker-socket-proxy` activa `CONTAINERS=1`. |
| *No se encontró esa página de estado* | El *slug* de Uptime Kuma no existe o la página no está publicada. |
| *El plugin no tiene permiso para llamar a `host`* | El servicio redirigió a otro dominio. Usa directamente la URL final. |
| *Dirección bloqueada* | La URL apunta a una dirección que Oblivion nunca permite (por seguridad). |

Para más detalle mira los registros: `docker compose logs -f`.
