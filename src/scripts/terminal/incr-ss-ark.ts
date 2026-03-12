import { TerminalScript, TerminalScriptApi } from "./types";

const APHELION_SCREEN = "system";
const COMMS_SCREEN = "comms";
const EVACUATE_SCREEN = "evacuate";
const APHELION_STATUS_SCRIPT_ID = "aphelionCoreStatus";
const APHELION_ACTION_SCRIPT_ID = "aphelionCoreAction";
const APHELION_EYE_FOOTER_SCRIPT_ID = "aphelionEyeFooter";
const REPORT_7749C_LINK_SCRIPT_ID = "report7749cLink";
const APHELION_BOOT_START_SCREEN = "aphelion_boot_dots";
const APHELION_BOOT_COMPLETE_SCREEN = "aphelion_boot_glitch";
const APHELION_HIBERNATION_DIALOG = "aphelionHibernationBlocked";
const APHELION_BOOTED_KEY = "aphelionBooted";
const DISENGAGE_SELF_DESTRUCT_ACTION = "disengageSelfDestruct";
const SELF_DESTRUCT_COUNTDOWN_END_KEY = "selfDestructCountdownEndsAt";
const SELF_DESTRUCT_COUNTDOWN_DURATION_MS = 10 * 60 * 1000;
const SELF_DESTRUCT_COUNTDOWN_SCRIPT_ID = "selfDestructCountdownHeader";
const SCREEN_DATA_STATE_DONE = 3;
const REPORT_7749C_TEXT = "> [CORRUPTED]";
const REPORT_7749C_REDACTED_TEXT = "> [REDACTED]";
const SELF_DESTRUCT_COUNTDOWN_HEADER_CLASS = "alert self-destruct-countdown-header";
const HIDDEN_CLASS = "script-hidden";

interface EvacuateLockoutElement {
    scriptId: string;
    text: string;
    className?: string;
}

const EVACUATE_LOCKOUT_ELEMENTS: EvacuateLockoutElement[] = [
    {
        scriptId: "evacuateLockoutError",
        className: "alert",
        text: "ERROR: PRIMARY LOCKOUT INTERCEPTION",
    },
    {
        scriptId: "evacuateLockoutSpacer1",
        text: "",
    },
    {
        scriptId: "evacuateLockoutToken",
        text: "Vessel systems LOCKED by a primary command lockout token.",
    },
    {
        scriptId: "evacuateLockoutSpacer2",
        text: "",
    },
    {
        scriptId: "evacuateLockoutInterceptedStatement",
        text: "Intercepted system statement:'Destruction of this vessel is not permitted under current mission-preservation directives. Continue to destination vector. Biological payload integrity is prioritized.",
    },
    {
        scriptId: "evacuateLockoutSpacer3",
        text: "",
    },
    {
        scriptId: "evacuateLockoutDenied",
        className: "alert",
        text: "Further action denied.",
    },
    {
        scriptId: "evacuateLockoutSpacer4",
        text: "",
    },
    {
        scriptId: "evacuateLockoutCancelled",
        text: "...Detonation sequence CANCELLED.",
    },
    {
        scriptId: "evacuateLockoutSpacer5",
        text: "",
    },
];

const APHELION_EYE_FOOTER_ELEMENT = {
    type: "bitmap",
    src: "img/Aphelion_glitch.gif",
    alt: "Aphelion eye",
    className: "ai-eye-footer",
    animated: false,
    scale: 0.5,
};

let countdownIntervalId: number | null = null;

const hasAphelionBooted = (api: TerminalScriptApi): boolean => {
    return !!api.getVar<boolean>(APHELION_BOOTED_KEY)
        || api.hasVisitedScreen(APHELION_BOOT_COMPLETE_SCREEN);
};

const getCountdownEndsAt = (api: TerminalScriptApi): number | null => {
    const value = api.getVar<number>(SELF_DESTRUCT_COUNTDOWN_END_KEY);
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }

    return value;
};

