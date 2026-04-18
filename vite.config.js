import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: Change "k31-app" to your exact GitHub repo name
// Example: if repo is https://github.com/johndoe/my-tire-shop
// then use: base: "/my-tire-shop/"
export default defineConfig({
  plugins: [react()],
  base: "/k31-app/",
});
