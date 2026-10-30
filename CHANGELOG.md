# Changelog

Todos los cambios relevantes se documentan aquí. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/) (mientras sea `0.x`, puede haber cambios incompatibles entre versiones menores).

## [Sin publicar]

## [0.4.0] — Widgets adaptables, filas por biblioteca y calendario con agenda

### Añadido

- **El contenido de cada widget crece con la tarjeta.** Antes solo crecía el contenedor; ahora el texto, las carátulas y los márgenes se escalan según lo que estires respecto al tamaño normal del widget (suave: entre 90 % y 140 %). En modo Editar, cada widget lleva un control **− 115 % +** para fijarlo de un clic.
- **Ajustes del contenido interior** en **Aspecto de este widget** y en `style:` del texto YAML: `scale` (50–200 %), `itemSize` (`xs`–`xl`), `columns` (1–8), `pad` (relleno de la tarjeta) y `overflow` (`fit` o `scroll`). Valen para todos los widgets, también los de plugins.
- **Jellyfin · Últimos añadidos por filas:** una fila de carátulas por biblioteca o género (películas, series, anime…), con su título, que se desplazan hacia los lados. Nueva vista `media` con `layout: "row"` para plugins.
- **Calendario con agenda:** los días con recordatorios se marcan con puntos; al tocar un día se ve su agenda y se pueden añadir, marcar y borrar recordatorios (se guardan en los widgets de Recordatorios y se ven al instante en ellos). Pestañas **Día / Mes**. Opciones: mostrar recordatorios y de qué lista. Nuevo tipo de campo `widget` para elegir otro widget del dashboard.

### Cambiado

- **Biblioteca y demás cifras:** ya no dejan un hueco enorme en medio al agrandarlas; reparten las columnas para que el número sea lo más grande posible sin perder ninguna.
- El calendario y las fechas de los recordatorios usan siempre el español.
- Los errores de estilo en el texto YAML dicen qué ajuste falla y qué valores admite.

## [0.3.0] — Diseño personalizable y configuración en texto

### Añadido

