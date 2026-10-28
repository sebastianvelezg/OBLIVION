# Changelog

Todos los cambios relevantes se documentan aquí. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/) (mientras sea `0.x`, puede haber cambios incompatibles entre versiones menores).

## [Sin publicar]

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

[Sin publicar]: https://github.com/sebastianvelezg/OBLIVION/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sebastianvelezg/OBLIVION/releases/tag/v0.1.0
