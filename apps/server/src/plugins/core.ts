import { definePlugin } from "@oblivion/sdk";

/**
 * Widgets que dibuja el propio dashboard en el navegador (no necesitan red).
 * `component` indica qué componente de React usar.
 */
export const corePlugin = definePlugin({
  id: "core",
  name: "Básicos",
  version: "0.1.0",
  description: "Widgets incluidos: reloj, calendario, calculadora, enlaces y páginas embebidas.",
  widgets: [
    {
      type: "clock",
      name: "Reloj",
      description: "Hora y fecha, con zona horaria opcional.",
      icon: "🕐",
      component: "clock",
      defaultSize: { w: 3, h: 3 },
      minSize: { w: 2, h: 2 },
      config: [
        {
          key: "timezone",
          label: "Zona horaria",
          type: "string",
          placeholder: "America/Bogota (vacío = la de tu navegador)",
        },
        { key: "hour12", label: "Formato 12 horas", type: "boolean", default: false },
        { key: "seconds", label: "Mostrar segundos", type: "boolean", default: false },
        { key: "date", label: "Mostrar fecha", type: "boolean", default: true },
      ],
    },
    {
      type: "calendar",
      name: "Calendario",
      description: "Calendario del mes con el día de hoy resaltado.",
      icon: "📅",
      component: "calendar",
      defaultSize: { w: 3, h: 6 },
      minSize: { w: 3, h: 5 },
      config: [
        {
          key: "weekStart",
          label: "La semana empieza en",
          type: "select",
          default: "1",
          options: [
            { value: "1", label: "Lunes" },
            { value: "0", label: "Domingo" },
          ],
        },
      ],
    },
    {
      type: "calculator",
      name: "Calculadora",
      description: "Calculadora rápida con teclado.",
      icon: "🧮",
      component: "calculator",
      defaultSize: { w: 3, h: 6 },
      minSize: { w: 3, h: 5 },
      config: [],
    },
    {
      type: "notes",
      name: "Notas",
      description: "Un bloc de notas con formato sencillo (Markdown). Se edita directamente en el widget.",
      icon: "📝",
      component: "notes",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 2, h: 3 },
      config: [
        {
          key: "size",
          label: "Tamaño del texto",
          type: "select",
          default: "md",
          options: [
            { value: "sm", label: "Pequeño" },
            { value: "md", label: "Normal" },
            { value: "lg", label: "Grande" },
          ],
        },
        { key: "mono", label: "Letra monoespaciada", type: "boolean", default: false },
      ],
    },
    {
      type: "reminders",
      name: "Recordatorios",
      description: "Lista de tareas con fecha opcional; marca las hechas y mira lo que vence hoy.",
      icon: "✅",
      component: "reminders",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      config: [
        { key: "showDone", label: "Mostrar las completadas", type: "boolean", default: true },
      ],
    },
    {
      type: "links",
      name: "Enlaces",
      description: "Atajos a tus servicios y páginas favoritas.",
      icon: "🔗",
      component: "links",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 2, h: 2 },
      config: [
        {
          key: "layout",
          label: "Disposición",
          type: "select",
          default: "grid",
          options: [
            { value: "grid", label: "Cuadrícula" },
            { value: "list", label: "Lista" },
          ],
        },
        { key: "newTab", label: "Abrir en pestaña nueva", type: "boolean", default: true },
        {
          key: "items",
          label: "Enlaces",
          type: "list",
          maxItems: 40,
          itemFields: [
            { key: "label", label: "Nombre", type: "string", required: true },
            { key: "url", label: "URL", type: "url", required: true, placeholder: "https://…" },
            { key: "icon", label: "Icono (emoji)", type: "string", placeholder: "🎬" },
          ],
        },
      ],
    },
    {
      type: "embed",
      name: "Página web",
      description: "Muestra otra página dentro del dashboard (si el sitio lo permite).",
      icon: "🌐",
      component: "embed",
      defaultSize: { w: 6, h: 8 },
      minSize: { w: 3, h: 4 },
      config: [
        {
          key: "url",
          label: "URL",
          type: "url",
          required: true,
          placeholder: "https://…",
          help: "Muchos sitios bloquean ser embebidos (X-Frame-Options). Eso lo decide el sitio, no el dashboard.",
        },
      ],
    },
  ],
});
