export interface Theme {
    id: string;
    name: string;
    vars: Record<string, string>;
}

export interface CustomThemeConfig {
    baseThemeId: string;
    fgHex: string;
    alertHex: string;
    emphasisHex: string;
    noticeHex: string;
    hyperlinkHex: string;
    systemHex: string;
}

const sanitizeHexColor = (value: string, fallback: string): string => {
    const normalized = value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(normalized)) {
        return normalized.startsWith("#")
            ? normalized.toLowerCase()
            : `#${normalized.toLowerCase()}`;
    }

    return fallback;
};

const hexToRgb = (hex: string): [number, number, number] => {
    const safeHex = sanitizeHexColor(hex, "#000000");
    return [
        parseInt(safeHex.slice(1, 3), 16),
        parseInt(safeHex.slice(3, 5), 16),
        parseInt(safeHex.slice(5, 7), 16),
    ];
};

const rgbToCssValue = (rgb: [number, number, number]): string => {
    return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
};

const parseRgbCssValue = (value: string, fallback: [number, number, number]): [number, number, number] => {
    const match = value.match(/(\d+)\D+(\d+)\D+(\d+)/);
    if (!match) {
        return fallback;
    }

    const rgb: [number, number, number] = [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
    ];

    if (rgb.some((component) => Number.isNaN(component))) {
        return fallback;
    }

    return rgb;
};

interface AccentColorConfig {
    alertHex: string;
    emphasisHex: string;
    noticeHex: string;
    hyperlinkHex: string;
    systemHex: string;
}

const DEFAULT_ACCENT_COLORS: AccentColorConfig = {
    alertHex: "#ff3c00",
    emphasisHex: "#f39557",
    noticeHex: "#00c721",
    hyperlinkHex: "#b58cff",
    systemHex: "#15fff3",
};

const buildAccentVars = (accents: AccentColorConfig): Record<string, string> => {
    const alertRgb = hexToRgb(accents.alertHex);
    const emphasisRgb = hexToRgb(accents.emphasisHex);
    const noticeRgb = hexToRgb(accents.noticeHex);
    const hyperlinkRgb = hexToRgb(accents.hyperlinkHex);
    const systemRgb = hexToRgb(accents.systemHex);

    return {
        "--alert-rgb": rgbToCssValue(alertRgb),
        "--emphasis-rgb": rgbToCssValue(emphasisRgb),
        "--notice-rgb": rgbToCssValue(noticeRgb),
        "--hyperlink-rgb": rgbToCssValue(hyperlinkRgb),
        "--system-rgb": rgbToCssValue(systemRgb),
        "--ai-rgb": rgbToCssValue(systemRgb),
        "--alert": `rgb(${rgbToCssValue(alertRgb)})`,
        "--emphasis": `rgb(${rgbToCssValue(emphasisRgb)})`,
        "--notice": `rgb(${rgbToCssValue(noticeRgb)})`,
        "--hyperlink": `rgb(${rgbToCssValue(hyperlinkRgb)})`,
        "--system": `rgb(${rgbToCssValue(systemRgb)})`,
        "--ai": `rgb(${rgbToCssValue(systemRgb)})`,
        "--alert-glow": `0 0 5px rgba(${rgbToCssValue(alertRgb)}, 0.5)`,
        "--emphasis-glow": `0 0 5px rgba(${rgbToCssValue(emphasisRgb)}, 0.5)`,
        "--notice-glow": `0 0 5px rgba(${rgbToCssValue(noticeRgb)}, 0.5)`,
        "--hyperlink-glow": `0 0 5px rgba(${rgbToCssValue(hyperlinkRgb)}, 0.5)`,
        "--system-glow": `0 0 5px rgba(${rgbToCssValue(systemRgb)}, 0.5)`,
        "--ai-glow": `0 0 5px rgba(${rgbToCssValue(systemRgb)}, 0.5)`,
    };
};

