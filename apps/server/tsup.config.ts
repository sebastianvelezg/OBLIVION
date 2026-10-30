import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Un solo archivo autocontenido: la imagen final no necesita node_modules.
  noExternal: [/.*/],
  // Algunas dependencias (yaml) son CommonJS y hacen require() de módulos de Node: sin esto,
  // el bundle ESM falla al arrancar con «Dynamic require of "process" is not supported».
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
