import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { isModulesBrowserPath } from "./lib/routes";

import "./assets/sass/global.scss";

// Only one route is ever rendered per page load, so each is its own chunk.
const App = lazy(() => import("./components/App"));
const ModulesBrowser = lazy(() => import("./components/ModulesBrowser"));

const container = document.getElementById("root");

if (!container) {
    throw new Error("Root container not found");
}

const root = createRoot(container);
root.render(
    <Suspense fallback={null}>
        {isModulesBrowserPath() ? <ModulesBrowser /> : <App />}
    </Suspense>
);
