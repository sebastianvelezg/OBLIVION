# Política de seguridad

Oblivion guarda las claves de acceso a los servicios de tu red, así que nos tomamos la seguridad muy en serio. Gracias por ayudar a mantenerlo seguro.

## Versiones con soporte

Mientras el proyecto esté en versión `0.x`, solo se corrigen vulnerabilidades en la **última versión publicada**.

## Cómo reportar una vulnerabilidad

**Por favor, no abras un issue público** con detalles de una vulnerabilidad.

Usa el reporte privado de GitHub: **[Security → Report a vulnerability](https://github.com/sebastianvelezg/OBLIVION/security/advisories/new)**.

Incluye, si puedes:
- Qué versión usas y cómo lo instalaste (Docker, sin Docker).
- Pasos para reproducirlo y qué impacto tiene.
- Si ya existe una solución o mitigación que propongas.

Responderé lo antes posible, normalmente en pocos días. Cuando se corrija, publicaré una nota en el [CHANGELOG](CHANGELOG.md) y, si lo deseas, te mencionaré como descubridor.

## Qué es una vulnerabilidad en este proyecto

Por ejemplo: saltarse la autenticación o los permisos (que un usuario de solo lectura modifique algo), filtrar API keys o contraseñas, inyectar HTML o scripts (XSS), peticiones a servidores internos que no deberían ser alcanzables (SSRF), subir archivos peligrosos, o escapar del contenedor.

Lo que **ya se conoce y está documentado como limitación** (por ejemplo, que los plugins se ejecutan dentro del proceso del servidor o que no hay 2FA) está en [docs/security.md](docs/security.md#lo-que-no-cubre-todavía).

## Buenas prácticas para quien lo instala

- Define `OBLIVION_SETUP_TOKEN` antes del primer arranque.
- No lo expongas a internet por HTTP: usa una VPN o un reverse proxy con HTTPS ([guía](docs/installation.md#acceso-desde-fuera-de-casa)).
- Instala solo plugins de confianza.
- Haz copias de seguridad del volumen de datos y mantén la imagen actualizada.
