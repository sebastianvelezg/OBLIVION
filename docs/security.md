# Seguridad

Oblivion guarda las claves de tus servicios, así que la seguridad es un requisito, no un extra. Este documento explica qué protege, cómo, y **qué no cubre todavía**. Para reportar una vulnerabilidad, mira la [política de seguridad](../SECURITY.md).

- [Autenticación y sesiones](#autenticación-y-sesiones)
- [Usuarios y roles](#usuarios-y-roles)
- [Protección de la API](#protección-de-la-api)
- [Secretos](#secretos)
- [Red de los plugins (anti-SSRF)](#red-de-los-plugins-anti-ssrf)
- [Apariencia y foto de fondo](#apariencia-y-foto-de-fondo)
- [Contenido que escribe el usuario](#contenido-que-escribe-el-usuario)
- [Contenedor](#contenedor)
- [Dependencias](#dependencias)
- [Plugins](#plugins)
- [Lo que NO cubre todavía](#lo-que-no-cubre-todavía)

## Autenticación y sesiones

- **Primer arranque:** el asistente crea el administrador. Con `OBLIVION_SETUP_TOKEN` se exige un código (comparado en tiempo constante); sin él, quien llegue primero lo crea (se avisa en el registro). Cuando ya existe un usuario, el asistente queda cerrado; se comprueba dentro de una transacción para evitar carreras.
- **Contraseñas:** scrypt (N=2¹⁷, r=8, p=1, sal aleatoria de 16 bytes), mínimo 12 caracteres. Los parámetros viajan con el hash, así que se pueden endurecer más adelante sin romper cuentas existentes.
- **Inicio de sesión:** mismo coste de cómputo exista o no el usuario y mensaje de error genérico (no revela qué usuarios existen). Límite de **5 fallos por usuario y 20 por IP cada 15 minutos** (429 con `Retry-After`).
- **Coste de contraseñas acotado:** cada scrypt usa ~128 MB, así que hay un máximo de 2 simultáneos y una cola corta; si se satura responde 503 en vez de agotar la memoria.
- **Sesiones:** token aleatorio de 256 bits en cookie `HttpOnly; SameSite=Strict` (y `Secure` bajo HTTPS). En la base de datos solo se guarda su **SHA-256**, así que un volcado de la base no permite suplantar sesiones. Caducan a los 7 días sin uso o 30 de vida absoluta; cambiar la contraseña cierra las demás.
- **Auditoría:** altas y bajas de usuarios, cambios de rol, restablecimientos de contraseña, inicios de sesión (correctos, fallidos y bloqueados), cierres de sesión remotos y cambios de widgets se guardan en la tabla `audit_log` y se emiten por la salida estándar en JSON. Nunca contienen contraseñas. Se recorta a 180 días / 20 000 filas.
- **Mantenimiento:** al arrancar y cada hora se eliminan las sesiones caducadas.

## Usuarios y roles

- **Roles:** `admin` (todo) y `viewer` (solo lectura). El rol se lee de la base de datos en cada petición: degradar a alguien surte efecto al instante, también en sus sesiones ya abiertas.
- **Reglas del servidor** (no solo de la interfaz): siempre queda al menos un administrador; nadie se elimina a sí mismo ni cambia su propio rol; máximo 50 usuarios; nombres únicos sin distinguir mayúsculas; misma política de contraseñas.
- **Contraseñas temporales:** la que pone un administrador al crear o restablecer una cuenta es temporal. Hasta que la persona la cambia, el servidor rechaza con `403 password_change_required` toda la API salvo ver el estado, cambiar la contraseña y cerrar sesión. Restablecer una contraseña cierra todas las sesiones de esa persona, y la nueva debe ser distinta de la actual. La contraseña generada se muestra una sola vez.
- **Sesiones:** cada usuario ve y cierra las suyas; un administrador puede cerrar las de cualquiera. El identificador de sesión que ve la interfaz es un hash: no permite suplantarla.

## Protección de la API

- **CSRF:** cookie `SameSite=Strict` + cabecera obligatoria `X-Requested-With: oblivion` en toda petición que modifica + comprobación de `Origin` contra el host.
- **Validación:** todo lo que entra se valida con esquemas y contra los campos que declara cada widget; las claves desconocidas se descartan.
- **URLs:** los campos `url` solo aceptan `http(s)` y sin credenciales embebidas; el navegador además comprueba el protocolo antes de pintar un enlace o un `iframe`.
- **Límites:** 256 KB por petición (8 MB para la foto de fondo) y 600 peticiones por minuto por IP.
- **Cabeceras:** CSP estricta (`script-src 'self'`, sin scripts inline, `frame-ancestors 'none'`, `object-src 'none'`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, COOP/CORP, `Permissions-Policy` y HSTS bajo HTTPS. Las respuestas de `/api` no se cachean.
- **Hosts permitidos:** con `OBLIVION_ALLOWED_HOSTS` se rechaza (421) cualquier petición con otro `Host`. Útil contra *DNS rebinding* y para que el servidor solo responda por tu dominio.

## Secretos

Las API keys de los widgets se cifran con **AES-256-GCM** antes de guardarse. La clave maestra es `OBLIVION_SECRET_KEY` o el archivo `master.key` del volumen de datos (permisos `0600`). Los secretos **nunca** se devuelven al navegador: la API solo indica *qué* campos tienen valor guardado, y al editar, dejar el campo vacío conserva el valor.

## Red de los plugins (anti-SSRF)

`ctx.http` solo permite los hosts declarados por el plugin y las URLs que configuró el administrador. Además resuelve el DNS y rechaza direcciones de *link-local* y metadatos cloud (p. ej. `169.254.169.254`), revalida cada redirección y limita tiempo (8 s) y tamaño de respuesta (2 MB). Las IP de la red local **sí** se permiten: es el caso de uso de un homelab.

## Apariencia y foto de fondo

- La apariencia es del dashboard entero y **solo el administrador** la cambia. Cada valor se valida contra un esquema cerrado: los colores deben ser `#rrggbb`, los números tienen rangos, y paleta/estilo/tipografía son listas fijas. No hay forma de colar CSS ni URLs arbitrarias.
- **Subida de la foto:** solo el administrador, máximo 8 MB, y el tipo se decide por la **firma real del archivo** (JPEG, PNG, WebP o AVIF), no por la extensión ni la cabecera. SVG, GIF y HTML se rechazan. El nombre en disco es el hash del contenido, nunca el que envía el cliente.
- El navegador reduce y recodifica la foto antes de subirla, lo que elimina los metadatos EXIF (ubicación GPS, cámara, fecha).
- **Servirla:** solo con sesión iniciada (no es pública), con el identificador validado por un patrón estricto (no se puede salir de la carpeta de subidas), `Cache-Control: private` y `nosniff`.
- Las fotos que dejan de usarse se borran del disco (con 10 minutos de margen para no perder una recién subida).

**Imágenes de plugins (carátulas):** el navegador solo conoce claves opacas; el servidor las resuelve con el plugin. Cada imagen se valida por su firma real antes de reenviarse (un servicio que devuelva HTML con `Content-Type: image/png` recibe 404), con tope de 3 MB, caché en memoria acotada (24 MB), y la ruta exige sesión.

## Contenido que escribe el usuario

- El estado de cada widget se valida con un esquema propio y límites de tamaño (nota: 20 000 caracteres; recordatorios: 200 elementos de 200 caracteres). Solo el administrador puede guardarlo.
- Las notas usan un Markdown mínimo que se dibuja **con elementos de React, nunca con `innerHTML`**: el HTML o los scripts escritos en una nota se muestran como texto. Los enlaces solo pueden ser `http(s)` y llevan `rel="noopener noreferrer"`. Hay pruebas automáticas de esto.

## Contenedor

La imagen corre como usuario no root (`node`), con el sistema de archivos en solo lectura (solo `/data` y `/tmp` son escribibles), sin ninguna capacidad de Linux (`cap_drop: ALL`) y con `no-new-privileges`. Está definido en el [`docker-compose.yml`](../docker-compose.yml).

## Dependencias

`npm audit` se revisa en cada cambio importante, y el repositorio usa Dependabot. Estado al publicar esta versión: sin avisos altos; queda un aviso **bajo** de `esbuild` que solo afecta a su servidor de desarrollo en Windows, que no se usa en producción.

## Plugins

Un plugin se ejecuta **dentro del proceso del servidor**. `permissions` y `ctx.http` limitan lo que un plugin bien hecho puede hacer por la vía oficial, pero un plugin malicioso podría usar APIs de Node directamente (leer archivos, abrir sockets…). **Instala solo plugins cuyo código hayas leído o en cuyo autor confíes.** Los plugins incluidos están en el repositorio y revisados.

## Lo que NO cubre todavía

- **Plugins sin sandbox:** ver arriba.
- **HTTPS:** el servidor habla HTTP. En producción ponlo detrás de un reverse proxy con TLS o accede por VPN y activa `OBLIVION_TRUST_PROXY` ([guía](installation.md#acceso-desde-fuera-de-casa)).
- **Doble factor y SSO:** no hay 2FA ni inicio de sesión con proveedores externos (OIDC).
- **Límite de intentos en memoria:** se reinicia con el servidor y no se comparte entre instancias (válido para una sola instancia).
- **DNS rebinding en los plugins:** la comprobación de DNS se hace antes de conectar; un atacante que controle el DNS de un host *ya permitido* podría intentar cambiarlo entre la comprobación y la conexión.
- **Widget «Página web»:** el sitio embebido corre en un `iframe` con `sandbox`, pero la CSP permite embeber cualquier `http(s)`. Añade solo sitios que quieras ver ahí.
- **Recuperación de la cuenta de administrador:** no hay «olvidé mi contraseña» por correo; se recupera con acceso al servidor ([cómo](installation.md#recuperar-el-acceso-de-administrador)).
