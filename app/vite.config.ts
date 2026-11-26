import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    // WebView2 already supports the shipped syntax. Keeping the final
    // esbuild transform off also avoids Windows Defender locking its temporary
    // transform files while the installer is built.
    target: "esnext",
    minify: false,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        pet: resolve(__dirname, "index.html"),
        card: resolve(__dirname, "card.html"),
        approve: resolve(__dirname, "approve.html"),
        gallery: resolve(__dirname, "gallery.html"),
        welcome: resolve(__dirname, "welcome.html"),
        overlay: resolve(__dirname, "overlay.html"),
        report: resolve(__dirname, "report.html"),
        storeroom: resolve(__dirname, "storeroom.html"),
        menu: resolve(__dirname, "menu.html"),
        tray: resolve(__dirname, "tray.html"),
        radio: resolve(__dirname, "radio.html"),
        letter: resolve(__dirname, "letter.html"),
        room: resolve(__dirname, "room.html"),
        workbench: resolve(__dirname, "workbench.html"),
        shell: resolve(__dirname, "shell.html"),
        song: resolve(__dirname, "song.html"),
      },
    },
  },
});
