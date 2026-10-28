import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CatalogWidget, PluginDefinition, WidgetDefinition } from "@oblivion/sdk";
import { corePlugin } from "./core.js";
import { pluginDefSchema } from "./schema.js";

export interface RegisteredWidget {
  plugin: PluginDefinition;
  def: WidgetDefinition;
  fullType: string;
}

export class PluginRegistry {
  private widgets = new Map<string, RegisteredWidget>();
  private plugins = new Map<string, PluginDefinition>();
  readonly errors: { dir: string; error: string }[] = [];

  register(plugin: PluginDefinition) {
    if (this.plugins.has(plugin.id)) throw new Error(`Plugin duplicado: ${plugin.id}`);
    // `component` es exclusivo del plugin core: un plugin externo no puede
    // pedir componentes del dashboard arbitrarios.
    for (const w of plugin.widgets) {
      if (w.component && plugin.id !== "core") {
        throw new Error(`«${plugin.id}.${w.type}»: solo el plugin core puede usar «component»`);
      }
      if (!w.component && !w.load) {
        throw new Error(`«${plugin.id}.${w.type}» necesita «load» o «component»`);
      }
    }
    this.plugins.set(plugin.id, plugin);
    for (const def of plugin.widgets) {
      const fullType = `${plugin.id}.${def.type}`;
      if (this.widgets.has(fullType)) throw new Error(`Widget duplicado: ${fullType}`);
      this.widgets.set(fullType, { plugin, def, fullType });
    }
  }

  /** Carga `core` y todas las carpetas `<dir>/<plugin>/plugin.mjs`. */
  static async load(dirs: string[], log: (m: string) => void = console.log) {
    const reg = new PluginRegistry();
    reg.register(corePlugin);

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const file = path.join(dir, entry.name, "plugin.mjs");
        if (!fs.existsSync(file)) continue;
        try {
          const mod = await import(pathToFileURL(file).href);
          const parsed = pluginDefSchema.parse(mod.default);
          reg.register(mod.default as PluginDefinition);
          log(`plugin cargado: ${parsed.id}@${parsed.version} (${parsed.widgets.length} widgets)`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          reg.errors.push({ dir: entry.name, error: msg });
          log(`plugin ignorado «${entry.name}»: ${msg}`);
        }
      }
    }
    return reg;
  }

  get(fullType: string) {
    return this.widgets.get(fullType);
  }

  catalog(): CatalogWidget[] {
    return [...this.widgets.values()].map(({ plugin, def, fullType }) => ({
      fullType,
      pluginId: plugin.id,
      pluginName: plugin.name,
      type: def.type,
      name: def.name,
      description: def.description,
      icon: def.icon,
      defaultSize: def.defaultSize,
      minSize: def.minSize ?? { w: 1, h: 1 },
      config: def.config,
      component: def.component,
      refreshSeconds: def.refreshSeconds ?? 60,
    }));
  }
}
