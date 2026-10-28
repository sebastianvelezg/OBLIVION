# Instalación

Oblivion se distribuye como una imagen de Docker. Esta guía cubre la instalación en un servidor (Unraid, un NAS, un mini-PC, una Raspberry Pi…), cómo ponerlo detrás de HTTPS, actualizarlo y hacer copias de seguridad.

- [Requisitos](#requisitos)
- [Instalar con Docker Compose](#instalar-con-docker-compose)
- [Primer arranque](#primer-arranque)
- [Instalar en Unraid](#instalar-en-unraid)
- [Acceso desde fuera de casa](#acceso-desde-fuera-de-casa)
- [Actualizar](#actualizar)
- [Copia de seguridad y restauración](#copia-de-seguridad-y-restauración)
- [Construir desde el código fuente](#construir-desde-el-código-fuente)
- [Instalar sin Docker](#instalar-sin-docker)
- [Solución de problemas](#solución-de-problemas)

## Requisitos

- **Docker** con el plugin **Compose v2** (`docker compose version`). Probado con Docker 29 y Compose 5.
- Arquitectura **amd64** o **arm64** (la imagen se publica para ambas, así que sirve también para una Raspberry Pi).
- Muy poco: unos **40 MB de RAM** en reposo y ~250 MB de disco para la imagen.
- Acceso desde tu navegador al puerto que publiques (por defecto el `3000`).

## Instalar con Docker Compose

1. **Crea una carpeta** y descarga los dos archivos de configuración:

   ```bash
   mkdir oblivion && cd oblivion
   curl -fsSLO https://raw.githubusercontent.com/sebastianvelezg/OBLIVION/main/docker-compose.yml
   curl -fsSL https://raw.githubusercontent.com/sebastianvelezg/OBLIVION/main/.env.example -o .env
   ```

2. **Edita `.env`** y define, como mínimo, el código de primer arranque:

   ```bash
   # Genera uno al azar:
   openssl rand -hex 16
   ```

   ```ini
   OBLIVION_SETUP_TOKEN=pega-aquí-el-valor-generado
   ```

   Si el puerto `3000` ya está en uso (por ejemplo por otro dashboard), cambia también `OBLIVION_PORT`, p. ej. `OBLIVION_PORT=3001`.

3. **Arranca:**

   ```bash
   docker compose up -d
   docker compose logs -f      # opcional: ver el arranque (Ctrl+C para salir)
   ```

   El contenedor se llama `oblivion`, se reinicia solo y guarda sus datos en el volumen `oblivion_oblivion-data`.

> El contenedor corre **sin root**, con el sistema de archivos en **solo lectura** (solo `/data` y `/tmp` son escribibles), **sin capacidades de Linux** y con `no-new-privileges`. No hace falta tocar nada para obtener este endurecimiento.

## Primer arranque

1. Abre `http://IP-DEL-SERVIDOR:3000` (o el puerto que hayas elegido).
2. Verás **«Crea tu cuenta de administrador»**. Introduce un usuario, una contraseña de **al menos 12 caracteres** y el **código de configuración** (`OBLIVION_SETUP_TOKEN`).
3. Pulsa **Editar → Widget** para añadir tu primer widget. Los botones de la esquina abren la **Apariencia** (🎨) y los **Ajustes** (usuarios, contraseña, sesiones).

> ⚠️ Si no defines `OBLIVION_SETUP_TOKEN` y el servidor es accesible desde otras redes, **cualquiera que llegue primero a la página crea el administrador**. En una red doméstica cerrada es aceptable; en cualquier otro caso, define el código.

Para conectar tus servicios, ve a [Integraciones](integrations.md).

## Instalar en Unraid

Unraid trae Docker. Dos formas, elige la que ya uses:

- **Con Dockge o *Compose Manager*:** crea un stack con el contenido de `docker-compose.yml` y, en su `.env`, define `OBLIVION_SETUP_TOKEN` y, si el `3000` está ocupado, `OBLIVION_PORT`. Pulsa *Deploy*.
- **Guardar los datos en el array:** por defecto los datos van a un volumen de Docker (que vive en `docker.img`/el directorio de Docker). Si prefieres tenerlos en una carpeta visible y que entren en tus copias, sustituye el volumen por una ruta de *appdata* y dale permisos al usuario del contenedor (UID `1000`):

  ```yaml
      volumes:
        - /mnt/user/appdata/oblivion:/data
  ```

  ```bash
  mkdir -p /mnt/user/appdata/oblivion && chown 1000:1000 /mnt/user/appdata/oblivion
  ```

Después, entra en `http://IP-DE-TU-UNRAID:PUERTO`. Para ver el estado de tu Unraid (discos del array, caché, temperaturas) instala **Glances** desde la tienda y mira [Integraciones](integrations.md#estado-del-servidor-glances).

## Acceso desde fuera de casa

**No expongas Oblivion directamente a internet por HTTP.** Tienes dos buenas opciones.

### Opción A — VPN (la más simple y segura)

Entra a tu red por **WireGuard** o **Tailscale** y usa Oblivion como si estuvieras en casa. No hay nada más que configurar.

### Opción B — Reverse proxy con HTTPS

Pon un proxy con certificado delante (Caddy, Nginx Proxy Manager, Traefik…) y, en `.env`:

```ini
OBLIVION_TRUST_PROXY=true
OBLIVION_ALLOWED_HOSTS=oblivion.midominio.com
```

- `OBLIVION_TRUST_PROXY=true` hace que Oblivion confíe en `X-Forwarded-For/Proto/Host` (necesario para detectar HTTPS y registrar la IP real). **Actívalo solo si hay un proxy delante**: si no, cualquiera podría falsear su IP.
- `OBLIVION_ALLOWED_HOSTS` hace que solo responda cuando el `Host` es tu dominio (defensa extra).
- Publica el puerto solo en local para que nadie salte el proxy: en `docker-compose.yml` cambia el mapeo a `"127.0.0.1:${OBLIVION_PORT:-3000}:3000"`.

**Caddy** (`Caddyfile`) — obtiene y renueva el certificado solo:

```caddyfile
oblivion.midominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Nginx Proxy Manager:** crea un *Proxy Host* hacia `IP-DEL-SERVIDOR` puerto `3000`, activa *Block Common Exploits* y solicita el certificado SSL en la pestaña correspondiente. No hace falta WebSocket.

## Actualizar

```bash
cd oblivion
docker compose pull
docker compose up -d
```

La base de datos se migra sola al arrancar. Antes de actualizar, y sobre todo mientras Oblivion sea una versión `0.x`, haz una [copia de seguridad](#copia-de-seguridad-y-restauración). Las novedades de cada versión están en el [CHANGELOG](../CHANGELOG.md).

Para fijar una versión concreta en lugar de `latest`, cambia la imagen, por ejemplo: `ghcr.io/sebastianvelezg/oblivion:0.1.0`.

## Copia de seguridad y restauración

Todo lo que importa está en el volumen de datos: la base de datos (`oblivion.db`), la clave maestra (`master.key`) y la foto de fondo. **Guarda siempre la base de datos y la clave maestra juntas**: sin `master.key` no se pueden descifrar las API keys guardadas (aunque puedes definir `OBLIVION_SECRET_KEY` y guardar esa clave en tu gestor de contraseñas).

**Copia** (genera `oblivion-backup.tgz` en la carpeta actual):

```bash
docker compose stop
docker run --rm -v oblivion_oblivion-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/oblivion-backup.tgz -C /data .
docker compose start
```

**Restaurar** (reemplaza los datos actuales por los de la copia; funciona igual en una instalación nueva):

```bash
docker compose down -v          # ⚠️ borra el volumen actual: solo si quieres reemplazar los datos
docker volume create oblivion_oblivion-data
docker run --rm -v oblivion_oblivion-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/oblivion-backup.tgz -C /data
docker compose up -d
```

> Compose puede avisar de que el volumen «no fue creado por Compose». Es inofensivo: funciona igual.

## Construir desde el código fuente

Si prefieres construir la imagen tú mismo (o probar cambios):

```bash
git clone https://github.com/sebastianvelezg/OBLIVION.git
cd OBLIVION
cp .env.example .env        # y define OBLIVION_SETUP_TOKEN
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Instalar sin Docker

Necesitas **Node.js 22.13 o superior**.

```bash
git clone https://github.com/sebastianvelezg/OBLIVION.git
cd OBLIVION
npm ci
npm run build
OBLIVION_SETUP_TOKEN=tu-codigo OBLIVION_DATA_DIR=/var/lib/oblivion npm start
```

Para dejarlo como servicio con **systemd** (`/etc/systemd/system/oblivion.service`):

```ini
[Unit]
Description=Oblivion
After=network.target

[Service]
WorkingDirectory=/opt/oblivion
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=OBLIVION_DATA_DIR=/var/lib/oblivion
Environment=OBLIVION_SETUP_TOKEN=tu-codigo
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=on-failure
User=oblivion
# Endurecimiento básico
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/oblivion
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## Solución de problemas

**Ver qué pasa:** `docker compose logs -f` (o `docker logs oblivion`). El estado de salud: `docker inspect oblivion --format '{{.State.Health.Status}}'`.

| Síntoma | Causa y solución |
|---|---|
| `port is already allocated` al arrancar | Otro servicio usa el puerto 3000. Cambia `OBLIVION_PORT` en `.env` y repite `docker compose up -d`. |
| Un widget dice **«No se pudo conectar con localhost…»** | Dentro del contenedor, `localhost` es el propio contenedor, **no tu servidor**. Usa la IP de tu red local (p. ej. `http://192.168.1.10:8096`). Si el servicio está en otra red de Docker, solo puedes usar su nombre de contenedor si comparten red. |
| Un widget dice **«rechazó la API key»** | La clave es incorrecta o fue revocada. Edita el widget y pega una nueva. |
| Servicios `https://` con certificado propio salen **«Caído»** | Oblivion no acepta certificados autofirmados. Usa la dirección `http://` de tu red local o un certificado válido. |
| Entras y ves *«Solo lectura»* o no hay botón Editar | Tu usuario es de solo lectura. Pide a un administrador que cambie tu rol en Ajustes → Usuarios. |
| Salió «Demasiados intentos» al iniciar sesión | Hay un límite de 5 fallos por usuario cada 15 minutos. Espera y vuelve a probar. |
| **Perdí la contraseña del administrador** | Ver más abajo. |
| Perdí el `master.key` | Los widgets seguirán, pero las API keys guardadas ya no se pueden descifrar: edítalos y vuelve a pegarlas. |

### Recuperar el acceso de administrador

Si pierdes la contraseña de **todos** los administradores, puedes volver al asistente de primer arranque **conservando tus páginas, widgets y apariencia**. Este comando borra solo las cuentas de usuario (y sus sesiones):

```bash
docker exec oblivion node --disable-warning=ExperimentalWarning -e \
  "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync('/data/oblivion.db').exec('DELETE FROM users'); console.log('listo')"
```

Abre la web: aparecerá de nuevo «Crea tu cuenta de administrador» (con tu `OBLIVION_SETUP_TOKEN`). Tendrás que volver a crear también a los demás usuarios. Como cualquiera con acceso al servidor puede hacerlo, **protege el acceso a tu servidor y al socket de Docker**.

## Desinstalar

```bash
docker compose down        # detiene y elimina el contenedor (los datos se conservan)
docker compose down -v     # además BORRA los datos (base de datos y claves)
```
