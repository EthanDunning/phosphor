import incrSsArkScript from "./incr-ss-ark";
import { TerminalScript } from "./types";

const TERMINAL_SCRIPTS: Record<string, TerminalScript> = {
    "incr-ss-ark": incrSsArkScript,
};

export const getTerminalScript = (scriptId?: string): TerminalScript | null => {
    if (!scriptId) {
        return null;
    }

    return TERMINAL_SCRIPTS[scriptId] || null;
};

export * from "./types";
