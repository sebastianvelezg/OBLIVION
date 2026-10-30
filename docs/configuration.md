# Configuración

Casi todo se configura desde la propia interfaz. Las variables de entorno son para el servidor.

- [Variables de entorno](#variables-de-entorno)
- [Datos y archivos](#datos-y-archivos)
- [Páginas y widgets](#páginas-y-widgets)
- [Apariencia](#apariencia)
- [Configuración en texto (YAML)](#configuración-en-texto-yaml)
- [Usuarios, roles y sesiones](#usuarios-roles-y-sesiones)

## Variables de entorno

Con Docker se definen en el archivo `.env` junto al `docker-compose.yml` (ver [Instalación](installation.md)).

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `OBLIVION_SETUP_TOKEN` | *(vacío)* | Código que se exige para crear el primer administrador. **Recomendado.** Con valor vacío, quien llegue primero crea el administrador. |
| `OBLIVION_PORT` | `3000` | Puerto del servidor donde se publica Oblivion *(solo Docker Compose)*. |
| `OBLIVION_TRUST_PROXY` | `false` | Confiar en `X-Forwarded-For/Proto/Host`. Actívalo **solo** si hay un reverse proxy delante. |
| `OBLIVION_ALLOWED_HOSTS` | *(vacío)* | Lista separada por comas de `Host` permitidos (p. ej. `oblivion.midominio.com`). Cualquier otro recibe un 421. |
| `OBLIVION_COOKIE_SECURE` | `auto` | `auto` marca la cookie como *Secure* si la petición llegó por HTTPS; `always` / `never` la fuerzan. |
| `OBLIVION_SECRET_KEY` | *(se genera)* | Clave maestra (32 bytes en hex, 64 caracteres) con la que se cifran las API keys. Si no la defines, se crea `master.key` en el volumen de datos. |
| `PORT` | `3000` | Puerto interno del servidor *(instalación sin Docker)*. |
| `HOST` | `0.0.0.0` | Interfaz en la que escucha *(instalación sin Docker)*. |
| `OBLIVION_DATA_DIR` | `./data` (Docker: `/data`) | Dónde se guardan la base de datos, `master.key` y las imágenes subidas. |
| `OBLIVION_VAR_*` | *(ninguna)* | Cualquier variable con este prefijo se puede usar como valor en la [configuración en texto](#configuración-en-texto-yaml): `{{OBLIVION_VAR_JELLYFIN_KEY}}`. Así las claves no se escriben en los documentos. |
| `OBLIVION_PLUGINS_DIR` | `./plugins` (Docker: `/app/plugins`) | Carpetas de plugins, separadas por `:` (en Windows `;`). Ver [Plugins](plugins.md#instalar-plugins-propios). |

## Datos y archivos

Todo vive en `OBLIVION_DATA_DIR`:

| Archivo | Contenido |
|---|---|
| `oblivion.db` | Base de datos SQLite: usuarios, páginas, widgets, apariencia y registro de auditoría. |
| `master.key` | Clave de cifrado de las API keys (permisos `0600`). **Guárdala junto con la base de datos.** |
| `uploads/` | La foto de fondo, si subiste una. |

Cómo hacer copia de seguridad: [Instalación → Copia de seguridad](installation.md#copia-de-seguridad-y-restauración).

## Páginas y widgets

- Pulsa **Editar** (arriba a la derecha) para entrar en el modo de edición. Ahí puedes **arrastrar** los widgets por su barra superior, **redimensionarlos** desde la esquina inferior derecha, **configurarlos** (⚙) o **borrarlos** (🗑).
- **+ Widget** abre el catálogo. Cada widget muestra un formulario generado a partir de lo que necesita (URL, API key, ciudad…).
- Puedes tener hasta **20 páginas** (pestañas) con hasta **100 widgets** cada una. En modo edición, el lápiz junto a las pestañas las renombra o elimina, y el **+** crea otra.
- En el móvil los widgets se muestran apilados, en el orden en que aparecen en la pantalla grande.
- Las **API keys** que pegues se guardan cifradas. Al editar un widget verás que el campo está vacío con el aviso «ya hay un valor guardado»: déjalo vacío para conservarla o escribe otra para reemplazarla.

### Widgets incluidos

| Widget | Qué hace |
|---|---|
| **Notas** | Bloc de notas en Markdown (títulos, listas, `- [ ]` tareas, **negrita**, *cursiva*, `código`, enlaces). Doble clic para editar, `Esc` para salir; se guarda solo. |
| **Recordatorios** | Lista de tareas con fecha y hora opcionales. Marca vencidos y de hoy, y muestra un aviso cuando llega la hora (mientras la página esté abierta). |
| **Enlaces** | Atajos a tus servicios, en cuadrícula o lista, con icono emoji. |
| **Reloj** | Hora y fecha, con zona horaria, formato 12/24 h y segundos opcionales. |
| **Calendario** | Mes con el día de hoy resaltado; la semana empieza en lunes o domingo. |
| **Calculadora** | Calculadora con teclado. |
| **Página web** | Muestra otra página dentro del dashboard (si el sitio permite ser embebido). |

Los widgets de servicios (Jellyfin, Jellyseerr, qBittorrent, Transmission, Speedtest Tracker, Glances, Docker, Pi-hole, AdGuard Home, Uptime Kuma, estado de servicios, clima) están en [Integraciones](integrations.md).

### Tamaño y colocación

En modo **Editar** cada widget lleva una barra sobre su borde superior:

- **S · M · L · XL** cambian su tamaño de un clic (cada widget define sus medidas; también puedes elegir el tamaño inicial al añadirlo).
- Arrastra el widget por cualquier punto para moverlo y **estira cualquier borde o esquina** para redimensionarlo; mientras lo haces ves su tamaño en celdas y las guías de la grilla.
- **Duplicar**, **configurar** y **eliminar** están en la misma barra. `Esc` o **Listo** salen del modo edición.
- La barra de abajo cambia entre **Compacto** (los widgets se pegan arriba sin huecos) y **Libre** (cada uno se queda donde lo sueltes).

El contenido se adapta solo al espacio: un reloj pequeño enseña la hora; uno grande, también la fecha, la zona y el avance del año. En pantallas más estrechas los widgets pasan a 2–3 columnas y, en el móvil, a una.

### Aspecto de cada widget

En el formulario de cualquier widget, el apartado **Aspecto de este widget** permite retocarlo sin cambiar el estilo global:

- **Título en la tarjeta:** *Automático* (solo si escribes uno), *Mostrar siempre* (con el nombre del widget si no hay título) u *Ocultar*.
- **Color de acento propio:** p. ej. un **rojo** para que un widget de alertas destaque; también cambia el borde y el resplandor en los estilos Neón y Brutalista.
- **Sin tarjeta:** el contenido va directamente sobre el fondo (ideal para reloj, saludo o buscador).
- **Opacidad propia** del fondo de la tarjeta.
- **Imagen de fondo** del widget, con oscurecimiento y desenfoque. El widget **Imagen** usa esto mismo, con un texto opcional encima.
- **Enlace del título:** a dónde lleva al pulsarlo (por defecto, la URL de su conexión).

## Apariencia

El botón **🎨** abre un panel lateral que **no tapa el dashboard**: ves los cambios mientras los haces y se guardan solos. Solo los administradores pueden cambiarla, y vale para todos los usuarios.

| Sección | Opciones |
|---|---|
| **Estilo** | *Taller* (por defecto), *Bento*, *Papel*, *Fotografía*, *Cristal*, *Sólido*, *Minimalista*, *Contorno*, *Neón* (borde y resplandor del acento), *Brutalista* (bordes gruesos y sombra dura), *Editorial* (serifa, amplio), *Burbuja* (muy redondeado), *Profundo* (cristal casi opaco con degradado) y *Terminal*. Cambian la forma (tarjetas, densidad, fondo, letra) sin tocar tu paleta ni tu acento. |
| **Color** | Modo oscuro / claro / sistema · 8 paletas (*Medianoche, Grafito, Océano, Bosque, Ciruela, Brasa, Arena, Tinta*) · 8 acentos o uno libre. |
| **Tarjetas** | Estilo (cristal, sólido, contorno, plano, neón, brutal), opacidad, desenfoque, redondeo y sombra. |
| **Fondo** | *Aurora*, *Liso*, *Degradado* (dos colores y ángulo) o *Foto* (con desenfoque y oscurecimiento). |
| **Disposición y letra** | Al mover widgets (compacto o libre), densidad (compacta, cómoda, amplia) y tipografía (moderna, humanista, terminal, editorial). |

**Fondo distinto por página:** en modo **Editar**, el lápiz de la página (o doble clic en su nombre) abre **Fondo propio**: actívalo y elige aurora, liso, degradado o una foto solo para esa página. Al desactivarlo vuelve al fondo general.

**Foto de fondo:** pulsa *Subir foto* y elige una imagen. Se **reduce y se limpia en tu navegador** antes de subirse (se eliminan los metadatos EXIF, como la ubicación GPS). Acepta JPG, PNG, WebP y AVIF (máx. 8 MB tras el procesado). Solo la ven los usuarios con sesión iniciada. **Restablecer** devuelve todo al aspecto por defecto.

## Configuración en texto (YAML)

Todo lo que configuras con el ratón también se puede ver y editar como texto: **Ajustes → Texto**. Son tres documentos:

| Documento | Qué contiene |
|---|---|
| `paginas.yml` | Páginas (orden, título, fondo propio) y, en cada una, sus widgets: tipo, título, conexión, configuración, aspecto, **posición y tamaño** y, en notas y recordatorios, su contenido. |
| `conexiones.yml` | Las conexiones a tus servicios (URL y credenciales). |
| `apariencia.yml` | Tema, paleta, acento, tipografía, densidad, disposición, tarjetas y fondo. |

Los generas a partir de lo que ya tienes, así que lo normal es **abrir, cambiar lo que quieras y aplicar**. También puedes **descargar** cada documento, guardarlo en git o **cargar** uno desde un archivo (por ejemplo, para llevarte tu dashboard a otra instalación).

### Cómo se aplica

1. Mientras escribes, el texto se **revisa solo**: los errores salen con su línea (pulsa uno para ir a ella) y los avisos, por ejemplo una clave mal escrita o dos widgets que se solapan, en ámbar.
2. Debajo ves **qué cambiará**: cuántos elementos se añaden, cambian o se eliminan, con el detalle.
3. **Aplicar** (o `Ctrl+S` dentro del editor) lo guarda **todo o nada**: si algo falla, no se toca nada.

Cada documento describe **el estado completo** de su parte: lo que no aparece en el texto se elimina (con su contenido, como las notas), y el botón avisa de cuántos elementos se irán. Los de un plugin que ya no está instalado no se muestran y nunca se borran. Lo escrito y no aplicado se conserva al cerrar Ajustes, pero no al recargar la página.

### Formato

```yaml
# conexiones.yml
connections:
  jellyfin:                      # el id: lo eliges tú (minúsculas, números, - y _)
    plugin: jellyfin
    name: Jellyfin del salón
    config:
      url: http://192.168.0.117:8096
      apiKey: "{{OBLIVION_VAR_JELLYFIN_KEY}}"
```

```yaml
# paginas.yml
pages:
  - id: inicio
    title: Inicio
    widgets:
      - id: hora
        type: core.clock
        layout: { x: 0, y: 0, w: 4, h: 3 }   # columna, fila, ancho (1-12) y alto
      - id: novedades
        type: jellyfin.latest
        connection: jellyfin                 # id de una conexión de conexiones.yml
        config: { limit: 8 }
        style: { accent: "#e0793f", bare: false }
      - type: core.notes                     # sin id: se crea uno; sin layout: primer hueco libre
        state: { text: "Comprar café" }
  - title: Medios
    background: { type: gradient, from: "#1a1a2e", to: "#16213e", angle: 160 }
```

```yaml
# apariencia.yml (lo que omitas vuelve al valor de fábrica)
mode: dark
palette: sand
accent: "#e0793f"
layout: { free: true }
card: { style: solid, radius: 14 }
```

- **Ids:** los eliges tú o los genera Oblivion (`reloj`, `reloj-2`...). El id es lo que hace que un widget conserve su contenido y sus secretos al volver a aplicar: si cambias un id, para Oblivion es un widget nuevo.
- **Tipos y campos:** el `type` de un widget es el del catálogo (`core.clock`, `jellyfin.latest`...) y sus claves de `config` son las de su formulario. Una clave desconocida da un aviso y se ignora.
- **Secretos:** se muestran como `••••••••`. Déjalo así para conservar el valor guardado, escribe uno nuevo para cambiarlo (se cifra al aplicar y el documento guardado lo tapa) o pon `null` para borrarlo.
- **Variables de entorno:** `{{OBLIVION_VAR_LO_QUE_SEA}}` se sustituye por el valor de esa variable del contenedor al aplicar, de modo que el documento puede compartirse o subirse a git sin claves. Funciona **solo en campos secretos** (API keys, contraseñas, tokens): en un campo normal el texto se queda tal cual, porque ese valor lo vería cualquier usuario con sesión. Solo se leen variables con el prefijo `OBLIVION_VAR_`; si no existe, es un error. Para que el texto guardado siga mostrando la referencia, el campo debe ser **solo** la variable (no `Bearer {{...}}`).
- **Nada en claro:** ninguna clave escrita en el texto se guarda sin cifrar. Al aplicar se cifra y el texto guardado la sustituye por `••••••••`; lo mismo ocurre con un valor puesto en una clave que Oblivion ignora (por ejemplo `password:` en un widget que no la tiene). Los **comentarios** sí se guardan tal cual: no escribas claves dentro de ellos.
- **Imágenes:** los documentos citan las fotos por su id (`imageId`, `image`); los archivos no viajan en el texto. Si llevas un documento a otra instalación, vuelve a subir las imágenes desde el panel de apariencia.
- **Comentarios:** tu texto se conserva tal cual, con sus comentarios, mientras no cambies nada desde la interfaz. Si mueves un widget con el ratón, por ejemplo, el documento se vuelve a generar y los comentarios se pierden.
- **Alias YAML** (`&ancla` / `*alias`) no están permitidos.

## Usuarios, roles y sesiones

En **Ajustes** (⚙) encuentras **Mi cuenta** y, si eres administrador, **Usuarios**.

**Roles**

| Rol | Puede |
|---|---|
| **Administrador** | Todo: editar widgets y páginas, cambiar la apariencia, escribir en notas y recordatorios, gestionar usuarios. |
| **Solo lectura** | Ver el dashboard. No puede modificar nada. |

**Gestión de usuarios** (administradores)
- **Crear un usuario:** nombre (letras, números, `_ . -`), rol y contraseña inicial. Se genera una al azar y se te muestra **una sola vez** con un botón para copiarla.
- **Contraseña temporal:** por defecto, la persona **debe cambiarla** al entrar por primera vez; hasta entonces no puede usar nada más.
- **Restablecer la contraseña** de alguien: la deja temporal y **cierra todas sus sesiones**.
- **Cambiar el rol** surte efecto al instante, incluso en sesiones ya abiertas.
- **Eliminar** un usuario cierra sus sesiones. Siempre queda **al menos un administrador**, y no puedes eliminarte ni cambiarte el rol a ti mismo.
- Hasta 50 usuarios.

**Sesiones**
- Cada persona ve las suyas en *Mi cuenta → Mis sesiones* (navegador, IP, última actividad) y puede cerrar una, o **cerrar todas las demás**.
- Los administradores pueden ver y cerrar las sesiones de cualquiera desde *Usuarios*.
- Una sesión caduca tras 7 días sin uso o 30 días en total. Cambiar la contraseña cierra las demás sesiones.

Si pierdes el acceso de administrador, mira [Recuperar el acceso](installation.md#recuperar-el-acceso-de-administrador).
