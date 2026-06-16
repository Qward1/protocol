/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Палитра через CSS-переменные (см. index.css) — единый источник для тем.
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        elevated: "rgb(var(--elevated) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-fg": "rgb(var(--accent-fg) / <alpha-value>)",
        "accent-2": "rgb(var(--accent-2) / <alpha-value>)",
      },
      borderRadius: { xl2: "0.875rem" },
      boxShadow: {
        soft: "0 1px 1px rgba(15,23,42,0.04), 0 8px 22px rgba(15,23,42,0.06)",
        card: "0 1px 2px rgba(15,23,42,0.05), 0 14px 34px -18px rgba(15,23,42,0.18)",
        glow: "0 10px 30px -12px rgb(var(--accent) / 0.55)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out both",
        "pop-in": "pop-in 0.18s ease-out both",
      },
    },
  },
  plugins: [],
};
