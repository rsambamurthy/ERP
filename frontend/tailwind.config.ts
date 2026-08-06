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
        cream: {
          50: "#FBF8F2",
          100: "#F3ECDF",
          200: "#EDE3D3",
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
          500: "#C15A2E",
          600: "#A94A24",
          700: "#8C3B1C",
        },
      },
    },
  },
  plugins: [],
};

export default config;
