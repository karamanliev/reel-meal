import {
  defineConfig,
  presetWind,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

export default defineConfig({
  presets: [presetWind()],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  theme: {
    colors: {
      ink: "#171717",
      page: "#68efc1",
      paper: "#fffaf2",
      white: "#ffffff",
      sun: "#fdd36b",
      pink: "#ff63b7",
      blue: "#a9d0f3",
      lime: "#cdf86c",
      peach: "#ffc8a9",
      success: "#b9ef73",
      danger: "#ff9485",
      warning: "#ffd96a",
      muted: "#5e5e5e",
      mutedlight: "#8b8b8b",
    },
    fontFamily: {
      display: "'Epilogue', 'Trebuchet MS', sans-serif",
      ui: "'Epilogue', 'Trebuchet MS', sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    },
    boxShadow: {
      neo: "6px 6px 0px #171717",
      "neo-sm": "4px 4px 0px #171717",
      "neo-xs": "3px 3px 0px #171717",
      "neo-pressed": "1px 1px 0px #171717",
    },
  },
  shortcuts: {
    "neo-card":
      "rounded-[18px] border-4 border-solid border-black bg-paper shadow-neo",
    "neo-card-soft":
      "rounded-[9999px] border-4 border-solid border-black bg-white shadow-neo-sm",
    "neo-bar":
      "rounded-[16px] border-4 border-solid border-black bg-sun shadow-neo",
    "neo-subpanel":
      "rounded-[8px] border-4 border-solid border-black bg-white shadow-neo-sm",
    "neo-tag":
      "inline-flex items-center justify-center rounded-full border-2 border-ink bg-white px-3 py-1 text-[0.72rem] font-ui font-800 uppercase tracking-[0.12em] text-ink",
    "neo-btn":
      "cursor-pointer inline-flex items-center justify-center gap-2 rounded-[6px] border-3 border-solid border-black px-5 py-3 font-ui text-[0.98rem] font-700 leading-none text-ink shadow-neo-sm transition-all duration-150 active:translate-x-[2px] active:translate-y-[2px] active:shadow-neo-pressed disabled:cursor-not-allowed disabled:opacity-60 disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-neo-sm",
    "neo-btn-primary": "neo-btn bg-pink hover:bg-[#ff7fc7]",
    "neo-btn-secondary": "neo-btn bg-white hover:bg-[#fff2c6]",
    "neo-btn-blue": "neo-btn bg-blue hover:bg-[#bddbf6]",
    "neo-input":
      "w-full rounded-[6px] border-3 border-solid border-black bg-white px-4 py-3 font-ui text-base font-500 text-ink shadow-neo-sm outline-none transition-all duration-150 placeholder:text-[#6e6e6e] focus:-translate-y-[1px] focus:shadow-neo",
    "neo-microcopy": "text-sm font-ui font-500 leading-6 text-muted",
    "neo-section-title":
      "font-display text-[2rem] leading-[0.95] font-800 tracking-[-0.04em] text-ink sm:text-[2.7rem]",
  },
});
