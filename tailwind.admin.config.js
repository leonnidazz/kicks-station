module.exports = {
  content: ["./admin.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Archivo", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
      colors: {
        brand: { 50: "#fafafa", 100: "#f5f5f5", 900: "#171717", 950: "#000000" },
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.03)",
        "glass-hover": "0 12px 48px 0 rgba(0, 0, 0, 0.06)",
        float: "0 20px 40px -10px rgba(0,0,0,0.08)",
      },
    },
  },
};