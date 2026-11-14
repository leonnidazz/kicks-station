module.exports = {
  content: ["./admin.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
      colors: {
        brand: { 50: "#f6f7f9", 100: "#eceef2", 900: "#0f172a", 950: "#020617" },
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.03)",
        "glass-hover": "0 12px 48px 0 rgba(0, 0, 0, 0.06)",
        float: "0 20px 40px -10px rgba(0,0,0,0.08)",
      },
    },
  },
};