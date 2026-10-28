import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CatalogWidget, Field, PluginDefinition, WidgetDefinition } from "@oblivion/sdk";
import { corePlugin } from "./core.js";
import { pluginDefSchema } from "./schema.js";

export interface RegisteredWidget {
  plugin: PluginDefinition;
  def: WidgetDefinition;
  fullType: string;
  /** Campos de la conexión del plugin (vacío si no usa conexiones). */
  connection: Field[];
  /** Todos los campos que recibe el widget: conexión + los suyos. */
  fields: Field[];
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
      const clash = w.config.find((f) => plugin.connection?.some((c) => c.key === f.key));
      if (clash) {
        throw new Error(`«${plugin.id}.${w.type}»: el campo «${clash.key}» ya existe en la conexión del plugin`);
      }
    }
    this.plugins.set(plugin.id, plugin);
    for (const def of plugin.widgets) {
      const fullType = `${plugin.id}.${def.type}`;
      if (this.widgets.has(fullType)) throw new Error(`Widget duplicado: ${fullType}`);
      const connection = plugin.connection ?? [];
      this.widgets.set(fullType, { plugin, def, fullType, connection, fields: [...connection, ...def.config] });
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

  plugin(id: string) {
    return this.plugins.get(id);
  }

  catalog(): CatalogWidget[] {
    return [...this.widgets.values()].map(({ plugin, def, fullType, connection }) => ({
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
      connection,
      testable: typeof plugin.test === "function",
      component: def.component,
      refreshSeconds: def.refreshSeconds ?? 60,
    }));
  }
}
