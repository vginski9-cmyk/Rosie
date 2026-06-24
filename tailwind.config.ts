import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Rosie brand palette
        ink: "#0f172a",
        rose: {
          50: "#fff1f4",
          100: "#ffe1e8",
          500: "#e11d56",
          600: "#c01649",
          700: "#9d123c",
        },
        // Funnel stage ramp (top -> bottom of funnel)
        funnel: {
          interested: "#60a5fa",
          qualified: "#38bdf8",
          offered: "#34d399",
          enrolled: "#22c55e",
          completing: "#84cc16",
          licensed: "#eab308",
          placed: "#f97316",
          productive: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};

export default config;