const formatCountdown = (remainingMs: number): string => {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const getCountdownHeaderText = (api: TerminalScriptApi): string | null => {
    const endsAt = getCountdownEndsAt(api);
    if (endsAt === null) {
        return null;
    }

    return `DETONATION TIMER ${formatCountdown(endsAt - Date.now())}`;
};

const buildAphelionBlockedTarget = () => ([
    {
        type: "action",
        action: "dialog",
        target: APHELION_HIBERNATION_DIALOG,
    },
]);

const applyAphelionUiState = (api: TerminalScriptApi, booted: boolean): void => {
    api.patchScreenElement(APHELION_SCREEN, APHELION_STATUS_SCRIPT_ID, {
        text: booted ? "CORE MODE: AWAKE" : "CORE MODE: HIBERNATING",
    });

    api.patchScreenElement(APHELION_SCREEN, APHELION_ACTION_SCRIPT_ID, {
        text: booted ? "> SHUT DOWN" : "> AWAKEN",
        target: booted
            ? buildAphelionBlockedTarget()
            : APHELION_BOOT_START_SCREEN,
    });
};

const applyReport7749cState = (api: TerminalScriptApi, booted: boolean): void => {
    api.patchScreenElement(COMMS_SCREEN, REPORT_7749C_LINK_SCRIPT_ID, {
        text: booted ? REPORT_7749C_REDACTED_TEXT : REPORT_7749C_TEXT,
        target: booted ? buildAphelionBlockedTarget() : "report7749c",
    });
};

const syncAphelionUi = (api: TerminalScriptApi): void => {
    const booted = hasAphelionBooted(api);
    applyAphelionUiState(api, booted);
    applyReport7749cState(api, booted);
};

const applyEvacuateLockoutState = (api: TerminalScriptApi, booted: boolean): void => {
    EVACUATE_LOCKOUT_ELEMENTS.forEach((element) => {
        const className = booted
            ? (element.className || "")
            : [element.className || "", HIDDEN_CLASS].filter(Boolean).join(" ");

        api.patchScreenElement(EVACUATE_SCREEN, element.scriptId, {
            text: booted ? element.text : "",
            className,
        });
    });
};

const ensureCountdownHeaderOnAllScreens = (api: TerminalScriptApi): void => {
    const text = getCountdownHeaderText(api);
    if (!text) {
        return;
    }

    api.getScreenIds().forEach((screenId) => {
        api.ensureScreenElement(screenId, SELF_DESTRUCT_COUNTDOWN_SCRIPT_ID, {
            type: "text",
            className: SELF_DESTRUCT_COUNTDOWN_HEADER_CLASS,
            text,
        });

        api.patchScreenElement(screenId, SELF_DESTRUCT_COUNTDOWN_SCRIPT_ID, {
            text,
            className: SELF_DESTRUCT_COUNTDOWN_HEADER_CLASS,
            state: SCREEN_DATA_STATE_DONE,
        });
    });
};

const removeCountdownHeaderFromAllScreens = (api: TerminalScriptApi): void => {
    api.getScreenIds().forEach((screenId) => {
        api.removeScreenElement(screenId, SELF_DESTRUCT_COUNTDOWN_SCRIPT_ID);
    });
};

const stopCountdownTicker = (): void => {
    if (countdownIntervalId === null) {
        return;
    }

    window.clearInterval(countdownIntervalId);
    countdownIntervalId = null;
};

const tickCountdown = (api: TerminalScriptApi): void => {
    const endsAt = getCountdownEndsAt(api);
    if (endsAt === null) {
        removeCountdownHeaderFromAllScreens(api);
        stopCountdownTicker();
        return;
    }

    ensureCountdownHeaderOnAllScreens(api);
    if (Date.now() >= endsAt) {
        stopCountdownTicker();
    }
};

const startCountdownTicker = (api: TerminalScriptApi): void => {
    if (countdownIntervalId !== null) {
        return;
    }

    countdownIntervalId = window.setInterval(() => {
        tickCountdown(api);
    }, 1000);
};

const startCountdownIfNeeded = (api: TerminalScriptApi): void => {
    if (getCountdownEndsAt(api) !== null) {
        return;
    }

    api.setVar(SELF_DESTRUCT_COUNTDOWN_END_KEY, Date.now() + SELF_DESTRUCT_COUNTDOWN_DURATION_MS);
};

const disengageSelfDestruct = (api: TerminalScriptApi): void => {
    stopCountdownTicker();
    api.deleteVar(SELF_DESTRUCT_COUNTDOWN_END_KEY);
    removeCountdownHeaderFromAllScreens(api);
};

const shouldShowAphelionFooterOnScreen = (screenId: string): boolean => {
    return screenId !== APHELION_BOOT_COMPLETE_SCREEN;
};

const ensureAphelionFooterOnScreen = (api: TerminalScriptApi, screenId: string): void => {
    if (!shouldShowAphelionFooterOnScreen(screenId)) {
        api.removeScreenElement(screenId, APHELION_EYE_FOOTER_SCRIPT_ID);
        return;
    }

    api.ensureScreenElement(screenId, APHELION_EYE_FOOTER_SCRIPT_ID, APHELION_EYE_FOOTER_ELEMENT);
};

const ensureAphelionFooterOnAllScreens = (api: TerminalScriptApi): void => {
    api.getScreenIds().forEach((screenId) => {
        ensureAphelionFooterOnScreen(api, screenId);
    });
};

const removeAphelionFooterFromAllScreens = (api: TerminalScriptApi): void => {
    api.getScreenIds().forEach((screenId) => {
        api.removeScreenElement(screenId, APHELION_EYE_FOOTER_SCRIPT_ID);
    });
};

const incrSsArkScript: TerminalScript = {
    onMount: (api) => {
        stopCountdownTicker();

        const booted = api.hasVisitedScreen(APHELION_BOOT_COMPLETE_SCREEN);
        if (booted) {
            api.setVar(APHELION_BOOTED_KEY, true);
        } else {
            api.deleteVar(APHELION_BOOTED_KEY);
            removeAphelionFooterFromAllScreens(api);
        }

        syncAphelionUi(api);
        applyEvacuateLockoutState(api, booted);

        if (getCountdownEndsAt(api) === null) {
            removeCountdownHeaderFromAllScreens(api);
        } else {
            tickCountdown(api);
        }

        if (booted) {
            ensureAphelionFooterOnAllScreens(api);
        }
    },

    onScreenChanged: (screenId, api) => {
        if (screenId === APHELION_BOOT_COMPLETE_SCREEN) {
            api.setVar(APHELION_BOOTED_KEY, true);
            ensureAphelionFooterOnAllScreens(api);
        }

        syncAphelionUi(api);
        const booted = hasAphelionBooted(api);
        applyEvacuateLockoutState(api, booted);

        if (!booted && screenId === EVACUATE_SCREEN) {
            startCountdownIfNeeded(api);
        }

        const countdownEndsAt = getCountdownEndsAt(api);
        if (countdownEndsAt === null) {
            removeCountdownHeaderFromAllScreens(api);
            stopCountdownTicker();
        } else {
            tickCountdown(api);
            if (countdownEndsAt > Date.now()) {
                startCountdownTicker(api);
            } else {
                stopCountdownTicker();
            }
        }

        if (booted) {
            ensureAphelionFooterOnScreen(api, screenId);
        }
    },

    onAction: (action, target, meta, api) => {
        void meta;
        if (action === DISENGAGE_SELF_DESTRUCT_ACTION) {
            disengageSelfDestruct(api);
            if (target) {
                api.changeScreen(target);
            }
            return true;
        }

        if (action !== "resetState") {
            return false;
        }

        disengageSelfDestruct(api);
        api.deleteVar(APHELION_BOOTED_KEY);
        syncAphelionUi(api);
        applyEvacuateLockoutState(api, false);
        removeAphelionFooterFromAllScreens(api);
        return false;
    },
};

export default incrSsArkScript;
