// Font sizes and custom color classes for module content.
//
// Font size: `fontSize` on an element, `defaultFontSize` on a screen, a dialog
// or the module config, in points (normal terminal text is 27pt, `small` 21pt).
// The closest setting wins (element > screen / dialog > module); sizes never
// compound. Each size becomes a `phosphor-fs-<pt>` class, styled by the sheet
// buildModuleStyleSheet() generates for the module.
//
// Custom colors: `config.customColors` maps a class name to a hex color, e.g.
// { "toxic": "#88ff00" }. Any element can then use "toxic" as a color class,
// exactly like alert / notice / emphasis / system.
//
// Everything that reaches the generated CSS is validated first (whole-number
// sizes, #rrggbb colors, [a-z0-9-] names), so a module can't inject CSS.

// in pt. html is 36px (= 27pt) with a 28px line height (assets/sass/_fonts.scss)
export const FONT_SIZE_MIN = 6;
export const FONT_SIZE_MAX = 108;
export const FONT_SIZE_DEFAULT = 27;
const LINE_HEIGHT_RATIO = 28 / 36;

export const parseFontSize = (value: unknown): number | undefined => {
    const number = typeof value === "string" && value.trim().length ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) {
        return undefined;
    }
    const rounded = Math.round(number);
    if (rounded < FONT_SIZE_MIN || rounded > FONT_SIZE_MAX) {
        return undefined;
    }
    return rounded;
};

// "" for the normal size, so callers can append it unconditionally
export const getFontSizeClassName = (value: unknown): string => {
    const size = parseFontSize(value);
    return size === undefined || size === FONT_SIZE_DEFAULT ? "" : `phosphor-fs-${size}`;
};

// ---- custom colors --------------------------------------------------------------

export const CUSTOM_COLOR_NAME_MAX_LENGTH = 24;
const CUSTOM_COLOR_NAME_PATTERN = /^[a-z][a-z0-9-]{0,23}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const MAX_CUSTOM_COLORS = 32;

// class names the app already uses: a custom color can't take these
const RESERVED_CLASS_NAMES = new Set([
    "alert", "notice", "emphasis", "system", "ai", "small", "center", "title", "inline",
    "script-hidden", "footer", "cursor", "static", "content", "actions", "action",
    "monochrome", "luminosity", "screen", "lighten", "color-dodge", "difference", "exclusion",
    "hard-light", "overlay", "soft-light", "multiply", "darken", "color-burn", "hue",
    "saturation", "color", "fill-width", "phosphor", "active", "selected", "hidden", "visible",
    "fg", "bg", "left", "right", "justify",
]);

export const normalizeCustomColorName = (value: string): string => {
    return (value || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, CUSTOM_COLOR_NAME_MAX_LENGTH);
};

// null when fine, otherwise why not
export const validateCustomColorName = (name: string, existing: Record<string, string> = {}): string | null => {
    if (!name.length) {
        return "Give the color a name.";
    }
    if (!CUSTOM_COLOR_NAME_PATTERN.test(name)) {
        return "Names start with a letter and use only a-z, 0-9 and -.";
    }
    if (RESERVED_CLASS_NAMES.has(name) || name.startsWith("phosphor") || name.startsWith("text-align")) {
        return `"${name}" is already a built-in class name.`;
    }
    if (Object.prototype.hasOwnProperty.call(existing, name)) {
        return `"${name}" already exists.`;
    }
    return null;
};

export const normalizeHexColor = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    let hex = value.trim();
    if (/^#[0-9a-f]{3}$/i.test(hex)) {
        hex = "#" + hex.slice(1).split("").map((char) => char + char).join("");
    }
    return HEX_COLOR_PATTERN.test(hex) ? hex.toLowerCase() : undefined;
};

export const sanitizeCustomColors = (value: unknown): Record<string, string> => {
    const result: Record<string, string> = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return result;
    }
    Object.entries(value as Record<string, unknown>).slice(0, MAX_CUSTOM_COLORS * 2).forEach(([rawName, rawColor]) => {
        const name = typeof rawName === "string" ? rawName.trim().toLowerCase() : "";
        const color = normalizeHexColor(rawColor);
        if (!color || validateCustomColorName(name, result) || Object.keys(result).length >= MAX_CUSTOM_COLORS) {
            return;
        }
        result[name] = color;
    });
    return result;
};

const hexToRgb = (hex: string): [number, number, number] => {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

// A plain-English name for a color, for labels like "alert (red)".
export const describeHexColor = (value: unknown): string => {
    const hex = normalizeHexColor(value);
    if (!hex) {
        return "";
    }
    const [r, g, b] = hexToRgb(hex).map((channel) => channel / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    if (delta < 0.12) {
        return lightness > 0.85 ? "white" : lightness < 0.15 ? "black" : "gray";
    }
    let hue = 0;
    if (max === r) {
        hue = ((g - b) / delta) % 6;
    } else if (max === g) {
        hue = (b - r) / delta + 2;
    } else {
        hue = (r - g) / delta + 4;
    }
    hue = (hue * 60 + 360) % 360;
    if (hue < 18 || hue >= 340) return lightness < 0.3 ? "maroon" : "red";
    if (hue < 40) return lightness < 0.3 ? "brown" : "orange";
    if (hue < 65) return "yellow";
    if (hue < 160) return "green";
    if (hue < 200) return "cyan";
    if (hue < 255) return "blue";
    if (hue < 290) return "purple";
    return "pink";
};

// ---- generated stylesheet -------------------------------------------------------

const collectFontSizes = (node: unknown, sizes: Set<number>, depth = 0): void => {
    if (!node || typeof node !== "object" || depth > 12) {
        return;
    }
    if (Array.isArray(node)) {
        node.forEach((entry) => collectFontSizes(entry, sizes, depth + 1));
        return;
    }
    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
        if (key === "fontSize" || key === "defaultFontSize") {
            const size = parseFontSize(value);
            if (size !== undefined && size !== FONT_SIZE_DEFAULT) {
                sizes.add(size);
            }
        } else if (value && typeof value === "object") {
            collectFontSizes(value, sizes, depth + 1);
        }
    });
};

const round = (value: number): string => String(Math.round(value * 10000) / 10000);

export const buildModuleStyleSheet = (json: any): string => {
    const rules: string[] = [];

    const sizes = new Set<number>();
    collectFontSizes(json, sizes);
    Array.from(sizes).sort((a, b) => a - b).forEach((size) => {
        rules.push(`.phosphor .phosphor-fs-${size}{font-size:${size}pt;line-height:${round(size * LINE_HEIGHT_RATIO)}pt}`);
    });

    Object.entries(sanitizeCustomColors(json?.config?.customColors)).forEach(([name, hex]) => {
        const rgb = hexToRgb(hex).join(", ");
        rules.push(`.phosphor .${name}{color:${hex};text-shadow:0 0 5px rgba(${rgb}, 0.5)}`);
        rules.push(`.phosphor .${name} span.cursor{color:${hex};background-color:rgba(${rgb}, 0.75)}`);
    });

    return rules.join("\n");
};
