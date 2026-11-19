import incrSsArkScript from "./incr-ss-ark";
import gradientDescentTerminalScript from "./gradient-descent-terminal";
import aphelionMainframeScript from "./aphelion-mainframe";
import { TerminalScript } from "./types";

const TERMINAL_SCRIPTS: Record<string, TerminalScript> = {
    "aphelion-mainframe": aphelionMainframeScript,
    "gradient-descent-terminal": gradientDescentTerminalScript,
    "incr-ss-ark": incrSsArkScript,
};

export const getTerminalScript = (scriptId?: string): TerminalScript | null => {
    if (!scriptId) {
        return null;
    }

    return Object.prototype.hasOwnProperty.call(TERMINAL_SCRIPTS, scriptId)
        ? TERMINAL_SCRIPTS[scriptId]
        : null;
};

export * from "./types";
