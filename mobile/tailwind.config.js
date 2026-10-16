/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "media",
  theme: {
    extend: {
      // Surette palette, mirrored from web/src/app/globals.css (light / dark pairs via `dark:`).
      colors: {
        ivory: { DEFAULT: "#F7F4EE", dark: "#0D0C0A" },
        paper: { DEFAULT: "#FFFDF9", dark: "#16140F" },
        ink: { DEFAULT: "#15130F", dark: "#F3EFE7" },
        ink2: { DEFAULT: "#5D574D", dark: "#B5AD9F" },
        ink3: { DEFAULT: "#8C8579", dark: "#8A8377" },
        line: { DEFAULT: "#E6E1D8", dark: "#2A2722" },
        fill: { DEFAULT: "#EFEBE3", dark: "#211E19" },
        gold: { DEFAULT: "#A67C3D", dark: "#D2A965" },
        danger: { DEFAULT: "#B42318", dark: "#FF8A80" },
        success: { DEFAULT: "#1E6B3A", dark: "#6FD394" },
        warn: { DEFAULT: "#8A5300", dark: "#FFC266" },
      },
    },
  },
  plugins: [],
};
