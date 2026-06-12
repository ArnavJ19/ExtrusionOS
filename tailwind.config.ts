import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-outfit)", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
      colors: {
        charcoal: "#111111",
        aluminium: "#F3F3F4",
        orange: "#8B5CF6",
        graphite: "#2F3137"
      },
      boxShadow: {
        industrial: "0 18px 45px rgba(17, 17, 17, 0.035)",
        premium: "0 22px 50px rgba(17, 17, 17, 0.06)",
        insetLine: "inset 0 1px 0 rgba(255, 255, 255, 0.72)"
      }
    }
  },
  plugins: []
};

export default config;