const buildForegroundVars = (fgHex: string, bgRgb: [number, number, number]): Record<string, string> => {
    const fgRgb = hexToRgb(fgHex);
    const fgCss = rgbToCssValue(fgRgb);
    const bgCss = rgbToCssValue(bgRgb);

    return {
        "--theme-fg": `rgb(${fgCss})`,
        "--theme-fg-glow": `0 0 5px rgba(${fgCss}, 0.5)`,
        "--fg": `rgb(${fgCss})`,
        "--fg-glow": `0 0 5px rgba(${fgCss}, 0.5)`,
        "--bg-gradient": `radial-gradient(rgba(${fgCss}, 0.15), rgba(${bgCss}, 1) 100%)`,
        "--scanlines-fg": `rgba(${fgCss}, 0.1)`,
    };
};

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
        ...buildAccentVars(DEFAULT_ACCENT_COLORS),
    },
});

export const THEMES: Theme[] = [
    makeTheme("blue",  "BLUE",  [212, 250, 250], [0,  12,  12]),
    makeTheme("amber", "AMBER", [254, 145,  11], [8,   4,   0]),
    makeTheme("green", "GREEN", [ 0, 220,  0], [0,   0,   0]),
    makeTheme("white", "WHITE", [218, 218, 218], [2,   2,   2]),
];

export const DEFAULT_THEME = THEMES[0];

export const DEFAULT_CUSTOM_THEME: CustomThemeConfig = {
    baseThemeId: DEFAULT_THEME.id,
    fgHex: "#d4f9fa",
    ...DEFAULT_ACCENT_COLORS,
};

const THEME_STORAGE_KEY = "phosphor:theme:v1";
const CUSTOM_THEME_STORAGE_KEY = "phosphor:custom-theme:v1";

const sanitizeBaseThemeId = (value: string): string => {
    return THEMES.some((theme) => theme.id === value) ? value : DEFAULT_THEME.id;
};

const sanitizeCustomTheme = (customTheme: Partial<CustomThemeConfig> | null | undefined): CustomThemeConfig => {
    const legacyTheme = (customTheme || {}) as Partial<CustomThemeConfig> & { aiHex?: string };
    return {
        baseThemeId: sanitizeBaseThemeId(legacyTheme.baseThemeId || DEFAULT_CUSTOM_THEME.baseThemeId),
        fgHex: sanitizeHexColor(legacyTheme.fgHex || "", DEFAULT_CUSTOM_THEME.fgHex),
        alertHex: sanitizeHexColor(legacyTheme.alertHex || "", DEFAULT_CUSTOM_THEME.alertHex),
        emphasisHex: sanitizeHexColor(legacyTheme.emphasisHex || "", DEFAULT_CUSTOM_THEME.emphasisHex),
        noticeHex: sanitizeHexColor(legacyTheme.noticeHex || "", DEFAULT_CUSTOM_THEME.noticeHex),
        hyperlinkHex: sanitizeHexColor(legacyTheme.hyperlinkHex || "", DEFAULT_CUSTOM_THEME.hyperlinkHex),
        systemHex: sanitizeHexColor(legacyTheme.systemHex || legacyTheme.aiHex || "", DEFAULT_CUSTOM_THEME.systemHex),
    };
};

export const createCustomTheme = (customThemeInput: CustomThemeConfig): Theme => {
    const customTheme = sanitizeCustomTheme(customThemeInput);
    const baseTheme = THEMES.find((theme) => theme.id === customTheme.baseThemeId) || DEFAULT_THEME;
    const baseBg = parseRgbCssValue(baseTheme.vars["--bg"], [0, 12, 12]);
    return {
        ...baseTheme,
        id: "custom",
        name: "CUSTOM",
        vars: {
            ...baseTheme.vars,
            ...buildForegroundVars(customTheme.fgHex, baseBg),
            ...buildAccentVars(customTheme),
        },
    };
};

export const loadPersistedCustomTheme = (): CustomThemeConfig => {
    try {
        const raw = window.localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
        if (!raw) {
            return DEFAULT_CUSTOM_THEME;
        }

        const parsed = JSON.parse(raw) as Partial<CustomThemeConfig>;
        return sanitizeCustomTheme(parsed);
    } catch {
        return DEFAULT_CUSTOM_THEME;
    }
};

export const persistCustomTheme = (customTheme: CustomThemeConfig): void => {
    try {
        const safeTheme = sanitizeCustomTheme(customTheme);
        window.localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(safeTheme));
    } catch {
        // ignore
    }
};

export const loadPersistedTheme = (): Theme => {
    try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (saved === "custom") {
            const customTheme = loadPersistedCustomTheme();
            return createCustomTheme(customTheme);
        }
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
