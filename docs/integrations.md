# Integraciones

Cada integración es un [plugin](plugins.md). Para añadir un widget: **Editar → + Widget** y elige el que quieras. Las URLs y claves se guardan en el propio widget (las claves, cifradas), y cada widget guarda su propia conexión.

> **Estado de las pruebas:** estas integraciones se desarrollaron según la documentación oficial de cada servicio y se verifican con servidores simulados (ver [Desarrollo](development.md#pruebas)). Si tu versión se comporta distinto, abre un *issue* con el mensaje que muestra el widget y la versión del servicio.

- [Antes de empezar: la URL del servicio](#antes-de-empezar-la-url-del-servicio)
- [Jellyfin](#jellyfin)
- [Speedtest Tracker](#speedtest-tracker)
- [Estado de servicios](#estado-de-servicios-dockge-portainer-tu-nas)
- [Clima](#clima)
- [Errores frecuentes](#errores-frecuentes)

## Antes de empezar: la URL del servicio

Oblivion hace las llamadas **desde el servidor (desde el contenedor)**, no desde tu navegador. Por eso:

- ❌ `http://localhost:8096` — dentro del contenedor, `localhost` es el propio contenedor.
- ✅ `http://192.168.1.10:8096` — la IP de tu servidor en la red local.
- ✅ `http://jellyfin:8096` — solo si Jellyfin y Oblivion están en la **misma red de Docker**.

Oblivion solo puede llamar a la URL que escribas en el widget y bloquea siempre direcciones sensibles (como el servicio de metadatos de la nube). Ver [Seguridad](security.md#red-de-los-plugins-anti-ssrf).

## Jellyfin

Tres widgets: **Reproduciendo ahora**, **Biblioteca** y **Últimos añadidos**.

**1. Crea una API key en Jellyfin:** *Panel de control → Claves de API → «+»*, ponle un nombre (p. ej. «Oblivion») y copia la clave.

**2. En Oblivion:** *Editar → + Widget → Jellyfin* y rellena:

| Campo | Valor |
|---|---|
| **URL de Jellyfin** | La que usas para entrar, p. ej. `http://192.168.1.10:8096` (puede llevar subruta, como `/jellyfin`). |
| **API key** | La clave del paso 1. |

| Widget | Muestra |
|---|---|
| **Reproduciendo ahora** | Quién ve qué, con barra de progreso, si está en pausa y si el servidor está **transcodificando** (en ámbar). Se refresca cada 10 s. |
| **Biblioteca** | Películas, series, episodios, colecciones (y canciones/álbumes si tienes), más el nombre y la versión del servidor. |
| **Últimos añadidos** | Carátulas de lo último de tu biblioteca (películas, series o episodios, y cuántos mostrar). |

Las carátulas las pide el servidor a Jellyfin y se las sirve a tu navegador: **el navegador nunca habla con Jellyfin ni ve tu API key.**

## Speedtest Tracker

Dos widgets: **Último test de velocidad** e **Historial de velocidad** (solo con la API nueva).

Speedtest Tracker tiene dos APIs según la versión, y debes elegir la tuya en el campo **Versión de la API**:

| Tu versión | Elige | Autenticación |
|---|---|---|
| `henrywhitaker3/speedtest-tracker`, o `alexjustesen/speedtest-tracker` **anterior a 1.2.1** | **Antigua** | Ninguna |
| `alexjustesen/speedtest-tracker` **1.2.1 o posterior** (p. ej. la imagen de linuxserver) | **Nueva** | Token de API |

**Con la API nueva:** en Speedtest Tracker entra a `/admin/api-tokens`, crea un token con el permiso **Read Results** y pégalo en el campo **Token de API** del widget.

La URL es la de tu Speedtest Tracker (p. ej. `http://192.168.1.10:8765`). El widget muestra descarga, subida, ping y hace cuánto se midió; si el último test falló, te avisa.

> En la API antigua los valores de velocidad se interpretan en **Mbps**. Si ves cifras absurdas, abre un issue indicando tu versión.

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
| *El plugin no tiene permiso para llamar a `host`* | El servicio redirigió a otro dominio. Usa directamente la URL final. |
| *Dirección bloqueada* | La URL apunta a una dirección que Oblivion nunca permite (por seguridad). |

Para más detalle mira los registros: `docker compose logs -f`.