- **Configuración en texto (YAML):** en **Ajustes → Texto** las conexiones, las páginas con sus widgets (y su posición y tamaño) y la apariencia son tres documentos que se editan como texto, se descargan o se cargan desde un archivo. Se revisan mientras escribes (errores con su línea), enseñan qué cambiará y se aplican **todo o nada**. Los secretos nunca salen en claro (`••••••••` conserva el guardado) y pueden venir de variables de entorno con `{{OBLIVION_VAR_NOMBRE}}` (solo en campos secretos). Ver [guía](docs/configuration.md#configuración-en-texto-yaml).
- **Cada widget se adapta a su tamaño real.** Al agrandarlo o encogerlo, el contenido pasa solo de la versión compacta a la mediana o a la grande: el reloj enseña solo la hora, luego la fecha y al final el avance del año; el clima suma humedad y pronóstico; el calendario cambia de la semana en curso al mes entero; los enlaces pasan de tira a cuadrícula; las cifras, listas y carátulas reparten el espacio **sin barra de desplazamiento** (lo que no cabe se resume en «+N más»). Los titulares RSS, ntfy y Gotify sí se desplazan.
- **Tamaños rápidos S · M · L · XL** en cada widget al editar, y selector de **tamaño inicial** al añadirlo. Los plugins pueden declarar los suyos con `sizes` ([guía de plugins](docs/plugins.md#tamaños-y-adaptación)).
- **Modo edición renovado:** la barra del widget cabalga sobre su borde (ya no tapa el contenido), todo el widget se arrastra, **se redimensiona desde los ocho bordes y esquinas**, hay guías de la grilla, indicador del tamaño (4 × 5) mientras estiras, **duplicar widget** y una barra flotante con *Widget*, *Compacto/Libre* y *Listo*. `Esc` sale del modo edición.
- **Disposición Libre:** además de «Compacto» (los widgets se pegan arriba), cada widget se queda exactamente donde lo sueltes.
- **Widget «Imagen»** y **imagen de fondo por widget** (con oscurecimiento y desenfoque), y **«Sin tarjeta»** para poner reloj, saludo o buscador directamente sobre el fondo.
- **Catálogo de widgets con búsqueda**, ordenado por lo que ya tienes conectado, con iconos de línea en lugar de emojis.
- **Estado de las conexiones de un vistazo:** al abrir **Ajustes → Conexiones** cada una se prueba sola y muestra un punto verde/rojo con el motivo; los widgets con error ofrecen «Reintentar».
- **Diseño propio, menos «de plantilla»:** nuevos estilos **Taller** (por defecto), **Bento**, **Papel** y **Fotografía**; paletas **Arena** y **Tinta**; tipografía **Humanista** (Instrument Sans + Instrument Serif para cifras y títulos); grano fino sobre el fondo; títulos de widget en minúscula en vez de mayúsculas espaciadas.
- En pantallas medianas y móviles los widgets **fluyen en 1–3 columnas** conservando su proporción (antes se apilaban todos en una).

### Cambiado

- **Ids legibles:** las páginas, conexiones y widgets pasan de UUID a ids cortos (`inicio`, `jellyfin`, `reloj-2`) para poder escribirlos en los documentos de texto. Una migración automática convierte los que ya tienes sin tocar nada más; lo nuevo se crea ya con ids legibles.
- El aspecto por defecto de las instalaciones **nuevas** es ahora *Taller* (paleta Arena, acento terracota, tarjetas sólidas). **Tu apariencia guardada no cambia.**
- Las cifras, listas y métricas ya no se pintan como bloques rellenos del color de acento: son tipografía y líneas finas.
- `ListView` admite `scroll: true` y `WidgetDefinition` admite `sizes`.

## [0.2.0] — Conexiones, 50+ integraciones y más personalización

### Añadido

- **Conexiones compartidas:** la URL y las credenciales de Jellyfin y Speedtest Tracker se escriben una sola vez (en **Ajustes → Conexiones** o al añadir el primer widget) y todos los widgets del servicio las usan. Los plugins las declaran con `connection` ([guía de plugins](docs/plugins.md#conexión-compartida)).
- **Panel de Jellyfin:** un solo widget que combina «Reproduciendo ahora», «Biblioteca» y «Últimos añadidos» según las secciones que actives.
- Nueva vista declarativa `sections` para plugins que combinan varias vistas, y vista `chart` (gráfica de líneas).
- **Botón «Probar conexión»** en cada conexión: comprueba la URL y las credenciales sin guardarlas. Los plugins lo habilitan con `test(ctx)`.
- **Nuevas integraciones:** **Glances** (estado del sistema, discos y temperaturas), **qBittorrent**, **Transmission**, **Jellyseerr**, **Docker** (solo lectura, mediante un proxy del socket), **Pi-hole** (v5 y v6), **AdGuard Home** y **Uptime Kuma**.
- **Historial de Speedtest Tracker como gráfica** de líneas (descarga y subida); sigue disponible la lista.
- **Aspecto por widget:** color de acento propio, opacidad propia, título automático/siempre/oculto y enlace del título (por defecto, la URL de su conexión).
- **Fondo distinto por página** (aurora, liso, degradado o foto).
- **Cinco estilos base nuevos:** Neón, Brutalista, Editorial, Burbuja y Profundo (y los estilos de tarjeta «neón» y «brutal»).
- Guía de instalación en **Unraid**.
- **Más integraciones:** **Scrutiny** (salud SMART de los discos), **Immich**, **Jellystat**, **Tailscale**, **Gluetun**, **Titulares RSS** (con enlace a cada artículo) y **API personalizada** (cualquier API JSON, sin programar).
- **Widgets nuevos del dashboard:** **Buscador** (varios motores o uno propio) y **Saludo**.
- Las filas de las vistas `list` pueden llevar un enlace `href` (solo `http(s)`).
- **Familia *arr:** **Sonarr**, **Radarr**, **Lidarr** (cola de descargas, próximos estrenos y lo que falta), **Prowlarr** (estado de indexadores) y **Bazarr** (subtítulos pendientes).
- **UPS** con **PeaNUT**: estado con corriente/batería, carga, consumo y autonomía.
- **Home Assistant** (entidades a elegir y resumen de la casa, solo lectura), **Nextcloud**, **Paperless-ngx** y **Nginx Proxy Manager** (hosts y caducidad de certificados).
- **What's Up Docker** y **Watchtower** (contenedores con actualización pendiente), **Gatus** y **Healthchecks** (tareas programadas y copias de seguridad), **Netdata** (alarmas y gráfica de CPU/RAM) y **Beszel**.
- Los plugins pueden compartir código importando módulos de una carpeta común (`plugins/_shared`).
- **Copias de seguridad:** **Duplicati**, **Kopia** y **Backrest** (última copia de cada trabajo, avisos y errores).
- **Syncthing** (carpetas y dispositivos), **Audiobookshelf**, **Navidrome** (API Subsonic con token, sin enviar la contraseña), **Kavita**, **Komga**, **Mealie** (recetas y menú de la semana), **Karakeep** y **Linkwarden**.
- **Descargas:** **SABnzbd**, **NZBGet** y **Deluge**.
- **Proxies y túneles:** **Traefik**, **Caddy** y **Cloudflare Tunnel**.
- **Notificaciones:** **Gotify** y **ntfy**.

### Cambiado

- Los widgets de Jellyfin y Speedtest Tracker ya no piden URL ni clave: eligen una conexión. Al actualizar, **tus widgets existentes se migran solos**: los que apuntaban al mismo servidor pasan a compartir una conexión y las claves siguen cifradas. **Haz una copia del volumen de datos antes de actualizar** (la migración cambia la base de datos).
- El historial de Speedtest Tracker se muestra como gráfica por defecto (también los widgets que ya tenías).
- La apariencia admite dos estilos de tarjeta más (`neon` y `brutal`).

### Seguridad

- Las conexiones solo las gestiona el administrador; sus claves se cifran y nunca llegan al navegador.
- El enlace del título de un widget no expone la *query* ni el fragmento de la URL de la conexión a los usuarios de solo lectura.
- Los enlaces de las listas de los plugins (p. ej. RSS) solo pueden ser `http(s)`, validados en el servidor y de nuevo en el navegador.
- Las sesiones que guardan los plugins con inicio de sesión se ligan a una huella de la contraseña (una contraseña equivocada ya no reutiliza una sesión anterior) y su caché tiene un tope.
- El código compartido entre plugins vive fuera de los plugins (`plugins/_shared`) y solo importan `node:crypto`; hay una revisión automática de que todo campo sensible sea de tipo `secret`.

### Corregido

- El formulario de una conexión parte siempre de lo guardado al volver a abrirlo.
- El panel «Aspecto de este widget» ya no se cierra solo al volver a «Global».

## [0.1.0] — Primera versión

Primera versión pública (alfa).

### Añadido

- **Editor visual** de widgets con arrastrar y redimensionar, varias páginas y diseño adaptable a móvil.
- **Apariencia completa** con vista en vivo: 5 estilos (Cristal, Sólido, Minimalista, Contorno, Terminal), 6 paletas, modo oscuro/claro/sistema, acento libre, ajuste de tarjetas (opacidad, desenfoque, redondeo, sombra), fondos (aurora, liso, degradado o foto propia), 3 densidades y 3 tipografías.
- **Widgets incluidos:** Notas (Markdown con tareas), Recordatorios (con fecha y hora), Enlaces, Reloj, Calendario, Calculadora y Página web.
- **Plugins:** sistema de plugins con formularios generados, vistas declarativas (métrica, cifras, lista, carátulas, mensaje) y red restringida. Incluye **Jellyfin** (reproduciendo ahora, biblioteca, últimos añadidos con carátulas), **Speedtest Tracker** (API antigua y nueva; último test e historial), **Estado de servicios** y **Clima** (Open-Meteo).
- **Usuarios y roles** (administrador / solo lectura), contraseñas temporales con cambio obligatorio, y gestión de sesiones (propias y de otros usuarios).
- **Seguridad:** contraseñas con scrypt, sesiones `HttpOnly`, protección CSRF, límite de intentos, API keys cifradas con AES-256-GCM, CSP estricta, protección anti-SSRF para plugins, validación de imágenes subidas y auditoría.
- **Docker:** imagen multiplataforma (amd64 y arm64) que corre sin root, con sistema de archivos de solo lectura y sin capacidades de Linux.
- Documentación de instalación, configuración, integraciones, plugins, seguridad y desarrollo.

[Sin publicar]: https://github.com/sebastianvelezg/OBLIVION/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/sebastianvelezg/OBLIVION/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sebastianvelezg/OBLIVION/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sebastianvelezg/OBLIVION/releases/tag/v0.1.0
