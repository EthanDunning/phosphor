// Scripts (including community modules) are untrusted, so every URL they hand
// us is checked against an allowlist of schemes before it reaches the DOM or
// window.open. Parsing with the URL constructor (rather than a regex on the
// raw string) matters: browsers strip tabs/newlines/control characters before
// resolving a URL, so "java\tscript:" would slip past a naive regex.

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

// Returns the URL (as written) when it's safe to use as a link, else null.
// Relative URLs resolve against the current page, so they're allowed.
export const toSafeLinkUrl = (value: unknown): string | null => {
    if (typeof value !== "string") {
        return null;
    }

    const raw = value.trim();
    if (!raw.length || CONTROL_CHARS.test(raw)) {
        return null;
    }

    try {
        const parsed = new URL(raw, window.location.href);
        return SAFE_PROTOCOLS.has(parsed.protocol) ? raw : null;
    } catch {
        return null;
    }
};

// Open an external link from script data in a new tab, without giving the
// opened page a handle on this window (reverse tabnabbing).
export const openExternalUrl = (value: unknown): boolean => {
    const safe = toSafeLinkUrl(value);
    if (!safe) {
        return false;
    }

    const resolved = new URL(safe, window.location.href).href;
    window.open(resolved, "_blank", "noopener,noreferrer");
    return true;
};
