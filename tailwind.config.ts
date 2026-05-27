import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        baxter: {
          ink: "#0f172a",
          paper: "#f8fafc",
          accent: "#0ea5e9",
          good: "#10b981",
          warn: "#f59e0b",
          bad: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};
export default config;
