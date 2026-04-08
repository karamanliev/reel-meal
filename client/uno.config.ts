import {
  defineConfig,
  presetWind,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

export default defineConfig({
  presets: [
    presetWind({
      dark: "media",
    }),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  theme: {
    colors: {
      primary: {
        50: "#fff7ed",
        100: "#ffedd5",
        200: "#fed7aa",
        300: "#fdba74",
        400: "#fb923c",
        500: "#f97316",
        600: "#ea580c",
        700: "#c2410c",
        800: "#9a3412",
        900: "#7c2d12",
        950: "#431407",
      },
      fresh: {
        50: "#f0fdf4",
        100: "#dcfce7",
        200: "#bbf7d0",
        300: "#86efac",
        400: "#4ade80",
        500: "#22c55e",
        600: "#16a34a",
        700: "#15803d",
        800: "#166534",
        900: "#14532d",
      },
      surface: {
        50: "#faf8f6",
        100: "#f5f0ec",
        200: "#e8e0d8",
        300: "#d4c8bc",
        400: "#b8a898",
        500: "#9a8878",
        600: "#7a6a5c",
        700: "#504840",
        800: "#2a2520",
        900: "#1a1714",
        950: "#0f0d0b",
      },
      danger: {
        50: "#fef2f2",
        100: "#fee2e2",
        200: "#fecaca",
        300: "#fca5a5",
        400: "#f87171",
        500: "#ef4444",
        600: "#dc2626",
        700: "#b91c1c",
      },
      warning: {
        50: "#fffbeb",
        100: "#fef3c7",
        200: "#fde68a",
        300: "#fcd34d",
        400: "#fbbf24",
        500: "#f59e0b",
        600: "#d97706",
      },
    },
    fontFamily: {
      sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    },
  },
  shortcuts: {
    "btn":
      "inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    "btn-primary":
      "btn bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white px-5 py-2.5 min-h-11",
    "btn-ghost":
      "btn text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 px-3 py-2",
    "card":
      "rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 shadow-sm dark:shadow-none",
    "input-field":
      "w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 px-4 py-2.5 min-h-11 outline-none transition-colors duration-150 focus:border-primary-400 dark:focus:border-primary-500 focus:ring-2 focus:ring-primary-400/20 placeholder:text-surface-400 dark:placeholder:text-surface-500",
  },
});
