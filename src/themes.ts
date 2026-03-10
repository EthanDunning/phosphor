export interface Theme {
    id: string;
    name: string;
    vars: Record<string, string>;
}

const makeTheme = (
    id: string,
    name: string,
    fg: [number, number, number],
    bg: [number, number, number]
): Theme => ({
    id,
    name,
    vars: {
        "--theme-fg":     `rgb(${fg[0]}, ${fg[1]}, ${fg[2]})`,
        "--theme-bg":     `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`,
        "--theme-fg-glow": `0 0 5px rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, 0.5)`,
        "--theme-bg-glow": `0 0 2px rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.5)`,
        "--fg":           `rgb(${fg[0]}, ${fg[1]}, ${fg[2]})`,
        "--bg":           `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`,
        "--fg-glow":      `0 0 5px rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, 0.5)`,
        "--bg-glow":      `0 0 2px rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.5)`,
        "--bg-gradient":  `radial-gradient(rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, 0.15), rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 1) 100%)`,
        "--scanlines-fg": `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, 0.1)`,
        "--scanlines-bg": `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.5)`,
        "--bg-20":        `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.2)`,
        "--bg-75":        `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.75)`,
        "--bg-80":        `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.8)`,
        "--bg-92":        `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.92)`,
    },
});

export const THEMES: Theme[] = [
    makeTheme("blue",  "BLUE",  [212, 249, 250], [0,  12,  12]),
    makeTheme("amber", "AMBER", [224, 125,  11], [8,   4,   0]),
    makeTheme("green", "GREEN", [ 36, 161,  20], [0,   2,   0]),
    makeTheme("white", "WHITE", [218, 218, 218], [2,   2,   2]),
];

export const DEFAULT_THEME = THEMES[0];

const THEME_STORAGE_KEY = "phosphor:theme:v1";

export const loadPersistedTheme = (): Theme => {
    try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        return THEMES.find((t) => t.id === saved) || DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
};

export const persistTheme = (theme: Theme): void => {
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme.id);
    } catch {
        // ignore
    }
};

export const applyTheme = (theme: Theme): void => {
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([key, value]) => {
        root.style.setProperty(key, value);
    });
};
