# Contribuir a Oblivion

¡Gracias por querer ayudar! Oblivion es un proyecto pequeño y cualquier aporte suma: reportar errores, mejorar la documentación, traducir, crear un plugin o arreglar algo.

## Antes de empezar

- Para **errores y propuestas**, abre un [issue](https://github.com/sebastianvelezg/OBLIVION/issues/new/choose). Si es algo grande, coméntalo antes de escribir código para no perder tiempo.
- Para **vulnerabilidades**, no abras un issue público: sigue la [política de seguridad](SECURITY.md).

## Preparar el entorno

Necesitas Node.js 22.13 o superior.

```bash
git clone https://github.com/<tu-usuario>/OBLIVION.git
cd OBLIVION
npm ci
npm run dev        # servidor en :3000 e interfaz en http://localhost:5173
```

Más detalles en [docs/development.md](docs/development.md).

## Enviar un cambio

1. Haz un *fork* y crea una rama desde `main` (`fix/…`, `feat/…`, `docs/…`).
2. Haz el cambio. Mantén el estilo del código de alrededor (nombres, comentarios, idioma).
3. **Prueba que todo sigue bien:**

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

4. Añade o actualiza **pruebas** si cambias comportamiento (sobre todo en seguridad, autenticación y plugins) y la **documentación** si cambia algo visible.
5. Abre un *pull request* explicando **qué** cambia y **por qué**. Un PR pequeño y enfocado se revisa mucho más rápido.

### Mensajes de commit

Usamos el estilo [Conventional Commits](https://www.conventionalcommits.org/es/): `tipo(ámbito): descripción corta en minúsculas`.

```
feat(web): añadir selector de idioma
fix(server): rechazar sesiones de usuarios eliminados
docs: explicar cómo montar plugins propios
```

Tipos habituales: `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`.

## Qué se espera del código

- **La seguridad primero.** Todo lo que entra al servidor se valida; los secretos nunca viajan al navegador; los plugins no inyectan HTML. Si tocas autenticación, subidas, la red de los plugins o el renderizado de contenido de usuario, añade pruebas.
- **Sin dependencias innecesarias.** Pregúntate si de verdad hace falta una librería nueva.
- **Plugins.** Mantén la API de [`@oblivion/sdk`](packages/sdk/src/index.ts) pequeña y estable. Un widget nuevo de un servicio concreto suele ser mejor como plugin en `plugins/` que en el núcleo.

## Crear un plugin

Lee [docs/plugins.md](docs/plugins.md). Si es de un servicio popular y quieres incluirlo, abre un issue primero para acordar el alcance; incluye pruebas con un servidor simulado (como en `apps/server/tests/support`).

## Traducciones

La interfaz y la documentación están en español. Si quieres ayudar a traducirlas, abre un issue para coordinar el enfoque antes de empezar.

## Licencia

Al contribuir aceptas que tu aporte se publique bajo la licencia del proyecto, [GPL-3.0-or-later](LICENSE).
