const SOUND_ENABLED_STORAGE_KEY = "phosphor:sound-enabled:v1";
const HEADER_VISIBLE_STORAGE_KEY = "phosphor:header-visible:v1";
const MODULES_BROWSER_VIEW_MODE_STORAGE_KEY = "phosphor:modules-browser:view-mode:v1";
const MODULES_BROWSER_FONT_MODE_STORAGE_KEY = "phosphor:modules-browser:font-mode:v1";
const OWN_SCRIPTS_VISIBILITY_STORAGE_KEY = "phosphor:own-scripts:visibility:v1";
const SUBSCRIBED_SCRIPTS_VISIBILITY_STORAGE_KEY = "phosphor:subscribed-scripts:visibility:v1";

export type ModulesBrowserViewMode = "retro" | "web";
export type ModulesBrowserFontMode = "retro" | "normal";

export const loadPersistedSoundEnabled = (): boolean => {
    try {
        const savedValue = window.localStorage.getItem(SOUND_ENABLED_STORAGE_KEY);
        if (savedValue === null) {
            return true;
        }

        return savedValue !== "false";
    } catch {
        return true;
    }
};

export const persistSoundEnabled = (soundEnabled: boolean): void => {
    try {
        window.localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, soundEnabled ? "true" : "false");
    } catch {
        // ignore storage write failures
    }
};

export const loadPersistedHeaderVisible = (): boolean => {
    try {
        const savedValue = window.localStorage.getItem(HEADER_VISIBLE_STORAGE_KEY);
        if (savedValue === null) {
            return true;
        }

        return savedValue !== "false";
    } catch {
        return true;
    }
};

export const persistHeaderVisible = (headerVisible: boolean): void => {
    try {
        window.localStorage.setItem(HEADER_VISIBLE_STORAGE_KEY, headerVisible ? "true" : "false");
    } catch {
        // ignore storage write failures
    }
};

export const loadPersistedModulesBrowserViewMode = (): ModulesBrowserViewMode => {
    try {
        const savedValue = window.localStorage.getItem(MODULES_BROWSER_VIEW_MODE_STORAGE_KEY);
        return savedValue === "web" ? "web" : "retro";
    } catch {
        return "retro";
    }
};

export const persistModulesBrowserViewMode = (viewMode: ModulesBrowserViewMode): void => {
    try {
        window.localStorage.setItem(MODULES_BROWSER_VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
        // ignore storage write failures
    }
};

export const loadPersistedModulesBrowserFontMode = (): ModulesBrowserFontMode => {
    try {
        const savedValue = window.localStorage.getItem(MODULES_BROWSER_FONT_MODE_STORAGE_KEY);
        return savedValue === "normal" ? "normal" : "retro";
    } catch {
        return "retro";
    }
};

export const persistModulesBrowserFontMode = (fontMode: ModulesBrowserFontMode): void => {
    try {
        window.localStorage.setItem(MODULES_BROWSER_FONT_MODE_STORAGE_KEY, fontMode);
    } catch {
        // ignore storage write failures
    }
};

export const loadPersistedOwnScriptsVisibility = (): Record<string, boolean> => {
    try {
        const raw = window.localStorage.getItem(OWN_SCRIPTS_VISIBILITY_STORAGE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }

        return Object.entries(parsed).reduce((acc: Record<string, boolean>, [moduleId, visible]) => {
            if (typeof moduleId === "string" && typeof visible === "boolean") {
                acc[moduleId] = visible;
            }
            return acc;
        }, {});
    } catch {
        return {};
    }
};

export const persistOwnScriptsVisibility = (visibilityById: Record<string, boolean>): void => {
    try {
        window.localStorage.setItem(
            OWN_SCRIPTS_VISIBILITY_STORAGE_KEY,
            JSON.stringify(visibilityById)
        );
    } catch {
        // ignore storage write failures
    }
};

export const loadPersistedSubscribedScriptsVisibility = (): Record<string, boolean> => {
    try {
        const raw = window.localStorage.getItem(SUBSCRIBED_SCRIPTS_VISIBILITY_STORAGE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }

        return Object.entries(parsed).reduce((acc: Record<string, boolean>, [moduleId, visible]) => {
            if (typeof moduleId === "string" && typeof visible === "boolean") {
                acc[moduleId] = visible;
            }
            return acc;
        }, {});
    } catch {
        return {};
    }
};

export const persistSubscribedScriptsVisibility = (visibilityById: Record<string, boolean>): void => {
    try {
        window.localStorage.setItem(
            SUBSCRIBED_SCRIPTS_VISIBILITY_STORAGE_KEY,
            JSON.stringify(visibilityById)
        );
    } catch {
        // ignore storage write failures
    }
};
