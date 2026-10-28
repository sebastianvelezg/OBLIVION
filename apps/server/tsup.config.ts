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
});
