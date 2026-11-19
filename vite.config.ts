import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vendor code changes far less often than app code, so it gets its own
// long-cached chunks instead of being re-downloaded with every deploy.
const vendorChunk = (id: string): string | undefined => {
    if (!id.includes("node_modules")) {
        return undefined;
    }
    if (id.includes("@supabase")) {
        return "supabase";
    }
    if (/[\/]node_modules[\/](react|react-dom|scheduler)[\/]/.test(id)) {
        return "react";
    }
    return undefined;
};

export default defineConfig(({ command }) => ({
    base: command === "build" ? "/phosphor/" : "/",
    plugins: [react()],
    build: {
        outDir: "build",
        rollupOptions: {
            output: {
                manualChunks: vendorChunk,
            },
        },
    },
    server: {
        port: 3000,
    }
}));
