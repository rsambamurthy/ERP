import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#E6F1FB",
          100: "#B5D4F4",
          200: "#85B7EB",
          400: "#378ADD",
          600: "#185FA5",
          800: "#0C447C",
          900: "#042C53",
        },
        // Exact values from SmartAppt Gold's actual login screen (src/pages/LoginPage.tsx,
        // the `T` theme-colours object) — public auth pages only.
        cream: {
          50: "#FDF8F5",   // pinBg
          100: "#F5F0E5",  // cream
          200: "#E8D9C0",  // creamBorder
          300: "#DDD0C8",  // inputBorder
        },
        navy: {
          600: "#2A3B5F",
          700: "#22314F",
          800: "#1E2A44",
          900: "#161F33",
        },
        terracotta: {
          50: "#FBEEE7",
          100: "#F3D6C4",
          400: "#D4712F",
          500: "#C4572B",  // T.primary
          600: "#9C3F1E",  // T.primaryDark
          700: "#8A6050",  // T.labelColor
        },
      },
    },
  },
  plugins: [],
};

export default config;
