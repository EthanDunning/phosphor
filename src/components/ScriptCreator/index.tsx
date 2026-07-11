import React, { FC, useEffect, useId, useMemo, useRef, useState } from "react";
import "./style.scss";
import {
    THEMES,
    DEFAULT_CUSTOM_THEME,
    CustomThemeConfig,
    sanitizeCustomTheme,
} from "../../themes";

interface ScriptCreatorScriptOption {
    id: string;
    label: string;
    json: any;
    canSaveModule: boolean;
}

interface ScriptCreatorProps {
    open: boolean;
    initialScript: any;
    initialScriptId: string;
    availableScripts: ScriptCreatorScriptOption[];
    onApply: (scriptJson: any) => void;
    onPreview: (
        scriptJson: any,
        screenId: string,
        elementIndex: number,
        sidebarListMode: "screens" | "dialogs"
    ) => void;
    onClose: (scriptJson?: any) => void;
    onDeleteLocalScript?: (scriptId: string) => Promise<boolean> | boolean;
    onSaveModule?: (scriptJson: any) => Promise<boolean> | boolean;
}

interface CreatorSelectionSnapshot {
    activeView: "editor" | "schema";
    configPanelVisible: boolean;
    elementEditorMode: "fields" | "raw";
    screenEditorMode: "fields" | "raw";
    screenControlsOpen: boolean;
    schemaRootId: string;
    screenIdDraft: string;
    selectedDialogContentIndex: number;
    selectedDialogFocusId: string;
    selectedElementIndex: number;
    selectedScreenId: string;
    sidebarListMode: "screens" | "dialogs";
}

type AddableElementType =
    "plainText"
    | "text"
    | "alertText"
    | "noticeText"
    | "emphasisText"
    | "systemText"
    | "link"
    | "bitmap"
    | "prompt"
    | "login"
    | "toggle"
    | "list"
    | "dropdown"
    | "reportComposer"
    | "reportList"
    | "dialogLink";

interface AddableElementOption {
    value: AddableElementType;
    label: string;
}

interface CreatorSelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

interface CreatorSelectProps {
    value: string;
    options: CreatorSelectOption[];
    onChange: (nextValue: string) => void;
    className?: string;
    disabled?: boolean;
    fallbackLabel?: string;
    searchable?: boolean;
    editable?: boolean; // combobox: free typing + filter-as-you-type over the options
    placeholder?: string;
}

type CreatorColorMode = "theme" | "dark" | "light";
type CyclerStateBehavior = "none" | "link" | "action" | "dialog";
type LinkTargetType = "link" | "dialog" | "action" | "href";
type PromptActionType = "link" | "dialog" | "action" | "console" | "logEntry" | "input";

interface LinkTargetEntry {
    type: LinkTargetType;
    target: string;
    shiftKey: boolean;
    action?: string;
}

interface PromptActionEntry {
    type: PromptActionType;
    target?: string;
    action?: string;
}

interface PromptCommandEntry {
    command: string;
    action: PromptActionEntry;
}

interface LoginCredentialEntry {
    username: string;
    password: string;
    target: string;
}

type ScriptSearchMatchKind = "screen" | "element" | "dialog" | "dialogContent";
type PendingSearchSelectionMode = "first" | "last" | number;

interface SearchOccurrenceRange {
    start: number;
    end: number;
}

interface ScriptSearchMatch {
    id: string;
    kind: ScriptSearchMatchKind;
    title: string;
    excerpt: string;
    matchCount: number;
    screenId?: string;
    elementIndex?: number;
    dialogId?: string;
    dialogContentIndex?: number;
}

interface EditorSearchOccurrence {
    element: HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement;
    start: number;
    end: number;
    selectable: boolean;
}

interface IndexedLabeledEntry {
    entry: any;
    index: number;
    label: string;
}

const CREATOR_COLOR_MODE_LABELS: Record<CreatorColorMode, string> = {
    theme: "THEME",
    dark: "DARK",
    light: "LIGHT",
};

const CYCLER_STATE_BEHAVIOR_OPTIONS: CreatorSelectOption[] = [
    { value: "none", label: "none" },
    { value: "link", label: "link" },
    { value: "action", label: "action" },
    { value: "dialog", label: "dialog" },
];

const LINK_TARGET_TYPE_OPTIONS: CreatorSelectOption[] = [
    { value: "link", label: "link" },
    { value: "dialog", label: "dialog" },
    { value: "action", label: "action" },
    { value: "href", label: "href" },
];

const PROMPT_ACTION_TYPE_OPTIONS: CreatorSelectOption[] = [
    { value: "link", label: "link" },
    { value: "dialog", label: "dialog" },
    { value: "action", label: "action" },
    { value: "console", label: "console" },
    { value: "logEntry", label: "logEntry" },
    { value: "input", label: "input" },
];

const DEFAULT_SIDEBAR_WIDTH = 340;
const MIN_SIDEBAR_WIDTH = 220;
const MIN_EDITOR_WIDTH = 360;
const RESIZE_HANDLE_WIDTH = 8;
interface MarkdownShortcut {
    wrapper: string;
    requiresShift?: boolean;
}

const MARKDOWN_SHORTCUTS: Record<string, MarkdownShortcut> = {
    b: { wrapper: "**" },
    i: { wrapper: "*" },
    u: { wrapper: "__" },
    x: { wrapper: "~~", requiresShift: true },
};
const SEARCHABLE_INPUT_TYPES = new Set(["", "text", "search", "url", "email", "tel", "password"]);
const EDITOR_SEARCH_SELECTOR = [
    "input:not([type])",
    "input[type=\"text\"]",
    "input[type=\"search\"]",
    "input[type=\"url\"]",
    "input[type=\"email\"]",
    "input[type=\"tel\"]",
    "input[type=\"password\"]",
    "textarea",
    "button.script-creator-select__trigger[data-searchable-select=\"true\"]",
].join(", ");

const isSearchableInputType = (type: string): boolean => {
    return SEARCHABLE_INPUT_TYPES.has(type.toLowerCase());
};

const getCyclerStateBehavior = (state: any): CyclerStateBehavior => {
    if (typeof state?.action === "string" && state.action.trim().length) {
        return "action";
    }
    if (typeof state?.dialog === "string" && state.dialog.trim().length) {
        return "dialog";
    }
    if (typeof state?.target === "string" && state.target.trim().length) {
        return "link";
    }
    return "none";
};

const normalizeCyclerStates = (states: any[], fallbackLabel: string): any[] => {
    const source = Array.isArray(states) ? states : [];
    const normalized = source.map((entry: any, index: number) => {
        if (typeof entry === "string") {
            return {
                text: entry,
                active: index === 0,
            };
        }

        if (!entry || typeof entry !== "object") {
            return {
                text: `${fallbackLabel} ${index + 1}`,
                active: index === 0,
            };
        }

        const next: any = {
            text: typeof entry.text === "string" ? entry.text : `${fallbackLabel} ${index + 1}`,
            active: !!entry.active,
        };

        if (typeof entry.className === "string") {
            next.className = entry.className;
        }
        if (typeof entry.target === "string") {
            next.target = entry.target;
        }
        if (typeof entry.action === "string") {
            next.action = entry.action;
        }
        if (typeof entry.dialog === "string") {
            next.dialog = entry.dialog;
        }
        if (entry.requireShift === true) {
            next.requireShift = true;
        }

        return next;
    });

    if (!normalized.length) {
        return [{ text: `${fallbackLabel} 1`, active: true }];
    }

    let hasActive = false;
    normalized.forEach((state) => {
        if (!hasActive && state.active) {
            hasActive = true;
            state.active = true;
            return;
        }
        state.active = false;
    });
    if (!hasActive) {
        normalized[0].active = true;
    }

    return normalized;
};

const asLinkTargetType = (value: any, fallbackType: LinkTargetType): LinkTargetType => {
    if (typeof value !== "string") {
        return fallbackType;
    }

    const normalized = value.toLowerCase();
    if (normalized === "link" || normalized === "dialog" || normalized === "action" || normalized === "href") {
        return normalized;
    }
    return fallbackType;
};

const normalizeLinkTargets = (
    rawTarget: any,
    fallbackType: LinkTargetType,
    fallbackTarget: string
): LinkTargetEntry[] => {
    const normalizeOne = (entry: any): LinkTargetEntry | null => {
        if (!entry || typeof entry !== "object") {
            return null;
        }

        const type = asLinkTargetType(entry.type, fallbackType);
        const target = typeof entry.target === "string" ? entry.target : "";
        const action = typeof entry.action === "string" ? entry.action : undefined;
        return {
            type,
            target,
            shiftKey: !!entry.shiftKey,
            action,
        };
    };

    const fromString = (target: string): LinkTargetEntry[] => ([
        {
            type: fallbackType,
            target,
            shiftKey: false,
        },
    ]);

    if (typeof rawTarget === "string") {
        return fromString(rawTarget);
    }

    if (Array.isArray(rawTarget)) {
        const normalized = rawTarget
            .map(normalizeOne)
            .filter((entry: LinkTargetEntry | null): entry is LinkTargetEntry => !!entry);
        if (normalized.length) {
            return normalized;
        }
    } else {
        const one = normalizeOne(rawTarget);
        if (one) {
            return [one];
        }
    }

    return fromString(fallbackTarget);
};

const serializeLinkTargets = (
    entries: LinkTargetEntry[],
    fallbackType: LinkTargetType
): string | Array<Record<string, any>> => {
    const cleaned = entries
        .map((entry) => {
            const type = asLinkTargetType(entry.type, fallbackType);
            const target = (entry.target || "").trim();
            const shiftKey = !!entry.shiftKey;

            if (type === "action") {
                const action = (entry.action || "").trim();
                if (!action.length && !target.length) {
                    return null;
                }

                const next: Record<string, any> = {
                    type: "action",
                    action: action.length ? action : "resetState",
                };
                if (target.length) {
                    next.target = target;
                }
                if (shiftKey) {
                    next.shiftKey = true;
                }
                return next;
            }

            if (!target.length) {
                return null;
            }

            const next: Record<string, any> = {
                type,
                target,
            };
            if (shiftKey) {
                next.shiftKey = true;
            }
            return next;
        })
        .filter((entry): entry is Record<string, any> => !!entry);

    if (!cleaned.length) {
        return "";
    }

    if (
        cleaned.length === 1
        && cleaned[0].type === fallbackType
        && cleaned[0].shiftKey !== true
        && cleaned[0].type !== "action"
        && typeof cleaned[0].target === "string"
    ) {
        return cleaned[0].target;
    }

    return cleaned;
};

const asPromptActionType = (value: any, fallbackType: PromptActionType = "link"): PromptActionType => {
    if (typeof value !== "string") {
        return fallbackType;
    }

    const normalized = value.trim();
    if (
        normalized === "link"
        || normalized === "dialog"
        || normalized === "action"
        || normalized === "console"
        || normalized === "logEntry"
        || normalized === "input"
    ) {
        return normalized;
    }

    return fallbackType;
};

const normalizePromptAction = (rawAction: any, fallbackTarget: string): PromptActionEntry => {
    const action = rawAction && typeof rawAction === "object" ? rawAction : {};
    const type = asPromptActionType(action.type, "link");
    const nextAction: PromptActionEntry = { type };

    if (typeof action.target === "string") {
        nextAction.target = action.target;
    } else if ((type === "link" || type === "dialog") && fallbackTarget.length) {
        nextAction.target = fallbackTarget;
    }

    if (typeof action.action === "string") {
        nextAction.action = action.action;
    } else if (type === "action") {
        nextAction.action = "resetState";
    }

    return nextAction;
};

const normalizePromptCommands = (rawCommands: any, fallbackTarget: string): PromptCommandEntry[] => {
    if (!Array.isArray(rawCommands)) {
        return [];
    }

    return rawCommands
        .map((entry: any, index: number): PromptCommandEntry | null => {
            if (!entry || typeof entry !== "object") {
                return null;
            }

            const command = typeof entry.command === "string"
                ? entry.command
                : `command${index + 1}`;

            return {
                command,
                action: normalizePromptAction(entry.action, fallbackTarget),
            };
        })
        .filter((entry: PromptCommandEntry | null): entry is PromptCommandEntry => !!entry);
};

const normalizeLoginCredentials = (rawCredentials: any, fallbackTarget: string): LoginCredentialEntry[] => {
    if (!Array.isArray(rawCredentials)) {
        return [];
    }

    return rawCredentials
        .map((entry: any, index: number): LoginCredentialEntry | null => {
            if (!entry || typeof entry !== "object") {
                return null;
            }

            const username = typeof entry.username === "string"
                ? entry.username
                : `user${index + 1}`;
            const password = typeof entry.password === "string"
                ? entry.password
                : "";
            let target = typeof entry.target === "string" ? entry.target : "";

            if (!target.length && entry.action && typeof entry.action === "object") {
                const actionType = asPromptActionType(entry.action.type, "link");
                if (actionType === "link" && typeof entry.action.target === "string") {
                    target = entry.action.target;
                }
            }

            if (!target.length) {
                target = fallbackTarget;
            }

            return {
                username,
                password,
                target,
            };
        })
        .filter((entry: LoginCredentialEntry | null): entry is LoginCredentialEntry => !!entry);
};

const removeDialogTargetsFromElement = (entry: any, dialogId: string): any => {
    if (!entry || typeof entry !== "object") {
        return entry;
    }

    const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
    if (type !== "link" && type !== "href") {
        return entry;
    }

    const fallbackType: LinkTargetType = type === "href" ? "href" : "link";
    const normalized = normalizeLinkTargets(entry.target, fallbackType, "");
    const filtered = normalized.filter((targetEntry) => {
        return !(targetEntry.type === "dialog" && targetEntry.target === dialogId);
    });
    const nextTarget = serializeLinkTargets(filtered, fallbackType);

    return {
        ...entry,
        target: nextTarget,
    };
};

const replaceDialogTargetsInElement = (entry: any, fromDialogId: string, toDialogId: string): any => {
    if (!entry || typeof entry !== "object") {
        return entry;
    }

    const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
    if (type !== "link" && type !== "href") {
        return entry;
    }

    const fallbackType: LinkTargetType = type === "href" ? "href" : "link";
    const normalized = normalizeLinkTargets(entry.target, fallbackType, "");
    const nextTargets = normalized.map((targetEntry) => {
        if (targetEntry.type !== "dialog" || targetEntry.target !== fromDialogId) {
            return targetEntry;
        }
        return {
            ...targetEntry,
            target: toDialogId,
        };
    });
    const nextTarget = serializeLinkTargets(nextTargets, fallbackType);

    return {
        ...entry,
        target: nextTarget,
    };
};

const getNextCreatorColorMode = (mode: CreatorColorMode): CreatorColorMode => {
    if (mode === "theme") {
        return "dark";
    }
    if (mode === "dark") {
        return "light";
    }
    return "theme";
};

const CreatorSelect: FC<CreatorSelectProps> = ({
    value,
    options,
    onChange,
    className,
    disabled = false,
    fallbackLabel,
    searchable = false,
    editable = false,
    placeholder,
}) => {
    const [open, setOpen] = useState<boolean>(false);
    const [filtering, setFiltering] = useState<boolean>(false);
    const [highlight, setHighlight] = useState<number>(-1);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listboxId = useId();
    const selectedOption = options.find((option) => option.value === value) || null;

    useEffect(() => {
        const onDocumentMouseDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target || !rootRef.current || rootRef.current.contains(target)) {
                return;
            }
            setOpen(false);
        };
        document.addEventListener("mousedown", onDocumentMouseDown);
        return () => {
            document.removeEventListener("mousedown", onDocumentMouseDown);
        };
    }, []);

    useEffect(() => {
        if (disabled) {
            setOpen(false);
        }
    }, [disabled]);

    // Combobox mode: a text input you can type freely into, backed by a
    // filter-as-you-type dropdown of the options (used for target fields so you
    // can either type any id or pick an existing screen/dialog).
    if (editable) {
        const query = (value || "").toLowerCase();
        const filteredOptions = (filtering && query.length)
            ? options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(query))
            : options;

        const selectOption = (option: CreatorSelectOption) => {
            if (option.disabled) {
                return;
            }
            onChange(option.value);
            setOpen(false);
            setFiltering(false);
            setHighlight(-1);
        };

        return (
            <div
                ref={rootRef}
                className={
                    "script-creator-select script-creator-select--editable"
                    + (open ? " script-creator-select--open" : "")
                    + (disabled ? " script-creator-select--disabled" : "")
                    + (className ? ` ${className}` : "")
                }
            >
                <div className="script-creator-select__field">
                    <input
                        ref={inputRef}
                        type="text"
                        className="script-creator-select__input"
                        value={value}
                        placeholder={placeholder}
                        disabled={disabled}
                        role="combobox"
                        aria-expanded={open}
                        aria-controls={listboxId}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => {
                            onChange(event.target.value);
                            setOpen(true);
                            setFiltering(true);
                            setHighlight(0);
                        }}
                        onFocus={() => {
                            setOpen(true);
                            setFiltering(false);
                            setHighlight(-1);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                if (!open) {
                                    setOpen(true);
                                    setFiltering(false);
                                    setHighlight(0);
                                    return;
                                }
                                setHighlight((prev) => Math.min(filteredOptions.length - 1, prev + 1));
                            } else if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setHighlight((prev) => Math.max(0, prev - 1));
                            } else if (event.key === "Enter") {
                                if (open && highlight >= 0 && highlight < filteredOptions.length) {
                                    event.preventDefault();
                                    selectOption(filteredOptions[highlight]);
                                } else {
                                    setOpen(false);
                                }
                            } else if (event.key === "Escape") {
                                setOpen(false);
                            }
                        }}
                    />
                    {!disabled && options.length > 0 && (
                        <button
                            type="button"
                            tabIndex={-1}
                            aria-label="Show options"
                            className="script-creator-select__caret script-creator-select__caret--btn"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                                setFiltering(false);
                                setHighlight(-1);
                                setOpen((prev) => !prev);
                                if (inputRef.current) {
                                    inputRef.current.focus();
                                }
                            }}
                        >
                            ▼
                        </button>
                    )}
                </div>

                {open && filteredOptions.length > 0 && (
                    <div id={listboxId} role="listbox" className="script-creator-select__menu">
                        {filteredOptions.map((option, index) => {
                            const isActive = option.value === value;
                            const isHighlighted = index === highlight;
                            return (
                                <button
                                    key={`${option.value}:${index}`}
                                    type="button"
                                    role="option"
                                    aria-selected={isActive}
                                    disabled={option.disabled}
                                    className={
                                        "script-creator-select__option"
                                        + ((isActive || isHighlighted) ? " script-creator-select__option--active" : "")
                                    }
                                    onMouseEnter={() => setHighlight(index)}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => selectOption(option)}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    const triggerLabel = selectedOption?.label || fallbackLabel || value || "(none)";
    const showCaret = !disabled && options.length > 0;

    return (
        <div
            ref={rootRef}
            className={
                "script-creator-select"
                + (open ? " script-creator-select--open" : "")
                + (disabled ? " script-creator-select--disabled" : "")
                + (className ? ` ${className}` : "")
            }
        >
            <button
                type="button"
                className="script-creator-select__trigger"
                data-searchable-select={searchable ? "true" : undefined}
                aria-haspopup="listbox"
                aria-controls={listboxId}
                aria-expanded={open}
                disabled={disabled}
                onClick={() => {
                    if (!options.length) {
                        return;
                    }
                    setOpen((prev) => !prev);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        setOpen(false);
                        return;
                    }

                    if ((event.key === "Enter" || event.key === " " || event.key === "ArrowDown") && options.length) {
                        event.preventDefault();
                        setOpen((prev) => !prev);
                    }
                }}
            >
                <span>{triggerLabel}</span>
                {showCaret && <span className="script-creator-select__caret">▼</span>}
            </button>

            {open && (
                <div id={listboxId} role="listbox" className="script-creator-select__menu">
                    {options.map((option) => {
                        const isActive = option.value === value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={isActive}
                                disabled={option.disabled}
                                className={
                                    "script-creator-select__option"
                                    + (isActive ? " script-creator-select__option--active" : "")
                                }
                                onClick={() => {
                                    if (option.disabled) {
                                        return;
                                    }
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const ADDABLE_ELEMENT_OPTIONS: AddableElementOption[] = [
    { value: "plainText", label: "Text Line" },
    { value: "text", label: "Text Block" },
    { value: "alertText", label: "Alert Text" },
    { value: "noticeText", label: "Notice Text" },
    { value: "emphasisText", label: "Emphasis Text" },
    { value: "systemText", label: "System Text" },
    { value: "link", label: "Link Button" },
    { value: "bitmap", label: "Bitmap/Image" },
    { value: "prompt", label: "Prompt Input" },
    { value: "login", label: "Login Prompt" },
    { value: "toggle", label: "Toggle" },
    { value: "list", label: "List" },
    { value: "dropdown", label: "Dropdown" },
    { value: "reportComposer", label: "Report Composer" },
    { value: "reportList", label: "Report List" },
    { value: "dialogLink", label: "Dialog Link (+ Dialog)" },
];

const TEXT_CLASSNAME_OPTIONS = [
    "",
    "alert",
    "notice",
    "emphasis",
    "system",
    "center",
    "title",
    "small",
    "script-hidden",
];

const LINK_CLASSNAME_OPTIONS = [
    "",
    "alert",
    "inline",
    "center",
    "small",
    "script-hidden",
];

const PROMPT_CLASSNAME_OPTIONS = [
    "",
    "alert",
    "notice",
    "emphasis",
    "system",
    "small",
    "script-hidden",
];

const CYCLER_CLASSNAME_OPTIONS = [
    "",
    "alert",
    "notice",
    "emphasis",
    "system",
    "small",
    "script-hidden",
];

const BITMAP_CLASSNAME_OPTIONS = [
    "",
    "footer",
    "monochrome",
    "luminosity",
    "light",
    "lighten",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
];

const SCREEN_TYPE_OPTIONS: CreatorSelectOption[] = [
    { value: "screen", label: "screen" },
    { value: "static", label: "static" },
    { value: "filesystem", label: "file system" },
];

const SCRIPT_THEME_OPTIONS: CreatorSelectOption[] = [
    { value: "", label: "(use app theme)" },
    ...THEMES.map((theme) => ({ value: theme.id, label: theme.name })),
    { value: "custom", label: "CUSTOM" },
];

const CUSTOM_THEME_BASE_OPTIONS: CreatorSelectOption[] = THEMES.map((theme) => ({
    value: theme.id,
    label: theme.name,
}));

const DIALOG_TYPE_OPTIONS: CreatorSelectOption[] = [
    { value: "alert", label: "alert" },
    { value: "confirm", label: "confirm" },
    { value: "dialog", label: "dialog" },
];

const BOOLEAN_OPTIONS: CreatorSelectOption[] = [
    { value: "false", label: "false" },
    { value: "true", label: "true" },
];

const PHOSPHOR_DEFAULT_TEXT_SPEED_MS = 20;

const TEXT_LINE_STYLE_OPTIONS: CreatorSelectOption[] = [
    { value: "", label: "(unstyled text line)" },
    ...TEXT_CLASSNAME_OPTIONS
        .filter((option) => option.length > 0)
        .map((option) => ({ value: option, label: option })),
];

const TEXT_ALIGN_OPTIONS: CreatorSelectOption[] = [
    { value: "left", label: "Left (default)" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
    { value: "justify", label: "Justify" },
];

const createDefaultScript = (): {
    config: { name: string; author: string };
    screens: Array<{ id: string; type: string; content: any[] }>;
    dialogs: any[];
} => ({
    config: {
        name: "Custom Script",
        author: "",
    },
    screens: [
        {
            id: "screen0",
            type: "screen",
            content: ["Welcome to your custom script."],
        },
    ],
    dialogs: [],
});

const cloneJson = <T,>(value: T): T => {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
};

const normalizeScriptThemePreset = (value: any): string => {
    if (typeof value !== "string") {
        return "";
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized.length) {
        return "";
    }

    if (normalized === "custom") {
        return normalized;
    }

    return THEMES.some((theme) => theme.id === normalized) ? normalized : "";
};

const parseOptionalPositiveNumber = (value: any): number | undefined => {
    const parsed = typeof value === "number"
        ? value
        : (typeof value === "string" && value.trim().length ? Number(value) : Number.NaN);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }

    return parsed;
};

// speeds are milliseconds per character, but the teletype also honours values
// below 1 (it draws several characters per tick), so fractions are kept as-is
const parseOptionalTextSpeed = (value: any): number | undefined => {
    return parseOptionalPositiveNumber(value);
};

interface CreatorSpeedInputProps {
    value: string; // the committed speed, or "" when unset
    placeholder: string;
    onChange: (nextValue: string) => void;
}

// a plain controlled input would swallow the keystrokes of a fractional speed:
// "0" and "0." are both rejected on the way to "0.6", so the draft is held here
// and only committed once it parses
const CreatorSpeedInput: FC<CreatorSpeedInputProps> = ({ value, placeholder, onChange }) => {
    const [draft, setDraft] = useState<string | null>(null);

    const handleChange = (nextValue: string) => {
        setDraft(nextValue);

        if (!nextValue.trim().length || parseOptionalTextSpeed(nextValue) !== undefined) {
            onChange(nextValue);
        }
    };

    return (
        <input
            type="number"
            min="0.1"
            step="any"
            value={draft ?? value}
            placeholder={placeholder}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={() => setDraft(null)}
        />
    );
};

const normalizeElementTextSpeed = (entry: any): any => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !("speed" in entry)) {
        return entry;
    }

    const parsedSpeed = parseOptionalTextSpeed((entry as any).speed);
    const nextEntry = {
        ...entry,
    };
    if (parsedSpeed === undefined) {
        delete (nextEntry as any).speed;
    } else {
        (nextEntry as any).speed = parsedSpeed;
    }
    return nextEntry;
};

const getScriptCustomThemeConfig = (script: any): CustomThemeConfig => {
    return sanitizeCustomTheme(script?.config?.customTheme || DEFAULT_CUSTOM_THEME);
};

const ensureScriptShape = (raw: any): any => {
    const base = cloneJson(raw && typeof raw === "object" ? raw : createDefaultScript());
    if (!base.config || typeof base.config !== "object") {
        base.config = {};
    }
    if (typeof base.config.name !== "string") {
        base.config.name = "Custom Script";
    }
    if (typeof base.config.author !== "string") {
        base.config.author = "";
    }

    const normalizedTheme = normalizeScriptThemePreset(base.config.theme ?? base.config.themeId);
    if (normalizedTheme.length) {
        base.config.theme = normalizedTheme;
    } else {
        delete base.config.theme;
    }
    delete base.config.themeId;

    const defaultTextSpeed = parseOptionalTextSpeed(base.config.defaultTextSpeed);
    if (defaultTextSpeed === undefined) {
        delete base.config.defaultTextSpeed;
    } else {
        base.config.defaultTextSpeed = defaultTextSpeed;
    }

    if (base.config.customTheme !== undefined) {
        base.config.customTheme = sanitizeCustomTheme(base.config.customTheme);
    }

    if (!Array.isArray(base.screens)) {
        base.screens = [];
    }
    if (!Array.isArray(base.dialogs)) {
        base.dialogs = [];
    }
    if (!base.screens.length) {
        base.screens.push({
            id: "screen0",
            type: "screen",
            content: [""],
        });
    }

    base.screens = base.screens
        .filter((screen: any) => screen && typeof screen === "object")
        .map((screen: any, index: number) => {
            const normalizedScreen = {
                ...screen,
                id: typeof screen.id === "string" && screen.id.trim() ? screen.id : `screen${index}`,
                type: typeof screen.type === "string" ? screen.type : "screen",
                content: Array.isArray(screen.content) ? screen.content.map(normalizeElementTextSpeed) : [],
            };
            const screenDefaultTextSpeed = parseOptionalTextSpeed(screen.defaultTextSpeed);
            if (screenDefaultTextSpeed === undefined) {
                delete normalizedScreen.defaultTextSpeed;
            } else {
                normalizedScreen.defaultTextSpeed = screenDefaultTextSpeed;
            }
            return normalizedScreen;
        });

    base.dialogs = base.dialogs
        .filter((dialog: any) => dialog && typeof dialog === "object")
        .map((dialog: any, index: number) => ({
            ...dialog,
            id: typeof dialog.id === "string" && dialog.id.trim() ? dialog.id : `dialog${index}`,
            type: typeof dialog.type === "string" ? dialog.type : "alert",
            content: Array.isArray(dialog.content)
                ? dialog.content
                : (typeof dialog.content === "string" ? [dialog.content] : []),
        }));

    return base;
};

const nextScreenId = (screens: any[]): string => {
    const ids = new Set(screens.map((screen) => screen.id));
    let i = screens.length;
    while (ids.has(`screen${i}`)) {
        i += 1;
    }
    return `screen${i}`;
};

const nextDialogId = (dialogs: any[]): string => {
    const ids = new Set((dialogs || []).map((dialog: any) => dialog?.id).filter((id: any) => typeof id === "string"));
    let i = dialogs?.length || 0;
    while (ids.has(`dialog${i}`)) {
        i += 1;
    }
    return `dialog${i}`;
};

const uniqueTargets = (targets: string[]): string[] => {
    return Array.from(new Set(targets.filter((target) => typeof target === "string" && target.trim().length > 0)));
};

const DIALOG_SCHEMA_NODE_PREFIX = "dialog::";

const toDialogSchemaNodeId = (dialogId: string): string => {
    return `${DIALOG_SCHEMA_NODE_PREFIX}${dialogId}`;
};

const getSchemaNodeLabel = (nodeId: string): string => {
    if (!nodeId.startsWith(DIALOG_SCHEMA_NODE_PREFIX)) {
        return nodeId;
    }
    return `[DIALOG] ${nodeId.slice(DIALOG_SCHEMA_NODE_PREFIX.length)}`;
};

const readScreenTargetsFromAction = (action: any): string[] => {
    if (!action || typeof action !== "object") {
        return [];
    }

    const actionType = typeof action.type === "string" ? action.type.toLowerCase() : "";
    if (actionType !== "link" && actionType !== "href" && actionType !== "dialog") {
        return [];
    }

    if (typeof action.target === "string") {
        return [actionType === "dialog" ? toDialogSchemaNodeId(action.target) : action.target];
    }

    if (!Array.isArray(action.target)) {
        return [];
    }

    return uniqueTargets(action.target.flatMap((targetEntry: any) => {
        if (!targetEntry || typeof targetEntry !== "object") {
            return [];
        }
        const targetType = typeof targetEntry.type === "string" ? targetEntry.type.toLowerCase() : "";
        if (targetType !== "link" && targetType !== "href" && targetType !== "dialog") {
            return [];
        }
        if (typeof targetEntry.target !== "string") {
            return [];
        }
        return [
            targetType === "dialog"
                ? toDialogSchemaNodeId(targetEntry.target)
                : targetEntry.target,
        ];
    }));
};

const readScreenTargetsFromElement = (element: any): string[] => {
    if (!element || typeof element !== "object") {
        return [];
    }

    const elementType = typeof element.type === "string" ? element.type.toLowerCase() : "";

    if (elementType === "link" || elementType === "href") {
        return readScreenTargetsFromAction({
            type: "link",
            target: element.target,
        });
    }

    if (elementType === "toggle" || elementType === "list" || elementType === "dropdown") {
        if (!Array.isArray(element.states)) {
            return [];
        }
        return uniqueTargets(element.states.flatMap((state: any) => {
            const stateTargets: string[] = [];
            if (typeof state?.target === "string") {
                stateTargets.push(state.target);
            }
            stateTargets.push(...readScreenTargetsFromAction(state?.action));
            return stateTargets;
        }));
    }

    if (elementType === "prompt") {
        const promptTargets = [
            ...readScreenTargetsFromAction(element.inputAction),
            ...(Array.isArray(element.commands)
                ? element.commands.flatMap((command: any) => readScreenTargetsFromAction(command?.action))
                : []),
        ];
        return uniqueTargets(promptTargets);
    }

    if (elementType === "login") {
        const credentialTargets = Array.isArray(element.credentials)
            ? element.credentials.flatMap((entry: any) => {
                if (!entry || typeof entry !== "object") {
                    return [];
                }

                if (entry.action && typeof entry.action === "object") {
                    return readScreenTargetsFromAction(entry.action);
                }

                return typeof entry.target === "string" ? [entry.target] : [];
            })
            : [];
        const noMatchTargets = [
            ...readScreenTargetsFromAction(element.noMatchAction),
            ...(typeof element.noMatchTarget === "string" ? [element.noMatchTarget] : []),
        ];

        return uniqueTargets([
            ...credentialTargets,
            ...noMatchTargets,
        ]);
    }

    if (elementType === "reportcomposer") {
        return uniqueTargets([element.saveTarget, element.cancelTarget]);
    }

    return [];
};

// --- Import helpers: remap ids so an imported script can be merged without id collisions ---

// Return a unique id: baseId if free, otherwise baseId-2, baseId-3, ... skipping anything in `reserved`.
const makeUniqueImportId = (baseId: string, reserved: Set<string>): string => {
    if (!reserved.has(baseId)) {
        return baseId;
    }
    let suffix = 2;
    while (reserved.has(`${baseId}-${suffix}`)) {
        suffix += 1;
    }
    return `${baseId}-${suffix}`;
};

const remapId = (id: any, idMap: Record<string, string>): any => {
    return typeof id === "string" && idMap[id] ? idMap[id] : id;
};

// Remap a single target entry / action object ({ type, target }) using the id map for its type.
const remapTargetEntry = (entry: any, screenIdMap: Record<string, string>, dialogIdMap: Record<string, string>): any => {
    if (!entry || typeof entry !== "object" || typeof entry.target !== "string") {
        return entry;
    }
    const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
    if (type === "dialog") {
        return { ...entry, target: remapId(entry.target, dialogIdMap) };
    }
    if (type === "link" || type === "href" || type === "action") {
        return { ...entry, target: remapId(entry.target, screenIdMap) };
    }
    return entry;
};

// A link/href target can be a bare screen id string or an array of target entries.
const remapLinkTarget = (target: any, screenIdMap: Record<string, string>, dialogIdMap: Record<string, string>): any => {
    if (typeof target === "string") {
        return remapId(target, screenIdMap);
    }
    if (Array.isArray(target)) {
        return target.map((entry) => remapTargetEntry(entry, screenIdMap, dialogIdMap));
    }
    return target;
};

// Remap every screen/dialog reference inside a single content element. Text-line strings pass through untouched.
const remapElementReferences = (element: any, screenIdMap: Record<string, string>, dialogIdMap: Record<string, string>): any => {
    if (!element || typeof element !== "object") {
        return element;
    }

    const type = typeof element.type === "string" ? element.type.toLowerCase() : "";
    const next = { ...element };

    if (type === "link" || type === "href") {
        next.target = remapLinkTarget(element.target, screenIdMap, dialogIdMap);
        return next;
    }

    if (type === "toggle" || type === "list" || type === "dropdown") {
        if (Array.isArray(element.states)) {
            next.states = element.states.map((state: any) => {
                if (!state || typeof state !== "object") {
                    return state;
                }
                const nextState = { ...state };
                if (typeof state.target === "string") {
                    nextState.target = remapId(state.target, screenIdMap);
                }
                if (typeof state.dialog === "string") {
                    nextState.dialog = remapId(state.dialog, dialogIdMap);
                }
                if (state.action && typeof state.action === "object") {
                    nextState.action = remapTargetEntry(state.action, screenIdMap, dialogIdMap);
                }
                return nextState;
            });
        }
        return next;
    }

    if (type === "prompt") {
        if (element.inputAction && typeof element.inputAction === "object") {
            next.inputAction = remapTargetEntry(element.inputAction, screenIdMap, dialogIdMap);
        }
        if (Array.isArray(element.commands)) {
            next.commands = element.commands.map((command: any) => {
                if (command && typeof command === "object" && command.action && typeof command.action === "object") {
                    return { ...command, action: remapTargetEntry(command.action, screenIdMap, dialogIdMap) };
                }
                return command;
            });
        }
        return next;
    }

    if (type === "login") {
        if (Array.isArray(element.credentials)) {
            next.credentials = element.credentials.map((entry: any) => {
                if (!entry || typeof entry !== "object") {
                    return entry;
                }
                const nextEntry = { ...entry };
                if (typeof entry.target === "string") {
                    nextEntry.target = remapId(entry.target, screenIdMap);
                }
                if (entry.action && typeof entry.action === "object") {
                    nextEntry.action = remapTargetEntry(entry.action, screenIdMap, dialogIdMap);
                }
                return nextEntry;
            });
        }
        if (element.noMatchAction && typeof element.noMatchAction === "object") {
            next.noMatchAction = remapTargetEntry(element.noMatchAction, screenIdMap, dialogIdMap);
        }
        if (typeof element.noMatchTarget === "string") {
            next.noMatchTarget = remapId(element.noMatchTarget, screenIdMap);
        }
        return next;
    }

    if (type === "reportcomposer") {
        if (typeof element.saveTarget === "string") {
            next.saveTarget = remapId(element.saveTarget, screenIdMap);
        }
        if (typeof element.cancelTarget === "string") {
            next.cancelTarget = remapId(element.cancelTarget, screenIdMap);
        }
        return next;
    }

    return next;
};

const remapScreenReferences = (screen: any, screenIdMap: Record<string, string>, dialogIdMap: Record<string, string>): any => {
    const next = { ...screen, id: remapId(screen.id, screenIdMap) };
    if (screen.onDone && typeof screen.onDone === "object" && typeof screen.onDone.target === "string") {
        next.onDone = { ...screen.onDone, target: remapId(screen.onDone.target, screenIdMap) };
    }
    if (Array.isArray(screen.content)) {
        next.content = screen.content.map((element: any) => remapElementReferences(element, screenIdMap, dialogIdMap));
    }
    return next;
};

const remapDialogReferences = (dialog: any, screenIdMap: Record<string, string>, dialogIdMap: Record<string, string>): any => {
    const next = { ...dialog, id: remapId(dialog.id, dialogIdMap) };
    if (Array.isArray(dialog.content)) {
        next.content = dialog.content.map((element: any) => remapElementReferences(element, screenIdMap, dialogIdMap));
    }
    return next;
};

// Merge the screens/dialogs of an imported script into `currentScript`, renaming any colliding ids.
const buildScriptWithImportedScreens = (currentScript: any, importedRaw: any): {
    script: any;
    importedScreens: any[];
    importedDialogs: any[];
} => {
    const importedScreens = Array.isArray(importedRaw?.screens)
        ? importedRaw.screens.filter((screen: any) => screen && typeof screen === "object")
        : [];
    const importedDialogs = Array.isArray(importedRaw?.dialogs)
        ? importedRaw.dialogs.filter((dialog: any) => dialog && typeof dialog === "object")
        : [];

    const screenReserved = new Set<string>((currentScript.screens || []).map((screen: any) => screen.id));
    const dialogReserved = new Set<string>((currentScript.dialogs || []).map((dialog: any) => dialog.id));

    const screenIdMap: Record<string, string> = {};
    const normalizedScreens = importedScreens.map((screen: any, index: number) => {
        const rawId = typeof screen.id === "string" && screen.id.trim() ? screen.id : `screen${index}`;
        const uniqueId = makeUniqueImportId(rawId, screenReserved);
        screenReserved.add(uniqueId);
        screenIdMap[rawId] = uniqueId;
        return { ...screen, id: rawId };
    });

    const dialogIdMap: Record<string, string> = {};
    const normalizedDialogs = importedDialogs.map((dialog: any, index: number) => {
        const rawId = typeof dialog.id === "string" && dialog.id.trim() ? dialog.id : `dialog${index}`;
        const uniqueId = makeUniqueImportId(rawId, dialogReserved);
        dialogReserved.add(uniqueId);
        dialogIdMap[rawId] = uniqueId;
        return { ...dialog, id: rawId };
    });

    const remappedScreens = normalizedScreens.map((screen: any) => remapScreenReferences(screen, screenIdMap, dialogIdMap));
    const remappedDialogs = normalizedDialogs.map((dialog: any) => remapDialogReferences(dialog, screenIdMap, dialogIdMap));

    return {
        script: {
            ...currentScript,
            screens: [...(currentScript.screens || []), ...remappedScreens],
            dialogs: [...(currentScript.dialogs || []), ...remappedDialogs],
        },
        importedScreens: remappedScreens,
        importedDialogs: remappedDialogs,
    };
};

const buildScreenConnectionMap = (script: any): {
    screenIds: string[];
    nodeIds: string[];
    connectionMap: Record<string, string[]>;
    nodeLabelById: Record<string, string>;
} => {
    const screens = Array.isArray(script?.screens) ? script.screens : [];
    const dialogs = Array.isArray(script?.dialogs) ? script.dialogs : [];
    const screenIds: string[] = screens
        .map((screen: any): string => (typeof screen?.id === "string" ? screen.id : ""))
        .filter((id: string) => id.length > 0);
    const dialogNodeIds: string[] = dialogs
        .map((dialog: any): string => (typeof dialog?.id === "string" ? dialog.id : ""))
        .filter((id: string) => id.length > 0)
        .map((id: string) => toDialogSchemaNodeId(id));
    const nodeIds: string[] = [...screenIds, ...dialogNodeIds];
    const idSet = new Set(nodeIds);
    const nodeLabelById: Record<string, string> = {};
    nodeIds.forEach((id) => {
        nodeLabelById[id] = getSchemaNodeLabel(id);
    });

    const connectionMap: Record<string, string[]> = {};
    screens.forEach((screen: any) => {
        if (!screen || typeof screen !== "object" || typeof screen.id !== "string" || !screen.id.length) {
            return;
        }

        const rawTargets: string[] = [];
        if (typeof screen?.onDone?.target === "string") {
            rawTargets.push(screen.onDone.target);
        }
        if (Array.isArray(screen.content)) {
            screen.content.forEach((element: any) => {
                rawTargets.push(...readScreenTargetsFromElement(element));
            });
        }

        connectionMap[screen.id] = uniqueTargets(rawTargets).filter((target) => idSet.has(target));
    });

    nodeIds.forEach((id) => {
        if (!connectionMap[id]) {
            connectionMap[id] = [];
        }
    });

    return {
        screenIds,
        nodeIds,
        connectionMap,
        nodeLabelById,
    };
};

const buildSchemaTreeLines = (
    rootId: string,
    nodeIds: string[],
    connectionMap: Record<string, string[]>,
    nodeLabelById: Record<string, string>
): string[] => {
    if (!nodeIds.length) {
        return ["No screens available."];
    }

    const firstRoot = nodeIds.includes(rootId) ? rootId : nodeIds[0];
    const lines: string[] = [nodeLabelById[firstRoot] || firstRoot];
    const globalSeen = new Set<string>([firstRoot]);
    const visited = new Set<string>([firstRoot]);

    const drawChildren = (nodeId: string, prefix: string, ancestors: Set<string>) => {
        const children = connectionMap[nodeId] || [];
        children.forEach((childId, index) => {
            const isLast = index === children.length - 1;
            const connector = `${prefix}${isLast ? "└─ " : "├─ "}`;
            const label = nodeLabelById[childId] || childId;

            if (ancestors.has(childId)) {
                lines.push(`${connector}${label} (cycle)`);
                return;
            }

            if (globalSeen.has(childId)) {
                lines.push(`${connector}${label} (seen)`);
                return;
            }

            lines.push(`${connector}${label}`);
            globalSeen.add(childId);
            visited.add(childId);
            const nextAncestors = new Set(ancestors);
            nextAncestors.add(childId);
            drawChildren(childId, `${prefix}${isLast ? "   " : "│  "}`, nextAncestors);
        });
    };

    drawChildren(firstRoot, "", new Set([firstRoot]));

    const disconnected = nodeIds.filter((id) => !visited.has(id));
    if (disconnected.length) {
        lines.push("");
        lines.push("Unreached from selected root:");
        disconnected.forEach((id) => {
            lines.push(nodeLabelById[id] || id);
            globalSeen.add(id);
            visited.add(id);
            drawChildren(id, "", new Set([id]));
        });
    }

    return lines;
};

const getInitialSelectedScreenId = (initialScript: any): string => {
    const normalized = ensureScriptShape(initialScript);
    const preferred = normalized?.config?.previewStartScreen;
    if (typeof preferred === "string" && preferred.length) {
        const exists = normalized.screens.some((screen: any) => screen?.id === preferred);
        if (exists) {
            return preferred;
        }
    }
    return normalized.screens[0]?.id || "";
};

const getInitialSelectedElementIndex = (initialScript: any, screenId: string): number => {
    const normalized = ensureScriptShape(initialScript);
    const selectedScreen = normalized.screens.find((screen: any) => screen?.id === screenId);
    const maxIndex = Math.max(0, ((selectedScreen?.content?.length || 1) - 1));
    const preferred = normalized?.config?.previewSelectedElementIndex;
    if (typeof preferred !== "number" || !Number.isFinite(preferred)) {
        return 0;
    }
    return Math.min(maxIndex, Math.max(0, Math.floor(preferred)));
};

const getInitialSidebarListMode = (initialScript: any): "screens" | "dialogs" => {
    const preferred = initialScript?.config?.previewSidebarListMode;
    if (preferred === "dialogs") {
        return "dialogs";
    }
    return "screens";
};

const getClassNameOptionsForElementType = (elementType: string): string[] => {
    switch (elementType) {
        case "text":
            return TEXT_CLASSNAME_OPTIONS;

        case "link":
        case "href":
            return LINK_CLASSNAME_OPTIONS;

        case "prompt":
        case "login":
            return PROMPT_CLASSNAME_OPTIONS;

        case "toggle":
        case "list":
        case "dropdown":
            return CYCLER_CLASSNAME_OPTIONS;

        case "bitmap":
        case "image":
            return BITMAP_CLASSNAME_OPTIONS;

        case "reportComposer":
        case "reportList":
            return TEXT_CLASSNAME_OPTIONS;

        default:
            return [""];
    }
};

const toCreatorSelectOptions = (options: string[], emptyLabel: string): CreatorSelectOption[] => {
    return options.map((option) => ({
        value: option,
        label: option || emptyLabel,
    }));
};

const escapeSearchPattern = (value: string): string => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const getSearchTextOccurrences = (
    source: string,
    query: string,
    matchCase: boolean,
    wholeWord: boolean
): SearchOccurrenceRange[] => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery.length || !source.length) {
        return [];
    }

    const escapedQuery = escapeSearchPattern(trimmedQuery);
    const flags = matchCase ? "g" : "gi";
    const pattern = new RegExp(
        wholeWord
            ? `(^|[^A-Za-z0-9_])(${escapedQuery})(?=$|[^A-Za-z0-9_])`
            : `(${escapedQuery})`,
        flags
    );
    const occurrences: SearchOccurrenceRange[] = [];
    let match: RegExpExecArray | null = pattern.exec(source);

    while (match) {
        const prefixLength = wholeWord ? (match[1] || "").length : 0;
        const matchedText = wholeWord ? (match[2] || "") : (match[1] || "");
        const start = match.index + prefixLength;
        const end = start + matchedText.length;

        if (matchedText.length > 0) {
            occurrences.push({ start, end });
        }

        if (pattern.lastIndex === match.index) {
            pattern.lastIndex += 1;
        }

        match = pattern.exec(source);
    }

    return occurrences;
};

const collectSearchStrings = (value: any, collected: string[] = []): string[] => {
    if (typeof value === "string") {
        if (value.trim().length) {
            collected.push(value);
        }
        return collected;
    }

    if (Array.isArray(value)) {
        value.forEach((entry) => {
            collectSearchStrings(entry, collected);
        });
        return collected;
    }

    if (!value || typeof value !== "object") {
        return collected;
    }

    Object.entries(value).forEach(([key, entryValue]) => {
        if (key === "type") {
            return;
        }
        collectSearchStrings(entryValue, collected);
    });

    return collected;
};

const buildSearchExcerpt = (
    value: string,
    query: string,
    matchCase: boolean,
    wholeWord: boolean
): string => {
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact.length) {
        return "(empty)";
    }

    const occurrences = getSearchTextOccurrences(compact, query, matchCase, wholeWord);
    if (!occurrences.length) {
        return compact.slice(0, 120);
    }

    const firstOccurrence = occurrences[0];
    const start = Math.max(0, firstOccurrence.start - 28);
    const end = Math.min(compact.length, firstOccurrence.end + 72);
    return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${end < compact.length ? "..." : ""}`;
};

const getElementListLabel = (entry: any): string => {
    if (typeof entry === "string") {
        return `text line: ${entry.slice(0, 24) || "(empty)"}`;
    }

    if (!entry || typeof entry !== "object") {
        return "object: (invalid)";
    }

    const type = (typeof entry.type === "string" ? entry.type : "object").toLowerCase();
    const cyclerPreviewText = ((): string => {
        if (type !== "toggle" && type !== "list" && type !== "dropdown") {
            return "";
        }

        const states = Array.isArray(entry.states) ? entry.states : [];
        if (!states.length) {
            return "";
        }

        const activeState = states.find((state: any) => state && typeof state === "object" && state.active === true);
        const candidateState = activeState || states[0];
        if (typeof candidateState === "string") {
            return candidateState;
        }

        if (!candidateState || typeof candidateState !== "object" || typeof candidateState.text !== "string") {
            return "";
        }

        return candidateState.text;
    })();
    const headline = (
        (cyclerPreviewText.trim().length ? cyclerPreviewText : "")
        || entry.text
        || entry.prompt
        || entry.usernamePrompt
        || entry.src
        || entry.id
        || ""
    ).toString().slice(0, 24) || "(empty)";
    const className = (typeof entry.className === "string" ? entry.className.trim() : "");

    if (type === "text" && className.length) {
        return `${className} text: ${headline}`;
    }

    if ((type === "link" || type === "href" || type === "prompt" || type === "login" || type === "toggle" || type === "list" || type === "dropdown" || type === "bitmap" || type === "image")
        && className.length) {
        return `${className} ${type}: ${headline}`;
    }

    return `${type}: ${headline}`;
};

// Build a plain-text, one-line-per-element preview of a screen's content (used by the import picker).
const getScreenPreviewLines = (screen: any): string[] => {
    const content = Array.isArray(screen?.content) ? screen.content : [];
    if (!content.length) {
        return ["(no content)"];
    }

    return content.map((entry: any) => {
        if (typeof entry === "string") {
            return entry;
        }
        if (!entry || typeof entry !== "object") {
            return "(invalid element)";
        }

        const type = (typeof entry.type === "string" ? entry.type : "object").toLowerCase();
        const cyclerText = ((): string => {
            if (type !== "toggle" && type !== "list" && type !== "dropdown") {
                return "";
            }
            const states = Array.isArray(entry.states) ? entry.states : [];
            const active = states.find((state: any) => state && typeof state === "object" && state.active === true);
            const candidate = active || states[0];
            if (typeof candidate === "string") {
                return candidate;
            }
            return candidate && typeof candidate.text === "string" ? candidate.text : "";
        })();
        const text = (cyclerText || entry.text || entry.prompt || entry.usernamePrompt || "").toString();

        switch (type) {
            case "text":
            case "link":
            case "href":
                return text;
            case "toggle":
            case "list":
            case "dropdown":
                return `${text} ▼`;
            case "prompt":
                return text || "> ";
            case "login":
                return text || "username> ";
            case "bitmap":
            case "image":
                return `[IMAGE${entry.src ? `: ${entry.src}` : ""}]`;
            case "reportcomposer":
                return "[REPORT COMPOSER]";
            case "reportlist":
                return "[REPORT LIST]";
            case "mainframegame":
                return "[MAINFRAME GAME]";
            default:
                return `[${type.toUpperCase()}]`;
        }
    });
};

const getDialogContentListLabel = (entry: any, index: number): string => {
    const previewRaw = typeof entry === "string" ? entry : JSON.stringify(entry);
    const preview = typeof previewRaw === "string" ? previewRaw : "";
    const className = entry && typeof entry === "object" && typeof entry.className === "string"
        ? entry.className.trim()
        : "";
    const textValue = entry && typeof entry === "object" && typeof entry.text === "string"
        ? entry.text
        : "";
    const textPreview = (textValue || preview).slice(0, 32) || "(empty)";

    if (typeof entry === "string") {
        return `line ${index + 1}: ${textPreview}`;
    }

    if (className.length) {
        return `${className} line ${index + 1}: ${textPreview}`;
    }

    return `object ${index + 1}: ${textPreview}`;
};

const buildScriptSearchMatches = (
    script: any,
    query: string,
    matchCase: boolean,
    wholeWord: boolean
): ScriptSearchMatch[] => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery.length) {
        return [];
    }

    const results: ScriptSearchMatch[] = [];
    const pushResult = (match: ScriptSearchMatch): void => {
        results.push(match);
    };

    (script?.screens || []).forEach((screen: any) => {
        const screenId = typeof screen?.id === "string" ? screen.id : "(unnamed)";
        const screenIdMatches = getSearchTextOccurrences(screenId, trimmedQuery, matchCase, wholeWord);
        if (screenIdMatches.length) {
            pushResult({
                id: `screen:${screenId}`,
                kind: "screen",
                screenId,
                title: `Screen ${screenId}`,
                excerpt: "Screen ID",
                matchCount: screenIdMatches.length,
            });
        }

        const content = Array.isArray(screen?.content) ? screen.content : [];
        content.forEach((entry: any, index: number) => {
            const searchableText = typeof entry === "string"
                ? entry
                : collectSearchStrings(entry).join("\n");
            const entryMatches = getSearchTextOccurrences(searchableText, trimmedQuery, matchCase, wholeWord);

            if (!entryMatches.length) {
                return;
            }

            pushResult({
                id: `screen:${screenId}:element:${index}`,
                kind: "element",
                screenId,
                elementIndex: index,
                title: `Screen ${screenId} / Element ${index + 1}`,
                excerpt: `${getElementListLabel(entry)} | ${buildSearchExcerpt(searchableText, trimmedQuery, matchCase, wholeWord)}`,
                matchCount: entryMatches.length,
            });
        });
    });

    (script?.dialogs || []).forEach((dialog: any) => {
        const dialogId = typeof dialog?.id === "string" ? dialog.id : "(unnamed)";
        const dialogIdMatches = getSearchTextOccurrences(dialogId, trimmedQuery, matchCase, wholeWord);
        if (dialogIdMatches.length) {
            pushResult({
                id: `dialog:${dialogId}`,
                kind: "dialog",
                dialogId,
                title: `Dialog ${dialogId}`,
                excerpt: "Dialog ID",
                matchCount: dialogIdMatches.length,
            });
        }

        const content = Array.isArray(dialog?.content) ? dialog.content : [];
        content.forEach((entry: any, index: number) => {
            const searchableText = typeof entry === "string"
                ? entry
                : collectSearchStrings(entry).join("\n");
            const entryMatches = getSearchTextOccurrences(searchableText, trimmedQuery, matchCase, wholeWord);

            if (!entryMatches.length) {
                return;
            }

            pushResult({
                id: `dialog:${dialogId}:content:${index}`,
                kind: "dialogContent",
                dialogId,
                dialogContentIndex: index,
                title: `Dialog ${dialogId} / Line ${index + 1}`,
                excerpt: `${getDialogContentListLabel(entry, index)} | ${buildSearchExcerpt(searchableText, trimmedQuery, matchCase, wholeWord)}`,
                matchCount: entryMatches.length,
            });
        });
    });

    return results;
};

const getEditorSearchOccurrences = (
    root: HTMLElement | null,
    query: string,
    matchCase: boolean,
    wholeWord: boolean
): EditorSearchOccurrence[] => {
    if (!root) {
        return [];
    }

    const searchTargets = Array.from(root.querySelectorAll(EDITOR_SEARCH_SELECTOR));
    const occurrences: EditorSearchOccurrence[] = [];

    searchTargets.forEach((target) => {
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement)) {
            return;
        }
        if (target.dataset.searchExclude === "true" || !target.getClientRects().length) {
            return;
        }
        if (target instanceof HTMLInputElement && !isSearchableInputType(target.type || "text")) {
            return;
        }
        if (target.disabled) {
            return;
        }

        const value = target instanceof HTMLButtonElement
            ? (target.textContent || "")
            : (target.value || "");
        const ranges = getSearchTextOccurrences(value, query, matchCase, wholeWord);

        ranges.forEach((range) => {
            occurrences.push({
                element: target,
                start: range.start,
                end: range.end,
                selectable: target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement,
            });
        });
    });

    return occurrences;
};

const focusEditorSearchOccurrence = (occurrence: EditorSearchOccurrence): void => {
    occurrence.element.scrollIntoView({ block: "nearest", inline: "nearest" });
    occurrence.element.focus();

    if (
        occurrence.selectable
        && (occurrence.element instanceof HTMLInputElement || occurrence.element instanceof HTMLTextAreaElement)
    ) {
        occurrence.element.setSelectionRange(occurrence.start, occurrence.end);
    }
};

const ScriptCreator: FC<ScriptCreatorProps> = ({
    open,
    initialScript,
    initialScriptId,
    availableScripts,
    onApply,
    onPreview,
    onClose,
    onDeleteLocalScript,
    onSaveModule,
}) => {
    const initialSelectedScreenId = getInitialSelectedScreenId(initialScript);
    const initialSelectedScript = availableScripts.find((script) => script.id === initialScriptId);
    const initialSelectedScriptLabel = initialSelectedScript?.label
        || String(initialScript?.config?.name || "CUSTOM SCRIPT").toUpperCase();
    const initialSelectedScriptCanSaveModule = !!initialSelectedScript?.canSaveModule;
    const scriptSnapshotsRef = useRef<Record<string, CreatorSelectionSnapshot>>({});
    const [script, setScript] = useState<any>(() => ensureScriptShape(initialScript));
    const [selectedScriptId, setSelectedScriptId] = useState<string>(() => initialScriptId);
    const [selectedScriptLabel, setSelectedScriptLabel] = useState<string>(() => initialSelectedScriptLabel);
    const [selectedScriptCanSaveModule, setSelectedScriptCanSaveModule] = useState<boolean>(() => initialSelectedScriptCanSaveModule);
    const [selectedScreenId, setSelectedScreenId] = useState<string>(() => initialSelectedScreenId);
    const [screenIdDraft, setScreenIdDraft] = useState<string>(() => initialSelectedScreenId);
    const [schemaRootId, setSchemaRootId] = useState<string>(() => initialSelectedScreenId);
    const [selectedElementIndex, setSelectedElementIndex] = useState<number>(() => {
        return getInitialSelectedElementIndex(initialScript, initialSelectedScreenId);
    });
    const initialSidebarListMode = getInitialSidebarListMode(initialScript);
    const [newElementType, setNewElementType] = useState<AddableElementType>("plainText");
    const [rawElementError, setRawElementError] = useState<string | null>(null);
    const [rawElementDraft, setRawElementDraft] = useState<string>("");
    const [rawDialogContentDraft, setRawDialogContentDraft] = useState<string>("");
    const [selectedDialogFocusId, setSelectedDialogFocusId] = useState<string>("");
    const [selectedDialogContentIndex, setSelectedDialogContentIndex] = useState<number>(0);
    const [sidebarListMode, setSidebarListMode] = useState<"screens" | "dialogs">(initialSidebarListMode);
    const [screenControlsOpen, setScreenControlsOpen] = useState<boolean>(false);
    const [screenEditorMode, setScreenEditorMode] = useState<"fields" | "raw">("fields");
    const [rawScreenError, setRawScreenError] = useState<string | null>(null);
    const [rawScreenDraft, setRawScreenDraft] = useState<string>("");
    const [elementEditorMode, setElementEditorMode] = useState<"fields" | "raw">("fields");
    const [activeView, setActiveView] = useState<"editor" | "schema">("editor");
    const [creatorColorMode, setCreatorColorMode] = useState<CreatorColorMode>("theme");
    const [configPanelVisible, setConfigPanelVisible] = useState<boolean>(true);
    const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_SIDEBAR_WIDTH);
    const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [searchMatchCase, setSearchMatchCase] = useState<boolean>(false);
    const [searchWholeWord, setSearchWholeWord] = useState<boolean>(false);
    const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState<number>(-1);
    const [searchResultsVisible, setSearchResultsVisible] = useState<boolean>(true);
    const [searchResultsExpanded, setSearchResultsExpanded] = useState<boolean>(false);
    const [filterListsToMatches, setFilterListsToMatches] = useState<boolean>(false);
    const [activeVisibleSearchOccurrenceIndex, setActiveVisibleSearchOccurrenceIndex] = useState<number>(-1);
    const [visibleSearchOccurrenceCount, setVisibleSearchOccurrenceCount] = useState<number>(0);
    const [searchFocusRequestId, setSearchFocusRequestId] = useState<number>(0);
    const [moduleSaveState, setModuleSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [importStatus, setImportStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
    const [importPickerOpen, setImportPickerOpen] = useState<boolean>(false);
    const [importCandidate, setImportCandidate] = useState<{ raw: any; screens: any[]; dialogs: any[] } | null>(null);
    const [importSelectedIndices, setImportSelectedIndices] = useState<Set<number>>(() => new Set());
    const [importSelectedDialogIndices, setImportSelectedDialogIndices] = useState<Set<number>>(() => new Set());
    const [importPreview, setImportPreview] = useState<{ kind: "screen" | "dialog"; index: number } | null>(null);
    const importFileInputRef = useRef<HTMLInputElement | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<HTMLElement | null>(null);
    const resizePointerIdRef = useRef<number | null>(null);
    const resizeStartXRef = useRef<number>(0);
    const resizeStartWidthRef = useRef<number>(DEFAULT_SIDEBAR_WIDTH);
    const pendingSearchSelectionModeRef = useRef<PendingSearchSelectionMode | null>(null);
    const scriptThemePreset = normalizeScriptThemePreset(script.config?.theme);
    const scriptCustomTheme = getScriptCustomThemeConfig(script);

    useEffect(() => {
        if (moduleSaveState !== "saved" && moduleSaveState !== "error") {
            return;
        }

        setModuleSaveState("idle");
    }, [script]);

    useEffect(() => {
        if (!importStatus) {
            return;
        }
        const timer = window.setTimeout(() => setImportStatus(null), 6000);
        return () => window.clearTimeout(timer);
    }, [importStatus]);

    const handleEditorMarkdownShortcut = (event: React.KeyboardEvent<HTMLElement>): void => {
        const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
        if (event.defaultPrevented || !!nativeEvent.isComposing) {
            return;
        }

        const usesShortcutModifier = event.ctrlKey || event.metaKey;
        if (!usesShortcutModifier || event.altKey) {
            return;
        }

        const shortcutKey = event.key.toLowerCase();
        const shortcut = MARKDOWN_SHORTCUTS[shortcutKey];
        if (!shortcut) {
            return;
        }

        if (shortcut.requiresShift && !event.shiftKey) {
            return;
        }
        const wrapper = shortcut.wrapper;

        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
            return;
        }

        if (target.closest(".script-creator__search")) {
            return;
        }

        if (target instanceof HTMLInputElement) {
            const inputType = (target.type || "text").toLowerCase();
            if (!isSearchableInputType(inputType)) {
                return;
            }
        }

        if (target.disabled || target.readOnly) {
            return;
        }

        if (elementEditorMode === "raw" && target.closest(".script-creator__element-editor")) {
            return;
        }

        const value = target.value || "";
        const selectionStart = typeof target.selectionStart === "number" ? target.selectionStart : value.length;
        const selectionEnd = typeof target.selectionEnd === "number" ? target.selectionEnd : selectionStart;
        const selectedText = value.slice(selectionStart, selectionEnd);
        const hasWrappedSelection = selectedText.length >= (wrapper.length * 2)
            && selectedText.startsWith(wrapper)
            && selectedText.endsWith(wrapper);
        const hasWrapperAroundSelection = !hasWrappedSelection
            && selectionStart >= wrapper.length
            && value.slice(selectionStart - wrapper.length, selectionStart) === wrapper
            && value.slice(selectionEnd, selectionEnd + wrapper.length) === wrapper;

        let replaceStart = selectionStart;
        let replaceEnd = selectionEnd;
        let replacement = `${wrapper}${selectedText}${wrapper}`;
        let nextSelectionStart = selectionStart + wrapper.length;
        let nextSelectionEnd = nextSelectionStart + selectedText.length;

        if (hasWrappedSelection) {
            replacement = selectedText.slice(wrapper.length, selectedText.length - wrapper.length);
            nextSelectionStart = selectionStart;
            nextSelectionEnd = selectionStart + replacement.length;
        } else if (hasWrapperAroundSelection) {
            replaceStart = selectionStart - wrapper.length;
            replaceEnd = selectionEnd + wrapper.length;
            replacement = selectedText;
            nextSelectionStart = replaceStart;
            nextSelectionEnd = replaceStart + selectedText.length;
        }

        event.preventDefault();

        target.focus();
        target.setSelectionRange(replaceStart, replaceEnd);

        let usedExecCommand = false;
        try {
            usedExecCommand = document.execCommand("insertText", false, replacement);
        } catch {
            usedExecCommand = false;
        }

        if (!usedExecCommand) {
            const nextValue = `${value.slice(0, replaceStart)}${replacement}${value.slice(replaceEnd)}`;
            const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value")?.set;
            if (valueSetter) {
                valueSetter.call(target, nextValue);
            } else {
                target.value = nextValue;
            }
            target.dispatchEvent(new Event("input", { bubbles: true }));
        }

        window.requestAnimationFrame(() => {
            if (document.activeElement === target) {
                target.setSelectionRange(nextSelectionStart, nextSelectionEnd);
            }
        });
    };

    const selectedScreen = useMemo(() => {
        return script.screens.find((screen: any) => screen.id === selectedScreenId) || null;
    }, [script, selectedScreenId]);
    const selectedDialog = useMemo(() => {
        return script.dialogs.find((dialog: any) => {
            return dialog && typeof dialog.id === "string" && dialog.id === selectedDialogFocusId;
        }) || null;
    }, [script, selectedDialogFocusId]);
    const selectedScreenIndex = script.screens.findIndex((screen: any) => screen.id === selectedScreenId);
    const canMoveScreenUp = selectedScreenIndex > 0;
    const canMoveScreenDown = selectedScreenIndex >= 0 && selectedScreenIndex < (script.screens.length - 1);
    const selectedDialogIndex = script.dialogs.findIndex((dialog: any) => {
        return dialog && typeof dialog.id === "string" && dialog.id === selectedDialogFocusId;
    });
    const canMoveDialogUp = selectedDialogIndex > 0;
    const canMoveDialogDown = selectedDialogIndex >= 0 && selectedDialogIndex < (script.dialogs.length - 1);
    const canDeleteDialog = selectedDialogIndex >= 0;
    const selectedDialogContent = Array.isArray(selectedDialog?.content) ? selectedDialog.content : [];
    const selectedDialogContentEntry = selectedDialogContent[selectedDialogContentIndex];
    const selectedDialogContentEntryIsObject = !!selectedDialogContentEntry && typeof selectedDialogContentEntry === "object";
    const selectedDialogContentEntryType = selectedDialogContentEntryIsObject
        && typeof (selectedDialogContentEntry as any).type === "string"
        ? ((selectedDialogContentEntry as any).type as string).toLowerCase()
        : "";
    const selectedDialogContentEntryIsBitmap = selectedDialogContentEntryType === "bitmap";
    const selectedDialogContentEntryIsTextLike = selectedDialogContentEntry !== undefined && !selectedDialogContentEntryIsBitmap;
    const selectedDialogTextValue = typeof selectedDialogContentEntry === "string"
        ? selectedDialogContentEntry
        : (selectedDialogContentEntryIsObject && typeof (selectedDialogContentEntry as any).text === "string"
            ? (selectedDialogContentEntry as any).text
            : "");
    const selectedDialogTextClassName = selectedDialogContentEntryIsObject
        && typeof (selectedDialogContentEntry as any).className === "string"
        ? (selectedDialogContentEntry as any).className
        : "";
    const canMoveDialogContentUp = selectedDialogContentIndex > 0;
    const canMoveDialogContentDown = selectedDialogContentIndex >= 0 && selectedDialogContentIndex < (selectedDialogContent.length - 1);
    const canDeleteDialogContent = selectedDialogContent.length > 0
        && selectedDialogContentIndex >= 0
        && selectedDialogContentIndex < selectedDialogContent.length;
    const selectedScreenOnDoneTarget = typeof selectedScreen?.onDone?.target === "string"
        ? selectedScreen.onDone.target
        : "";
    const selectedScreenOnDoneDelayMs = typeof selectedScreen?.onDone?.delayMs === "number"
        && Number.isFinite(selectedScreen.onDone.delayMs)
        ? String(Math.max(0, Math.floor(selectedScreen.onDone.delayMs)))
        : "";
    const scriptDefaultTextSpeedMs = parseOptionalTextSpeed(script?.config?.defaultTextSpeed);
    const resolvedScriptDefaultTextSpeedMs = scriptDefaultTextSpeedMs ?? PHOSPHOR_DEFAULT_TEXT_SPEED_MS;
    const selectedScreenDefaultTextSpeedMs = parseOptionalTextSpeed(selectedScreen?.defaultTextSpeed);
    const selectedScreenDefaultTextSpeed = selectedScreenDefaultTextSpeedMs === undefined
        ? ""
        : String(selectedScreenDefaultTextSpeedMs);

    // The header title control applies to the alien skin: either a script-wide
    // `terminalType: "alien"`, or a per-screen "file system" screen.
    const isAlienScript = ((script?.config?.terminalType ?? script?.config?.interface ?? "") as string)
        .toString().trim().toLowerCase() === "alien";
    const selectedScreenIsFileSystem = (() => {
        const type = typeof selectedScreen?.type === "string" ? selectedScreen.type.trim().toLowerCase() : "";
        return type === "filesystem" || type === "file system" || type === "file-system";
    })();
    const showAlienHeaderTitle = isAlienScript || selectedScreenIsFileSystem;
    const alienHeaderTitleFallback = (() => {
        const alien = script?.config?.alien;
        const alienTitle = alien && typeof alien === "object" && typeof alien.title === "string"
            ? alien.title.trim()
            : "";
        if (alienTitle.length) {
            return alienTitle;
        }
        const name = typeof script?.config?.name === "string" ? script.config.name.trim() : "";
        return name.length ? name.toUpperCase() : "TERMINAL";
    })();

    const selectedElement = selectedScreen?.content?.[selectedElementIndex];
    const canMoveElementUp = selectedElementIndex > 0;
    const canMoveElementDown = !!selectedScreen
        && selectedElementIndex >= 0
        && selectedElementIndex < (selectedScreen.content.length - 1);
    const canDeleteElement = !!selectedScreen && selectedScreen.content.length > 0;
    const selectedElementType = (
        selectedElement
        && typeof selectedElement === "object"
        && typeof selectedElement.type === "string"
    ) ? selectedElement.type.toLowerCase() : "";
    const selectedElementSupportsTextSpeed = selectedElement !== undefined
        && (typeof selectedElement === "string" || typeof selectedElement === "object");
    const selectedElementTextSpeedMs = selectedElementSupportsTextSpeed && typeof selectedElement === "object"
        ? parseOptionalTextSpeed((selectedElement as any).speed)
        : undefined;
    const selectedElementTextSpeed = selectedElementTextSpeedMs === undefined
        ? ""
        : String(selectedElementTextSpeedMs);
    const resolvedScreenDefaultTextSpeedMs = selectedScreenDefaultTextSpeedMs ?? resolvedScriptDefaultTextSpeedMs;
    const selectedElementTextSpeedPlaceholder = String(resolvedScreenDefaultTextSpeedMs);
    const selectedElementIsLinkLike = selectedElementType === "link" || selectedElementType === "href";
    const selectedLinkTargets = useMemo(() => {
        if (!selectedElementIsLinkLike || !selectedElement || typeof selectedElement !== "object") {
            return [];
        }
        const fallbackType: LinkTargetType = selectedElementType === "href" ? "href" : "link";
        return normalizeLinkTargets((selectedElement as any).target, fallbackType, selectedScreen?.id || "");
    }, [selectedElement, selectedElementIsLinkLike, selectedElementType, selectedScreen?.id]);
    const selectedElementIsPrompt = selectedElementType === "prompt";
    const selectedPromptCommands = useMemo(() => {
        if (!selectedElementIsPrompt || !selectedElement || typeof selectedElement !== "object") {
            return [];
        }

        return normalizePromptCommands((selectedElement as any).commands, selectedScreen?.id || "");
    }, [selectedElement, selectedElementIsPrompt, selectedScreen?.id]);
    const selectedElementIsLogin = selectedElementType === "login";
    const selectedLoginCredentials = useMemo(() => {
        if (!selectedElementIsLogin || !selectedElement || typeof selectedElement !== "object") {
            return [];
        }

        return normalizeLoginCredentials((selectedElement as any).credentials, selectedScreen?.id || "");
    }, [selectedElement, selectedElementIsLogin, selectedScreen?.id]);
    const selectedLoginNoMatchAction = useMemo((): PromptActionEntry => {
        const fallback: PromptActionEntry = {
            type: "dialog",
            target: "",
        };
        if (!selectedElementIsLogin || !selectedElement || typeof selectedElement !== "object") {
            return fallback;
        }

        const rawAction = (selectedElement as any).noMatchAction;
        if (!rawAction || typeof rawAction !== "object") {
            return fallback;
        }

        const type = asPromptActionType(rawAction.type, "dialog");
        const next: PromptActionEntry = { type };

        if (typeof rawAction.target === "string") {
            next.target = rawAction.target;
        }

        if (typeof rawAction.action === "string") {
            next.action = rawAction.action;
        } else if (type === "action") {
            next.action = "resetState";
        }

        return next;
    }, [selectedElement, selectedElementIsLogin]);
    const selectedElementIsCycler = selectedElementType === "toggle" || selectedElementType === "list" || selectedElementType === "dropdown";
    const selectedCyclerStates = useMemo(() => {
        if (!selectedElementIsCycler) {
            return [];
        }
        const fallbackLabel = selectedElementType === "list" ? "ITEM" : "OPTION";
        return normalizeCyclerStates((selectedElement as any)?.states, fallbackLabel);
    }, [selectedElement, selectedElementIsCycler, selectedElementType]);
    const classNameOptions = useMemo(() => {
        return getClassNameOptionsForElementType(selectedElementType);
    }, [selectedElementType]);
    const schemaData = useMemo(() => buildScreenConnectionMap(script), [script]);
    const effectiveSchemaRootId = useMemo(() => {
        if (!schemaData.screenIds.length) {
            return "";
        }
        if (schemaRootId && schemaData.screenIds.includes(schemaRootId)) {
            return schemaRootId;
        }
        if (selectedScreenId && schemaData.screenIds.includes(selectedScreenId)) {
            return selectedScreenId;
        }
        return schemaData.screenIds[0];
    }, [schemaData, schemaRootId, selectedScreenId]);
    const schemaLines = useMemo(() => {
        return buildSchemaTreeLines(
            effectiveSchemaRootId,
            schemaData.nodeIds,
            schemaData.connectionMap,
            schemaData.nodeLabelById
        );
    }, [effectiveSchemaRootId, schemaData]);
    const classNameSelectOptions = useMemo(() => {
        return toCreatorSelectOptions(classNameOptions, "(none)");
    }, [classNameOptions]);
    const cyclerStateClassNameSelectOptions = useMemo(() => {
        return toCreatorSelectOptions(CYCLER_CLASSNAME_OPTIONS, "(none)");
    }, []);
    const schemaRootSelectOptions = useMemo(() => {
        return schemaData.screenIds.map((id) => ({ value: id, label: id }));
    }, [schemaData.screenIds]);
    const scriptSelectOptions = useMemo(() => {
        return availableScripts.map((scriptOption) => ({
            value: scriptOption.id,
            label: scriptOption.label,
        }));
    }, [availableScripts]);
    // Combined list for target fields: every screen id, then every dialog id
    // (dialogs suffixed so they're recognizable). Used with `editable` so the
    // field is a type-to-filter combobox that also accepts arbitrary values.
    const targetSelectOptions = useMemo(() => {
        const screens = schemaData.screenIds.map((id) => ({ value: id, label: id }));
        const dialogs = (script.dialogs || [])
            .filter((dialog: any) => dialog && typeof dialog.id === "string" && dialog.id.trim().length > 0)
            .map((dialog: any) => ({ value: dialog.id, label: `${dialog.id}  ·  dialog` }));
        return [{ value: "", label: "(none)" }, ...screens, ...dialogs];
    }, [schemaData.screenIds, script.dialogs]);
    const searchMatches = useMemo(() => {
        return buildScriptSearchMatches(script, searchQuery, searchMatchCase, searchWholeWord);
    }, [script, searchQuery, searchMatchCase, searchWholeWord]);
    const totalSearchOccurrenceCount = useMemo(() => {
        return searchMatches.reduce((total, match) => total + match.matchCount, 0);
    }, [searchMatches]);
    const hasSearchQuery = searchQuery.trim().length > 0;
    const searchResultLabel = `${searchMatches.length} result${searchMatches.length === 1 ? "" : "s"}`;
    const searchOccurrenceLabel = `${totalSearchOccurrenceCount} match${totalSearchOccurrenceCount === 1 ? "" : "es"}`;
    const shouldShowSearchResults = hasSearchQuery && searchResultsVisible;
    const shouldExpandSearchResults = shouldShowSearchResults && searchResultsExpanded;
    const shouldFilterListsToMatches = hasSearchQuery && filterListsToMatches;
    const searchSummaryBase = !hasSearchQuery
        ? "Search screens, elements, and dialogs."
        : !searchMatches.length
            ? "No matches."
            : activeSearchMatchIndex >= 0
                ? `${activeSearchMatchIndex + 1}/${searchMatches.length} ${searchMatches.length === 1 ? "result" : "results"}`
                    + ` | ${searchOccurrenceLabel}`
                    + (
                        visibleSearchOccurrenceCount > 0 && activeVisibleSearchOccurrenceIndex >= 0
                            ? ` | ${activeVisibleSearchOccurrenceIndex + 1}/${visibleSearchOccurrenceCount} in view`
                            : ""
                    )
                : `${searchResultLabel} | ${searchOccurrenceLabel}`;
    const searchSummary = searchSummaryBase

    const matchingScreenIdSet = useMemo(() => {
        const ids = new Set<string>();
        searchMatches.forEach((match) => {
            if (match.screenId) {
                ids.add(match.screenId);
            }
        });
        return ids;
    }, [searchMatches]);
    const matchingDialogIdSet = useMemo(() => {
        const ids = new Set<string>();
        searchMatches.forEach((match) => {
            if (match.dialogId) {
                ids.add(match.dialogId);
            }
        });
        return ids;
    }, [searchMatches]);
    const matchingElementKeySet = useMemo(() => {
        const ids = new Set<string>();
        searchMatches.forEach((match) => {
            if (match.kind === "element" && match.screenId && typeof match.elementIndex === "number") {
                ids.add(`${match.screenId}:${match.elementIndex}`);
            }
        });
        return ids;
    }, [searchMatches]);
    const matchingDialogContentKeySet = useMemo(() => {
        const ids = new Set<string>();
        searchMatches.forEach((match) => {
            if (match.kind === "dialogContent" && match.dialogId && typeof match.dialogContentIndex === "number") {
                ids.add(`${match.dialogId}:${match.dialogContentIndex}`);
            }
        });
        return ids;
    }, [searchMatches]);
    const visibleScreens = useMemo(() => {
        const screens = Array.isArray(script.screens) ? script.screens : [];
        if (!shouldFilterListsToMatches) {
            return screens;
        }
        return screens.filter((screen: any) => {
            return typeof screen?.id === "string" && matchingScreenIdSet.has(screen.id);
        });
    }, [matchingScreenIdSet, script.screens, shouldFilterListsToMatches]);
    const visibleDialogs = useMemo(() => {
        const dialogs = Array.isArray(script.dialogs) ? script.dialogs : [];
        if (!shouldFilterListsToMatches) {
            return dialogs;
        }
        return dialogs.filter((dialog: any) => {
            return typeof dialog?.id === "string" && matchingDialogIdSet.has(dialog.id);
        });
    }, [matchingDialogIdSet, script.dialogs, shouldFilterListsToMatches]);
    const visibleElementEntries = useMemo<IndexedLabeledEntry[]>(() => {
        const content = Array.isArray(selectedScreen?.content) ? selectedScreen.content : [];
        return content
            .map((entry: any, index: number) => ({
                entry,
                index,
                label: getElementListLabel(entry),
            }))
            .filter((item: IndexedLabeledEntry) => {
                if (!shouldFilterListsToMatches || !selectedScreen?.id) {
                    return true;
                }
                return matchingElementKeySet.has(`${selectedScreen.id}:${item.index}`);
            });
    }, [matchingElementKeySet, selectedScreen, shouldFilterListsToMatches]);
    const visibleDialogContentEntries = useMemo<IndexedLabeledEntry[]>(() => {
        return selectedDialogContent
            .map((entry: any, index: number) => ({
                entry,
                index,
                label: getDialogContentListLabel(entry, index),
            }))
            .filter((item: IndexedLabeledEntry) => {
                if (!shouldFilterListsToMatches || !selectedDialog?.id) {
                    return true;
                }
                return matchingDialogContentKeySet.has(`${selectedDialog.id}:${item.index}`);
            });
    }, [matchingDialogContentKeySet, selectedDialog?.id, selectedDialogContent, shouldFilterListsToMatches]);

    useEffect(() => {
        setScreenIdDraft(selectedScreen?.id || "");
    }, [selectedScreen?.id]);

    useEffect(() => {
        if (sidebarListMode !== "screens" || screenEditorMode !== "raw" || selectedScreen === undefined) {
            setRawScreenDraft("");
            return;
        }

        setRawScreenDraft(JSON.stringify(selectedScreen, null, 2));
        setRawScreenError(null);
    }, [screenEditorMode, selectedScreenId, sidebarListMode]);

    useEffect(() => {
        if (sidebarListMode !== "screens" || elementEditorMode !== "raw" || selectedElement === undefined) {
            setRawElementDraft("");
            return;
        }

        setRawElementDraft(JSON.stringify(selectedElement, null, 2));
        setRawElementError(null);
    }, [elementEditorMode, selectedElementIndex, selectedScreenId, sidebarListMode]);

    useEffect(() => {
        if (sidebarListMode !== "dialogs" || selectedDialogContentEntry === undefined || !selectedDialogContentEntryIsObject) {
            setRawDialogContentDraft("");
            return;
        }

        setRawDialogContentDraft(JSON.stringify(selectedDialogContentEntry, null, 2));
        setRawElementError(null);
    }, [selectedDialogContentIndex, selectedDialogContentEntryIsObject, selectedDialogFocusId, sidebarListMode]);

    useEffect(() => {
        if (sidebarListMode !== "screens" && screenControlsOpen) {
            setScreenControlsOpen(false);
        }
    }, [screenControlsOpen, sidebarListMode]);

    const resetSearchNavigation = (): void => {
        pendingSearchSelectionModeRef.current = null;
        setActiveSearchMatchIndex(-1);
        setActiveVisibleSearchOccurrenceIndex(-1);
        setVisibleSearchOccurrenceCount(0);
    };

    const getDefaultSelectionSnapshot = (normalizedScript: any): CreatorSelectionSnapshot => {
        const selectedScreenIdForSnapshot = getInitialSelectedScreenId(normalizedScript);
        return {
            activeView: "editor",
            configPanelVisible: true,
            elementEditorMode: "fields",
            screenEditorMode: "fields",
            screenControlsOpen: false,
            schemaRootId: selectedScreenIdForSnapshot,
            screenIdDraft: selectedScreenIdForSnapshot,
            selectedDialogContentIndex: 0,
            selectedDialogFocusId: "",
            selectedElementIndex: getInitialSelectedElementIndex(normalizedScript, selectedScreenIdForSnapshot),
            selectedScreenId: selectedScreenIdForSnapshot,
            sidebarListMode: getInitialSidebarListMode(normalizedScript),
        };
    };

    const captureSelectionSnapshot = (): CreatorSelectionSnapshot => {
        return {
            activeView,
            configPanelVisible,
            elementEditorMode,
            screenEditorMode,
            screenControlsOpen,
            schemaRootId,
            screenIdDraft,
            selectedDialogContentIndex,
            selectedDialogFocusId,
            selectedElementIndex,
            selectedScreenId,
            sidebarListMode,
        };
    };

    const saveSelectionSnapshot = (scriptId: string): void => {
        if (!scriptId.length) {
            return;
        }

        scriptSnapshotsRef.current[scriptId] = captureSelectionSnapshot();
    };

    const applySelectionSnapshot = (snapshot: CreatorSelectionSnapshot): void => {
        setSidebarListMode(snapshot.sidebarListMode);
        setActiveView(snapshot.activeView);
        setConfigPanelVisible(snapshot.configPanelVisible);
        setElementEditorMode(snapshot.elementEditorMode);
        setScreenEditorMode(snapshot.screenEditorMode);
        setScreenControlsOpen(snapshot.screenControlsOpen);
        setSchemaRootId(snapshot.schemaRootId);
        setScreenIdDraft(snapshot.screenIdDraft);
        setSelectedDialogContentIndex(snapshot.selectedDialogContentIndex);
        setSelectedDialogFocusId(snapshot.selectedDialogFocusId);
        setSelectedElementIndex(snapshot.selectedElementIndex);
        setSelectedScreenId(snapshot.selectedScreenId);
    };

    const loadScriptIntoCreator = (
        nextScriptJson: any,
        nextScriptId: string,
        nextScriptLabel: string,
        nextScriptCanSaveModule: boolean = false
    ): void => {
        const normalized = ensureScriptShape(nextScriptJson);
        if (selectedScriptId && selectedScriptId !== nextScriptId) {
            saveSelectionSnapshot(selectedScriptId);
        }
        const snapshot = scriptSnapshotsRef.current[nextScriptId] || getDefaultSelectionSnapshot(normalized);
        const firstScreenId = snapshot.selectedScreenId && normalized.screens.some((screen: any) => screen?.id === snapshot.selectedScreenId)
            ? snapshot.selectedScreenId
            : getInitialSelectedScreenId(normalized);
        const nextSnapshot: CreatorSelectionSnapshot = {
            ...snapshot,
            schemaRootId: snapshot.schemaRootId && normalized.screens.some((screen: any) => screen?.id === snapshot.schemaRootId)
                ? snapshot.schemaRootId
                : firstScreenId,
            screenIdDraft: snapshot.screenIdDraft && normalized.screens.some((screen: any) => screen?.id === snapshot.screenIdDraft)
                ? snapshot.screenIdDraft
                : firstScreenId,
            selectedDialogFocusId: snapshot.selectedDialogFocusId,
            selectedElementIndex: snapshot.selectedElementIndex,
            selectedScreenId: firstScreenId,
        };

        setScript(normalized);
        setSelectedScriptId(nextScriptId);
        setSelectedScriptLabel(nextScriptLabel);
        setSelectedScriptCanSaveModule(nextScriptCanSaveModule);
        applySelectionSnapshot(nextSnapshot);
        setRawScreenError(null);
        setRawScreenDraft("");
        setRawElementError(null);
        setRawElementDraft("");
        setRawDialogContentDraft("");
        setSearchQuery("");
        setModuleSaveState("idle");
        resetSearchNavigation();
    };

    const handleScriptSelect = (nextScriptId: string): void => {
        const nextScript = availableScripts.find((scriptOption) => scriptOption.id === nextScriptId);
        if (!nextScript) {
            return;
        }

        loadScriptIntoCreator(nextScript.json, nextScript.id, nextScript.label, !!nextScript.canSaveModule);
    };

    useEffect(() => {
        const dialogIds = script.dialogs
            .filter((dialog: any) => dialog && typeof dialog.id === "string" && dialog.id.length)
            .map((dialog: any) => dialog.id);

        if (!dialogIds.length) {
            if (selectedDialogFocusId.length) {
                setSelectedDialogFocusId("");
            }
            return;
        }

        if (!selectedDialogFocusId.length) {
            setSelectedDialogFocusId(dialogIds[0]);
            return;
        }

        const exists = dialogIds.includes(selectedDialogFocusId);
        if (!exists) {
            setSelectedDialogFocusId(dialogIds[0]);
        }
    }, [script.dialogs, selectedDialogFocusId]);

    useEffect(() => {
        const maxIndex = Math.max(0, selectedDialogContent.length - 1);
        if (selectedDialogContentIndex > maxIndex) {
            setSelectedDialogContentIndex(maxIndex);
        }
    }, [selectedDialogContent, selectedDialogContentIndex]);

    useEffect(() => {
        if (!searchMatches.length) {
            pendingSearchSelectionModeRef.current = null;
            if (activeSearchMatchIndex !== -1) {
                setActiveSearchMatchIndex(-1);
            }
            if (activeVisibleSearchOccurrenceIndex !== -1) {
                setActiveVisibleSearchOccurrenceIndex(-1);
            }
            if (visibleSearchOccurrenceCount !== 0) {
                setVisibleSearchOccurrenceCount(0);
            }
            return;
        }

        if (activeSearchMatchIndex >= searchMatches.length) {
            setActiveSearchMatchIndex(searchMatches.length - 1);
        }
    }, [activeSearchMatchIndex, activeVisibleSearchOccurrenceIndex, searchMatches, visibleSearchOccurrenceCount]);

    useEffect(() => {
        if (!hasSearchQuery && searchResultsExpanded) {
            setSearchResultsExpanded(false);
        }
    }, [hasSearchQuery, searchResultsExpanded]);

    useEffect(() => {
        if (!searchResultsVisible && searchResultsExpanded) {
            setSearchResultsExpanded(false);
        }
    }, [searchResultsExpanded, searchResultsVisible]);

    useEffect(() => {
        if (!hasSearchQuery || activeView !== "editor") {
            if (activeVisibleSearchOccurrenceIndex !== -1) {
                setActiveVisibleSearchOccurrenceIndex(-1);
            }
            if (visibleSearchOccurrenceCount !== 0) {
                setVisibleSearchOccurrenceCount(0);
            }
            return;
        }

        if (pendingSearchSelectionModeRef.current !== null) {
            return;
        }

        const occurrences = getEditorSearchOccurrences(editorRef.current, searchQuery, searchMatchCase, searchWholeWord);
        setVisibleSearchOccurrenceCount(occurrences.length);
        setActiveVisibleSearchOccurrenceIndex((prev) => {
            if (!occurrences.length) {
                return -1;
            }
            if (prev < 0) {
                return -1;
            }
            return Math.min(prev, occurrences.length - 1);
        });
    }, [
        activeView,
        activeVisibleSearchOccurrenceIndex,
        elementEditorMode,
        hasSearchQuery,
        script,
        searchMatchCase,
        searchQuery,
        searchWholeWord,
        selectedDialogContentIndex,
        selectedDialogFocusId,
        selectedElementIndex,
        selectedScreenId,
        sidebarListMode,
        visibleSearchOccurrenceCount,
    ]);

    useEffect(() => {
        if (pendingSearchSelectionModeRef.current === null) {
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            const mode = pendingSearchSelectionModeRef.current;
            pendingSearchSelectionModeRef.current = null;
            if (mode === null) {
                return;
            }

            const occurrences = getEditorSearchOccurrences(editorRef.current, searchQuery, searchMatchCase, searchWholeWord);
            setVisibleSearchOccurrenceCount(occurrences.length);
            if (!occurrences.length) {
                setActiveVisibleSearchOccurrenceIndex(-1);
                return;
            }

            const targetIndex = typeof mode === "number"
                ? Math.max(0, Math.min(mode, occurrences.length - 1))
                : mode === "last"
                    ? occurrences.length - 1
                    : 0;

            focusEditorSearchOccurrence(occurrences[targetIndex]);
            setActiveVisibleSearchOccurrenceIndex(targetIndex);
        });

        return () => {
            window.cancelAnimationFrame(frame);
        };
    }, [
        activeView,
        elementEditorMode,
        script,
        searchFocusRequestId,
        searchMatchCase,
        searchQuery,
        searchWholeWord,
        selectedDialogContentIndex,
        selectedDialogFocusId,
        selectedElementIndex,
        selectedScreenId,
        sidebarListMode,
    ]);

    useEffect(() => {
        if (!shouldFilterListsToMatches || sidebarListMode !== "screens" || !visibleScreens.length) {
            return;
        }

        const selectedVisible = visibleScreens.some((screen: any) => screen.id === selectedScreenId);
        if (!selectedVisible) {
            setSelectedScreenId(visibleScreens[0].id);
            setSelectedElementIndex(0);
            setRawElementError(null);
        }
    }, [selectedScreenId, shouldFilterListsToMatches, sidebarListMode, visibleScreens]);

    useEffect(() => {
        if (!shouldFilterListsToMatches || sidebarListMode !== "dialogs" || !visibleDialogs.length) {
            return;
        }

        const selectedVisible = visibleDialogs.some((dialog: any) => dialog?.id === selectedDialogFocusId);
        if (!selectedVisible) {
            setSelectedDialogFocusId(visibleDialogs[0].id);
            setSelectedDialogContentIndex(0);
            setRawElementError(null);
        }
    }, [selectedDialogFocusId, shouldFilterListsToMatches, sidebarListMode, visibleDialogs]);

    useEffect(() => {
        if (!shouldFilterListsToMatches || sidebarListMode !== "screens" || !visibleElementEntries.length) {
            return;
        }

        const selectedVisible = visibleElementEntries.some((entry: IndexedLabeledEntry) => entry.index === selectedElementIndex);
        if (!selectedVisible) {
            setSelectedElementIndex(visibleElementEntries[0].index);
            setRawElementError(null);
        }
    }, [selectedElementIndex, shouldFilterListsToMatches, sidebarListMode, visibleElementEntries]);

    useEffect(() => {
        if (!shouldFilterListsToMatches || sidebarListMode !== "dialogs" || !visibleDialogContentEntries.length) {
            return;
        }

        const selectedVisible = visibleDialogContentEntries.some((entry: IndexedLabeledEntry) => entry.index === selectedDialogContentIndex);
        if (!selectedVisible) {
            setSelectedDialogContentIndex(visibleDialogContentEntries[0].index);
            setRawElementError(null);
        }
    }, [selectedDialogContentIndex, shouldFilterListsToMatches, sidebarListMode, visibleDialogContentEntries]);

    const clampSidebarWidth = (nextWidth: number): number => {
        const bodyWidth = bodyRef.current?.clientWidth || 0;
        const maxWidth = bodyWidth
            ? Math.max(MIN_SIDEBAR_WIDTH, bodyWidth - MIN_EDITOR_WIDTH - RESIZE_HANDLE_WIDTH)
            : nextWidth;
        return Math.max(MIN_SIDEBAR_WIDTH, Math.min(nextWidth, maxWidth));
    };

    const updateScript = (updater: (prev: any) => any) => {
        setScript((prev: any) => ensureScriptShape(updater(prev)));
    };

    const updateConfig = (key: string, value: any) => {
        updateScript((prev) => ({
            ...prev,
            config: {
                ...prev.config,
                [key]: value,
            },
        }));
    };

    const removeConfigKey = (key: string) => {
        updateScript((prev) => {
            const nextConfig = {
                ...prev.config,
            };
            delete nextConfig[key];
            return {
                ...prev,
                config: nextConfig,
            };
        });
    };

    const updateCustomThemeConfig = (patch: Partial<CustomThemeConfig>) => {
        updateConfig("customTheme", sanitizeCustomTheme({
            ...scriptCustomTheme,
            ...patch,
        }));
    };

    const updateScreen = (patch: Record<string, any>) => {
        if (!selectedScreen) {
            return;
        }

        updateScript((prev) => ({
            ...prev,
            screens: prev.screens.map((screen: any) => {
                if (screen.id !== selectedScreen.id) {
                    return screen;
                }
                return {
                    ...screen,
                    ...patch,
                };
            }),
        }));
    };

    const replaceSelectedScreen = (nextScreen: any) => {
        if (!selectedScreen) {
            return;
        }

        const previousId = selectedScreen.id;
        const nextId = typeof nextScreen?.id === "string" && nextScreen.id.trim().length
            ? nextScreen.id.trim()
            : previousId;

        updateScript((prev) => ({
            ...prev,
            screens: prev.screens.map((screen: any) => {
                if (screen.id !== previousId) {
                    return screen;
                }

                return {
                    ...nextScreen,
                    id: nextId,
                };
            }),
        }));

        if (nextId !== previousId) {
            setSelectedScreenId(nextId);
            setScreenIdDraft(nextId);
        }
    };

    const updateScreenOnDoneTarget = (nextTargetRaw: string) => {
        if (!selectedScreen) {
            return;
        }

        const nextTarget = nextTargetRaw.trim();
        if (!nextTarget.length) {
            updateScreen({ onDone: undefined });
            return;
        }

        const existingOnDone = selectedScreen.onDone && typeof selectedScreen.onDone === "object"
            ? selectedScreen.onDone
            : {};
        const nextOnDone: Record<string, any> = {
            ...existingOnDone,
            target: nextTarget,
        };

        const currentDelayMs = existingOnDone.delayMs;
        if (typeof currentDelayMs === "number" && Number.isFinite(currentDelayMs)) {
            nextOnDone.delayMs = Math.max(0, Math.floor(currentDelayMs));
        } else {
            delete nextOnDone.delayMs;
        }

        updateScreen({ onDone: nextOnDone });
    };

    const updateScreenOnDoneDelayMs = (nextDelayRaw: string) => {
        if (!selectedScreen) {
            return;
        }

        const existingOnDone = selectedScreen.onDone && typeof selectedScreen.onDone === "object"
            ? selectedScreen.onDone
            : {};
        const target = typeof existingOnDone.target === "string" ? existingOnDone.target.trim() : "";
        if (!target.length) {
            return;
        }

        const trimmedDelay = nextDelayRaw.trim();
        if (!trimmedDelay.length) {
            const nextOnDone: Record<string, any> = {
                ...existingOnDone,
                target,
            };
            delete nextOnDone.delayMs;
            updateScreen({ onDone: nextOnDone });
            return;
        }

        const parsedDelay = Number(trimmedDelay);
        if (!Number.isFinite(parsedDelay) || parsedDelay < 0) {
            return;
        }

        updateScreen({
            onDone: {
                ...existingOnDone,
                target,
                delayMs: Math.floor(parsedDelay),
            },
        });
    };

    const updateScreenDefaultTextSpeed = (nextSpeedRaw: string) => {
        if (!selectedScreen) {
            return;
        }

        const trimmedSpeed = nextSpeedRaw.trim();
        if (!trimmedSpeed.length) {
            updateScreen({ defaultTextSpeed: undefined });
            return;
        }

        const parsedSpeed = parseOptionalTextSpeed(trimmedSpeed);
        if (parsedSpeed === undefined) {
            return;
        }

        updateScreen({ defaultTextSpeed: parsedSpeed });
    };

    const updateDialog = (patch: Record<string, any>) => {
        if (!selectedDialog) {
            return;
        }

        updateScript((prev) => ({
            ...prev,
            dialogs: prev.dialogs.map((dialog: any) => {
                if (!dialog || dialog.id !== selectedDialog.id) {
                    return dialog;
                }
                return {
                    ...dialog,
                    ...patch,
                };
            }),
        }));
    };

    const addScreen = () => {
        const newId = nextScreenId(script.screens);
        updateScript((prev) => {
            const insertIndex = prev.screens.findIndex((screen: any) => screen.id === selectedScreenId);
            const newScreens = [...prev.screens];
            newScreens.splice(insertIndex + 1, 0, {
                id: newId,
                type: "screen",
                content: [""],
            });
            return {
                ...prev,
                screens: newScreens,
            };
        });
        setSidebarListMode("screens");
        setSelectedScreenId(newId);
        setSelectedElementIndex(0);
    };

    const removeScreen = () => {
        if (!selectedScreen || script.screens.length <= 1) {
            return;
        }

        const nextScreens = script.screens.filter((screen: any) => screen.id !== selectedScreen.id);
        updateScript((prev) => ({
            ...prev,
            screens: prev.screens.filter((screen: any) => screen.id !== selectedScreen.id),
        }));
        setSelectedScreenId(nextScreens[0].id);
        setSelectedElementIndex(0);
    };

    const moveScreen = (direction: -1 | 1) => {
        updateScript((prev) => {
            const from = prev.screens.findIndex((screen: any) => screen.id === selectedScreenId);
            const to = from + direction;
            if (from < 0 || to < 0 || to >= prev.screens.length) {
                return prev;
            }

            const nextScreens = [...prev.screens];
            [nextScreens[from], nextScreens[to]] = [nextScreens[to], nextScreens[from]];
            return {
                ...prev,
                screens: nextScreens,
            };
        });
    };

    const addDialog = () => {
        const newDialogId = nextDialogId(script.dialogs);
        updateScript((prev) => {
            const insertIndex = prev.dialogs.findIndex((dialog: any) => dialog.id === selectedDialogFocusId);
            const newDialogs = [...prev.dialogs];
            newDialogs.splice(insertIndex + 1, 0, {
                id: newDialogId,
                type: "alert",
                content: ["New dialog"],
            });
            return {
                ...prev,
                dialogs: newDialogs,
            };
        });
        setSidebarListMode("dialogs");
        setSelectedDialogFocusId(newDialogId);
        setSelectedDialogContentIndex(0);
    };

    const moveDialog = (direction: -1 | 1) => {
        if (!selectedDialogFocusId.length) {
            return;
        }

        updateScript((prev) => {
            const from = prev.dialogs.findIndex((dialog: any) => {
                return dialog && typeof dialog.id === "string" && dialog.id === selectedDialogFocusId;
            });
            const to = from + direction;
            if (from < 0 || to < 0 || to >= prev.dialogs.length) {
                return prev;
            }

            const nextDialogs = [...prev.dialogs];
            [nextDialogs[from], nextDialogs[to]] = [nextDialogs[to], nextDialogs[from]];
            return {
                ...prev,
                dialogs: nextDialogs,
            };
        });
    };

    const removeDialog = () => {
        if (selectedDialogIndex < 0) {
            return;
        }

        const dialogToRemove = script.dialogs[selectedDialogIndex];
        const dialogToRemoveId = typeof dialogToRemove?.id === "string" ? dialogToRemove.id : "";
        if (!dialogToRemoveId.length) {
            return;
        }

        const nextDialogs = script.dialogs.filter((dialog: any) => {
            return !dialog || dialog.id !== dialogToRemoveId;
        });
        const nextSelectedDialogId = nextDialogs.length
            ? (nextDialogs[Math.min(selectedDialogIndex, nextDialogs.length - 1)]?.id || "")
            : "";

        updateScript((prev) => ({
            ...prev,
            dialogs: prev.dialogs.filter((dialog: any) => {
                return !dialog || dialog.id !== dialogToRemoveId;
            }),
            screens: prev.screens.map((screen: any) => ({
                ...screen,
                content: Array.isArray(screen.content)
                    ? screen.content.map((entry: any) => removeDialogTargetsFromElement(entry, dialogToRemoveId))
                    : screen.content,
            })),
        }));

        setSelectedDialogFocusId(nextSelectedDialogId);
    };

    const renameDialogId = (nextIdRaw: string) => {
        if (!selectedDialog) {
            return;
        }

        const nextId = nextIdRaw.trim();
        if (!nextId || nextId === selectedDialog.id) {
            return;
        }

        const hasDuplicate = script.dialogs.some((dialog: any) => {
            return dialog && dialog.id === nextId && dialog.id !== selectedDialog.id;
        });
        if (hasDuplicate) {
            return;
        }

        const previousId = selectedDialog.id;
        updateScript((prev) => ({
            ...prev,
            dialogs: prev.dialogs.map((dialog: any) => {
                if (!dialog || dialog.id !== previousId) {
                    return dialog;
                }
                return {
                    ...dialog,
                    id: nextId,
                };
            }),
            screens: prev.screens.map((screen: any) => ({
                ...screen,
                content: Array.isArray(screen.content)
                    ? screen.content.map((entry: any) => replaceDialogTargetsInElement(entry, previousId, nextId))
                    : screen.content,
            })),
        }));
        setSelectedDialogFocusId(nextId);
    };

    const updateDialogContentEntry = (nextEntry: any) => {
        if (!selectedDialog) {
            return;
        }
        if (selectedDialogContentIndex < 0 || selectedDialogContentIndex >= selectedDialogContent.length) {
            return;
        }

        const nextContent = selectedDialogContent.map((entry: any, index: number) => {
            return index === selectedDialogContentIndex ? nextEntry : entry;
        });
        updateDialog({ content: nextContent });
    };

    const updateDialogTextEntry = (nextText: string) => {
        if (selectedDialogContentEntry === undefined || selectedDialogContentEntryIsBitmap) {
            return;
        }

        if (typeof selectedDialogContentEntry === "string") {
            updateDialogContentEntry(nextText);
            return;
        }

        if (selectedDialogContentEntryIsObject) {
            updateDialogContentEntry({
                ...(selectedDialogContentEntry as any),
                text: nextText,
            });
        }
    };

    const updateDialogTextClassName = (nextClassName: string) => {
        if (selectedDialogContentEntry === undefined || selectedDialogContentEntryIsBitmap) {
            return;
        }

        if (typeof selectedDialogContentEntry === "string") {
            if (!nextClassName.length) {
                return;
            }
            updateDialogContentEntry({
                text: selectedDialogContentEntry,
                className: nextClassName,
            });
            return;
        }

        if (!selectedDialogContentEntryIsObject) {
            return;
        }

        const entryObject = selectedDialogContentEntry as any;
        const nextText = typeof entryObject.text === "string" ? entryObject.text : "";

        if (!nextClassName.length) {
            const nextEntry = { ...entryObject };
            delete nextEntry.className;
            const remainingKeys = Object.keys(nextEntry).filter((key) => key !== "text");
            if (!remainingKeys.length) {
                updateDialogContentEntry(nextText);
                return;
            }
            updateDialogContentEntry(nextEntry);
            return;
        }

        updateDialogContentEntry({
            ...entryObject,
            text: nextText,
            className: nextClassName,
        });
    };

    const addDialogContentEntry = () => {
        if (!selectedDialog) {
            return;
        }
        const nextContent = [...selectedDialogContent, "New dialog line"];
        updateDialog({ content: nextContent });
        setSelectedDialogContentIndex(nextContent.length - 1);
    };

    const removeDialogContentEntry = () => {
        if (!canDeleteDialogContent) {
            return;
        }
        const nextContent = selectedDialogContent.filter((_: any, index: number) => {
            return index !== selectedDialogContentIndex;
        });
        updateDialog({ content: nextContent });
        setSelectedDialogContentIndex(Math.max(0, selectedDialogContentIndex - 1));
    };

    const moveDialogContentEntry = (direction: -1 | 1) => {
        const from = selectedDialogContentIndex;
        const to = from + direction;
        if (from < 0 || to < 0 || from >= selectedDialogContent.length || to >= selectedDialogContent.length) {
            return;
        }

        const nextContent = [...selectedDialogContent];
        [nextContent[from], nextContent[to]] = [nextContent[to], nextContent[from]];
        updateDialog({ content: nextContent });
        setSelectedDialogContentIndex(to);
    };

    const addElement = () => {
        if (!selectedScreen) {
            return;
        }

        let element: any = "";
        let nextDialogs = script.dialogs;
        switch (newElementType) {
            case "plainText":
                element = "";
                break;

            case "text":
                element = {
                    type: "text",
                    text: "New text",
                };
                break;

            case "alertText":
                element = {
                    type: "text",
                    text: "Alert message",
                    className: "alert",
                };
                break;

            case "noticeText":
                element = {
                    type: "text",
                    text: "Notice message",
                    className: "notice",
                };
                break;

            case "emphasisText":
                element = {
                    type: "text",
                    text: "Emphasis text",
                    className: "emphasis",
                };
                break;

            case "systemText":
                element = {
                    type: "text",
                    text: "System message",
                    className: "system",
                };
                break;

            case "link":
                element = {
                    type: "link",
                    text: "> NEW BUTTON",
                    target: selectedScreen.id,
                };
                break;

            case "bitmap":
                element = {
                    type: "bitmap",
                    src: "https://",
                    alt: "",
                };
                break;

            case "prompt":
                element = {
                    type: "prompt",
                    prompt: "> ",
                    caseSensitive: true,
                    cursor: false,
                    commands: [
                        {
                            command: "back",
                            action: {
                                type: "link",
                                target: selectedScreen.id,
                            },
                        },
                    ],
                };
                break;

            case "login":
                element = {
                    type: "login",
                    usernamePrompt: "username> ",
                    passwordPrompt: "password> ",
                    usernameCaseSensitive: true,
                    hideUsername: false,
                    passwordCaseSensitive: true,
                    hidePassword: true,
                    credentials: [
                        {
                            username: "admin",
                            password: "password",
                            target: selectedScreen.id,
                        },
                    ],
                    noMatchAction: {
                        type: "dialog",
                        target: "",
                    },
                };
                break;

            case "toggle":
                element = {
                    type: "toggle",
                    states: [
                        { active: true, text: "> OPTION 1" },
                        { active: false, text: "> OPTION 2" },
                    ],
                };
                break;

            case "list":
                element = {
                    type: "list",
                    states: [
                        { active: true, text: "> ITEM 1" },
                        { active: false, text: "> ITEM 2" },
                    ],
                };
                break;

            case "dropdown":
                element = {
                    type: "dropdown",
                    states: [
                        { active: true, text: "OPTION 1" },
                        { active: false, text: "OPTION 2" },
                    ],
                };
                break;

            case "reportComposer":
                element = {
                    type: "reportComposer",
                    composerId: "default",
                    titleTemplate: "",
                    template: "",
                    saveTarget: selectedScreen.id,
                    cancelTarget: selectedScreen.id,
                };
                break;

            case "reportList":
                element = {
                    type: "reportList",
                    composerId: "default",
                    emptyText: "[NO REPORTS SAVED]",
                };
                break;

            case "dialogLink": {
                const dialogId = nextDialogId(script.dialogs);
                nextDialogs = [
                    ...script.dialogs,
                    {
                        id: dialogId,
                        type: "alert",
                        content: [
                            "New dialog created from Script Creator.",
                            "Edit this content in raw JSON if needed.",
                        ],
                    },
                ];
                element = {
                    type: "link",
                    text: "> OPEN DIALOG",
                    target: [
                        {
                            type: "dialog",
                            target: dialogId,
                            shiftKey: false,
                        },
                    ],
                };
                break;
            }

            default:
                element = "";
                break;
        }

        const nextIndex = selectedElementIndex + 1;
        updateScript((prev) => ({
            ...prev,
            dialogs: nextDialogs,
            screens: prev.screens.map((screen: any) => {
                if (screen.id !== selectedScreen.id) {
                    return screen;
                }
                const newContent = [...selectedScreen.content];
                newContent.splice(nextIndex, 0, element);
                return {
                    ...screen,
                    content: newContent,
                };
            }),
        }));
        setSelectedElementIndex(nextIndex);
        setRawElementError(null);
    };

    const removeElement = () => {
        if (!selectedScreen || selectedElementIndex < 0 || selectedElementIndex >= selectedScreen.content.length) {
            return;
        }

        const nextContent = selectedScreen.content.filter((_: any, index: number) => index !== selectedElementIndex);
        updateScreen({
            content: nextContent,
        });
        setSelectedElementIndex(Math.max(0, selectedElementIndex - 1));
        setRawElementError(null);
    };

    const moveElement = (direction: -1 | 1) => {
        if (!selectedScreen) {
            return;
        }

        const from = selectedElementIndex;
        const to = from + direction;
        if (from < 0 || to < 0 || to >= selectedScreen.content.length) {
            return;
        }

        const next = [...selectedScreen.content];
        [next[from], next[to]] = [next[to], next[from]];
        updateScreen({ content: next });
        setSelectedElementIndex(to);
    };

    const updateElement = (nextElement: any) => {
        if (!selectedScreen) {
            return;
        }

        const nextContent = selectedScreen.content.map((entry: any, index: number) => {
            return index === selectedElementIndex ? nextElement : entry;
        });

        updateScreen({ content: nextContent });
    };

    // Set (or clear, when "left") the text alignment of the selected object
    // element. Plain string elements are converted to a text object first via
    // their own control, so this only handles object elements.
    const updateElementAlign = (nextAlign: string) => {
        if (!selectedElement || typeof selectedElement !== "object") {
            return;
        }

        const nextElement: any = { ...selectedElement };
        if (!nextAlign || nextAlign === "left") {
            delete nextElement.align;
        } else {
            nextElement.align = nextAlign;
        }
        updateElement(nextElement);
    };

    const updateElementTextSpeed = (nextSpeedRaw: string) => {
        if (!selectedElementSupportsTextSpeed || selectedElement === undefined || selectedElement === null) {
            return;
        }

        const trimmedSpeed = nextSpeedRaw.trim();
        if (!trimmedSpeed.length) {
            if (typeof selectedElement === "string") {
                return;
            }
            const nextElement = {
                ...selectedElement,
            };
            delete (nextElement as any).speed;
            updateElement(nextElement);
            return;
        }

        const parsedSpeed = parseOptionalTextSpeed(trimmedSpeed);
        if (parsedSpeed === undefined) {
            return;
        }

        if (typeof selectedElement === "string") {
            updateElement({
                type: "text",
                text: selectedElement,
                speed: parsedSpeed,
            });
            return;
        }

        updateElement({
            ...selectedElement,
            speed: parsedSpeed,
        });
    };

    const updateLinkTargets = (updater: (prevTargets: LinkTargetEntry[]) => LinkTargetEntry[]) => {
        if (!selectedElementIsLinkLike || !selectedElement || typeof selectedElement !== "object") {
            return;
        }

        const fallbackType: LinkTargetType = selectedElementType === "href" ? "href" : "link";
        const currentTargets = normalizeLinkTargets((selectedElement as any).target, fallbackType, selectedScreen?.id || "");
        const nextTargets = normalizeLinkTargets(updater(currentTargets), fallbackType, selectedScreen?.id || "");
        const target = serializeLinkTargets(nextTargets, fallbackType);
        updateElement({
            ...selectedElement,
            target,
        });
    };

    const addLinkTarget = () => {
        updateLinkTargets((prevTargets) => ([
            ...prevTargets,
            {
                type: "link",
                target: selectedScreen?.id || "",
                shiftKey: false,
            },
        ]));
    };

    const removeLinkTarget = (index: number) => {
        updateLinkTargets((prevTargets) => {
            if (prevTargets.length <= 1) {
                return prevTargets;
            }
            return prevTargets.filter((_, targetIndex) => targetIndex !== index);
        });
    };

    const moveLinkTarget = (index: number, direction: -1 | 1) => {
        updateLinkTargets((prevTargets) => {
            const toIndex = index + direction;
            if (index < 0 || toIndex < 0 || index >= prevTargets.length || toIndex >= prevTargets.length) {
                return prevTargets;
            }

            const nextTargets = [...prevTargets];
            [nextTargets[index], nextTargets[toIndex]] = [nextTargets[toIndex], nextTargets[index]];
            return nextTargets;
        });
    };

    const updatePromptCommands = (updater: (prevCommands: PromptCommandEntry[]) => PromptCommandEntry[]) => {
        if (!selectedElementIsPrompt || !selectedElement || typeof selectedElement !== "object") {
            return;
        }

        const fallbackTarget = selectedScreen?.id || "";
        const currentCommands = normalizePromptCommands((selectedElement as any).commands, fallbackTarget);
        const nextCommands = normalizePromptCommands(updater(currentCommands), fallbackTarget);

        updateElement({
            ...selectedElement,
            commands: nextCommands,
        });
    };

    const addPromptCommand = () => {
        const fallbackTarget = selectedScreen?.id || "";
        updatePromptCommands((prevCommands) => ([
            ...prevCommands,
            {
                command: `command${prevCommands.length + 1}`,
                action: {
                    type: "link",
                    target: fallbackTarget,
                },
            },
        ]));
    };

    const removePromptCommand = (index: number) => {
        updatePromptCommands((prevCommands) => {
            return prevCommands.filter((_, commandIndex) => commandIndex !== index);
        });
    };

    const movePromptCommand = (index: number, direction: -1 | 1) => {
        updatePromptCommands((prevCommands) => {
            const toIndex = index + direction;
            if (index < 0 || toIndex < 0 || index >= prevCommands.length || toIndex >= prevCommands.length) {
                return prevCommands;
            }

            const nextCommands = [...prevCommands];
            [nextCommands[index], nextCommands[toIndex]] = [nextCommands[toIndex], nextCommands[index]];
            return nextCommands;
        });
    };

    const updateLoginCredentials = (updater: (prevCredentials: LoginCredentialEntry[]) => LoginCredentialEntry[]) => {
        if (!selectedElementIsLogin || !selectedElement || typeof selectedElement !== "object") {
            return;
        }

        const fallbackTarget = selectedScreen?.id || "";
        const currentCredentials = normalizeLoginCredentials((selectedElement as any).credentials, fallbackTarget);
        const nextCredentials = normalizeLoginCredentials(updater(currentCredentials), fallbackTarget);
        updateElement({
            ...selectedElement,
            credentials: nextCredentials,
        });
    };

    const addLoginCredential = () => {
        const fallbackTarget = selectedScreen?.id || "";
        updateLoginCredentials((prevCredentials) => ([
            ...prevCredentials,
            {
                username: `user${prevCredentials.length + 1}`,
                password: "",
                target: fallbackTarget,
            },
        ]));
    };

    const removeLoginCredential = (index: number) => {
        updateLoginCredentials((prevCredentials) => {
            return prevCredentials.filter((_, credentialIndex) => credentialIndex !== index);
        });
    };

    const moveLoginCredential = (index: number, direction: -1 | 1) => {
        updateLoginCredentials((prevCredentials) => {
            const toIndex = index + direction;
            if (index < 0 || toIndex < 0 || index >= prevCredentials.length || toIndex >= prevCredentials.length) {
                return prevCredentials;
            }

            const nextCredentials = [...prevCredentials];
            [nextCredentials[index], nextCredentials[toIndex]] = [nextCredentials[toIndex], nextCredentials[index]];
            return nextCredentials;
        });
    };

    const updateLoginNoMatchAction = (updater: (prevAction: PromptActionEntry) => PromptActionEntry) => {
        if (!selectedElementIsLogin || !selectedElement || typeof selectedElement !== "object") {
            return;
        }

        const nextAction = updater(selectedLoginNoMatchAction);
        const type = asPromptActionType(nextAction.type, "dialog");
        const serialized: PromptActionEntry = { type };

        if ((type === "link" || type === "dialog") && typeof nextAction.target === "string") {
            serialized.target = nextAction.target;
        }
        if (type === "action") {
            serialized.action = (nextAction.action || "").trim().length
                ? nextAction.action
                : "resetState";
        }

        updateElement({
            ...selectedElement,
            noMatchAction: serialized,
        });
    };

    const updateCyclerStates = (updater: (prevStates: any[]) => any[]) => {
        if (!selectedElement || typeof selectedElement !== "object" || !selectedElementIsCycler) {
            return;
        }

        const fallbackLabel = selectedElementType === "list" ? "ITEM" : "OPTION";
        const currentStates = normalizeCyclerStates((selectedElement as any).states, fallbackLabel);
        const candidate = updater(currentStates);
        const nextStates = normalizeCyclerStates(candidate, fallbackLabel);
        updateElement({
            ...selectedElement,
            states: nextStates,
        });
    };

    const addCyclerState = () => {
        const label = selectedElementType === "list" ? "ITEM" : "OPTION";
        // dropdowns render each option on its own line, so they skip the "> " prompt prefix
        const prefix = selectedElementType === "dropdown" ? "" : "> ";
        updateCyclerStates((prevStates) => {
            const nextIndex = prevStates.length + 1;
            return [
                ...prevStates,
                {
                    text: `${prefix}${label} ${nextIndex}`,
                    active: false,
                },
            ];
        });
    };

    const removeCyclerState = (index: number) => {
        updateCyclerStates((prevStates) => {
            if (prevStates.length <= 1) {
                return prevStates;
            }
            return prevStates.filter((_: any, stateIndex: number) => stateIndex !== index);
        });
    };

    const moveCyclerState = (index: number, direction: -1 | 1) => {
        updateCyclerStates((prevStates) => {
            const toIndex = index + direction;
            if (index < 0 || toIndex < 0 || index >= prevStates.length || toIndex >= prevStates.length) {
                return prevStates;
            }

            const nextStates = [...prevStates];
            [nextStates[index], nextStates[toIndex]] = [nextStates[toIndex], nextStates[index]];
            return nextStates;
        });
    };

    const renameScreenId = (nextIdRaw: string) => {
        if (!selectedScreen) {
            return;
        }

        const nextId = nextIdRaw.trim();
        if (!nextId || nextId === selectedScreen.id) {
            return;
        }

        const hasDuplicate = script.screens.some((screen: any) => {
            return screen.id === nextId && screen.id !== selectedScreen.id;
        });
        if (hasDuplicate) {
            return;
        }

        const previousId = selectedScreen.id;
        updateScript((prev) => ({
            ...prev,
            screens: prev.screens.map((screen: any) => {
                const updatedScreen = screen.id === previousId
                    ? {
                        ...screen,
                        id: nextId,
                    }
                    : screen;

                return {
                    ...updatedScreen,
                    onDone: updatedScreen.onDone?.target === previousId
                        ? { ...updatedScreen.onDone, target: nextId }
                        : updatedScreen.onDone,
                    content: Array.isArray(updatedScreen.content)
                        ? updatedScreen.content.map((entry: any) => {
                            if (!entry || typeof entry !== "object") {
                                return entry;
                            }
                            if (entry.type !== "link" && entry.type !== "href") {
                                return entry;
                            }
                            if (typeof entry.target !== "string" || entry.target !== previousId) {
                                return entry;
                            }
                            return {
                                ...entry,
                                target: nextId,
                            };
                        })
                        : updatedScreen.content,
                };
            }),
        }));
        setSelectedScreenId(nextId);
    };

    const handleScreenIdDraftChange = (nextIdRaw: string) => {
        setScreenIdDraft(nextIdRaw);
        renameScreenId(nextIdRaw);
    };

    const handleScreenIdDraftBlur = () => {
        setScreenIdDraft(selectedScreen?.id || "");
    };

    const getScriptWithSavedState = (scriptToSave: any) => {
        const saved = cloneJson(scriptToSave);
        saved.config = {
            ...(saved.config || {}),
            previewStartScreen: selectedScreenId,
            previewSelectedElementIndex: selectedElementIndex,
            previewSidebarListMode: sidebarListMode,
        };
        return saved;
    };

    const applyScript = () => {
        onApply(getScriptWithSavedState(script));
    };

    const closeCreator = () => {
        onClose(getScriptWithSavedState(script));
    };

    const saveModule = async (): Promise<void> => {
        if (!onSaveModule || moduleSaveState === "saving") {
            return;
        }

        setModuleSaveState("saving");

        try {
            const saved = await Promise.resolve(onSaveModule(cloneJson(script)));
            setModuleSaveState(saved ? "saved" : "error");
        } catch {
            setModuleSaveState("error");
        }
    };

    const moduleSaveStatusLabel = moduleSaveState === "saving"
        ? "[SAVING MODULE...]"
        : moduleSaveState === "saved"
            ? "[SAVE COMPLETE]"
            : moduleSaveState === "error"
                ? "[SAVE FAILED]"
                : null;
    const selectedScriptIsLocal = selectedScriptId.startsWith("custom:")
        && !selectedScriptId.startsWith("custom:preview:");

    const previewScript = () => {
        if (!selectedScreenId) {
            return;
        }
        onPreview(cloneJson(script), selectedScreenId, selectedElementIndex, sidebarListMode);
    };

    const startNewScript = () => {
        const freshScript = ensureScriptShape(createDefaultScript());
        loadScriptIntoCreator(
            freshScript,
            "",
            String(freshScript.config?.name || "CUSTOM SCRIPT").toUpperCase(),
            false
        );
    };

    const deleteSelectedLocalScript = async (): Promise<void> => {
        if (!onDeleteLocalScript || !selectedScriptIsLocal) {
            return;
        }

        if (!window.confirm(`Delete local script "${selectedScriptLabel}"?`)) {
            return;
        }

        const deleted = await Promise.resolve(onDeleteLocalScript(selectedScriptId));
        if (deleted === false) {
            return;
        }

        delete scriptSnapshotsRef.current[selectedScriptId];
        const fallbackScript = availableScripts.find((scriptOption) => scriptOption.id !== selectedScriptId);
        if (fallbackScript) {
            loadScriptIntoCreator(
                fallbackScript.json,
                fallbackScript.id,
                fallbackScript.label,
                !!fallbackScript.canSaveModule
            );
            return;
        }

        startNewScript();
    };

    const copyJson = async () => {
        const text = JSON.stringify(script, null, 2);
        if (!navigator.clipboard?.writeText) {
            return;
        }
        await navigator.clipboard.writeText(text);
    };

    const downloadJson = () => {
        const text = JSON.stringify(script, null, 2);
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        const name = (script.config?.name || "script").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-");
        anchor.href = url;
        anchor.download = `${name || "script"}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const openImportScreensPicker = () => {
        importFileInputRef.current?.click();
    };

    const openImportPicker = (importedRaw: any) => {
        if (!importedRaw || typeof importedRaw !== "object") {
            setImportStatus({ tone: "error", text: "That file isn't a valid Phosphor script." });
            return;
        }

        const screens = Array.isArray(importedRaw.screens)
            ? importedRaw.screens.filter((screen: any) => screen && typeof screen === "object")
            : [];
        const dialogs = Array.isArray(importedRaw.dialogs)
            ? importedRaw.dialogs.filter((dialog: any) => dialog && typeof dialog === "object")
            : [];

        if (!screens.length && !dialogs.length) {
            setImportStatus({ tone: "error", text: "No screens or dialogs found in that file." });
            return;
        }

        setImportCandidate({ raw: importedRaw, screens, dialogs });
        setImportSelectedIndices(new Set(screens.map((_: any, index: number) => index)));
        setImportSelectedDialogIndices(new Set(dialogs.map((_: any, index: number) => index)));
        setImportPreview(screens.length ? { kind: "screen", index: 0 } : { kind: "dialog", index: 0 });
        setImportStatus(null);
        setImportPickerOpen(true);
    };

    const closeImportPicker = () => {
        setImportPickerOpen(false);
        setImportCandidate(null);
        setImportSelectedIndices(new Set());
        setImportSelectedDialogIndices(new Set());
        setImportPreview(null);
    };

    const toggleImportSelected = (index: number) => {
        setImportSelectedIndices((prev) => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    const toggleImportDialogSelected = (index: number) => {
        setImportSelectedDialogIndices((prev) => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    const selectAllImport = () => {
        if (!importCandidate) {
            return;
        }
        setImportSelectedIndices(new Set(importCandidate.screens.map((_, index) => index)));
        setImportSelectedDialogIndices(new Set(importCandidate.dialogs.map((_, index) => index)));
    };

    const deselectAllImport = () => {
        setImportSelectedIndices(new Set());
        setImportSelectedDialogIndices(new Set());
    };

    const confirmImportSelected = () => {
        if (!importCandidate) {
            return;
        }

        const selectedScreens = importCandidate.screens.filter((_, index) => importSelectedIndices.has(index));
        const selectedDialogs = importCandidate.dialogs.filter((_, index) => importSelectedDialogIndices.has(index));
        if (!selectedScreens.length && !selectedDialogs.length) {
            return;
        }

        const filteredRaw = { ...importCandidate.raw, screens: selectedScreens, dialogs: selectedDialogs };
        const { script: mergedScript, importedScreens, importedDialogs } = buildScriptWithImportedScreens(script, filteredRaw);

        updateScript(() => mergedScript);
        if (importedScreens.length) {
            setSidebarListMode("screens");
            setSelectedScreenId(importedScreens[0].id);
            setSelectedElementIndex(0);
        } else if (importedDialogs.length) {
            setSidebarListMode("dialogs");
            setSelectedDialogFocusId(importedDialogs[0].id);
            setSelectedDialogContentIndex(0);
        }

        const parts: string[] = [];
        if (importedScreens.length) {
            parts.push(`${importedScreens.length} screen${importedScreens.length === 1 ? "" : "s"}`);
        }
        if (importedDialogs.length) {
            parts.push(`${importedDialogs.length} dialog${importedDialogs.length === 1 ? "" : "s"}`);
        }
        setImportStatus({ tone: "success", text: `Imported ${parts.join(" and ")}.` });
        closeImportPicker();
    };

    const handleImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const input = event.target;
        const file = input.files && input.files[0];
        // reset the input so re-selecting the same file still fires onChange
        input.value = "";
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result));
                openImportPicker(parsed);
            } catch {
                setImportStatus({ tone: "error", text: "Could not parse that file as JSON." });
            }
        };
        reader.onerror = () => {
            setImportStatus({ tone: "error", text: "Could not read that file." });
        };
        reader.readAsText(file);
    };

    const handleSidebarResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        resizePointerIdRef.current = event.pointerId;
        resizeStartXRef.current = event.clientX;
        resizeStartWidthRef.current = sidebarWidth;
        setIsResizingSidebar(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleSidebarResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (resizePointerIdRef.current !== event.pointerId) {
            return;
        }

        const deltaX = event.clientX - resizeStartXRef.current;
        setSidebarWidth(clampSidebarWidth(resizeStartWidthRef.current + deltaX));
    };

    const stopSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
        if (resizePointerIdRef.current !== event.pointerId) {
            return;
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        resizePointerIdRef.current = null;
        setIsResizingSidebar(false);
    };

    const handleSidebarResizeLostPointerCapture = () => {
        resizePointerIdRef.current = null;
        setIsResizingSidebar(false);
    };

    const openSearchMatch = (
        match: ScriptSearchMatch,
        index: number,
        selectionMode: PendingSearchSelectionMode = "first"
    ): void => {
        pendingSearchSelectionModeRef.current = selectionMode;
        setSearchFocusRequestId((prev) => prev + 1);
        setActiveView("editor");
        setSearchResultsExpanded(false);
        setActiveSearchMatchIndex(index);
        setActiveVisibleSearchOccurrenceIndex(-1);
        setVisibleSearchOccurrenceCount(0);
        setRawElementError(null);

        if (match.kind === "screen" || match.kind === "element") {
            setSidebarListMode("screens");
            if (match.screenId) {
                setSelectedScreenId(match.screenId);
            }
            setSelectedElementIndex(typeof match.elementIndex === "number" ? match.elementIndex : 0);
            return;
        }

        setSidebarListMode("dialogs");
        if (match.dialogId) {
            setSelectedDialogFocusId(match.dialogId);
        }
        setSelectedDialogContentIndex(typeof match.dialogContentIndex === "number" ? match.dialogContentIndex : 0);
    };

    const stepSearchMatch = (direction: -1 | 1): void => {
        if (!searchMatches.length) {
            return;
        }

        if (activeSearchMatchIndex >= 0) {
            const visibleOccurrences = getEditorSearchOccurrences(editorRef.current, searchQuery, searchMatchCase, searchWholeWord);
            setVisibleSearchOccurrenceCount(visibleOccurrences.length);

            if (visibleOccurrences.length) {
                const baseIndex = activeVisibleSearchOccurrenceIndex < 0
                    ? (direction > 0 ? -1 : visibleOccurrences.length)
                    : activeVisibleSearchOccurrenceIndex;
                const nextVisibleIndex = baseIndex + direction;

                if (nextVisibleIndex >= 0 && nextVisibleIndex < visibleOccurrences.length) {
                    focusEditorSearchOccurrence(visibleOccurrences[nextVisibleIndex]);
                    setActiveVisibleSearchOccurrenceIndex(nextVisibleIndex);
                    return;
                }
            } else if (activeVisibleSearchOccurrenceIndex !== -1) {
                setActiveVisibleSearchOccurrenceIndex(-1);
            }
        }

        const nextIndex = activeSearchMatchIndex < 0
            ? (direction > 0 ? 0 : searchMatches.length - 1)
            : (activeSearchMatchIndex + direction + searchMatches.length) % searchMatches.length;

        openSearchMatch(searchMatches[nextIndex], nextIndex, direction > 0 ? "first" : "last");
    };

    const handleSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
        if (!hasSearchQuery) {
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            stepSearchMatch(1);
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            stepSearchMatch(-1);
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            stepSearchMatch(event.shiftKey ? -1 : 1);
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            setSearchQuery("");
            resetSearchNavigation();
        }
    };

    const renderSearchResults = (expanded: boolean = false) => {
        const resultsClassName = "script-creator__search-results"
            + (expanded ? " script-creator__search-results--expanded" : "");

        return (
            <div className={resultsClassName}>
                {searchMatches.length > 0 ? searchMatches.map((match, index) => (
                    <button
                        key={match.id}
                        type="button"
                        className={
                            "script-creator__search-result"
                            + (index === activeSearchMatchIndex ? " script-creator__search-result--active" : "")
                        }
                        onClick={() => openSearchMatch(match, index)}
                    >
                        <span className="script-creator__search-result-header">
                            <span className="script-creator__search-result-title">{match.title}</span>
                            <span className="script-creator__search-result-meta">
                                {match.matchCount} {match.matchCount === 1 ? "hit" : "hits"}
                            </span>
                        </span>
                        <span className="script-creator__search-result-excerpt">{match.excerpt}</span>
                    </button>
                )) : (
                    <span className="script-creator__hint">No matches in this script.</span>
                )}
            </div>
        );
    };

    return (
        <section
            className={`script-creator script-creator--${creatorColorMode}${isResizingSidebar ? " script-creator--resizing" : ""}`}
            style={open ? undefined : { display: "none" }}
            onKeyDown={handleEditorMarkdownShortcut}
            onClick={closeCreator}
        >
            <div className="script-creator__panel" onClick={(e) => e.stopPropagation()}>
                <div className="script-creator__header">
                    <strong>Script Creator</strong>
                    <div className="script-creator__header-actions">
                        <CreatorSelect
                            className="script-creator-select--actions"
                            value={selectedScriptId}
                            options={scriptSelectOptions}
                            fallbackLabel={selectedScriptLabel}
                            onChange={handleScriptSelect}
                        />
                        <button
                            className="script-creator__btn"
                            onClick={startNewScript}
                        >
                            [NEW SCRIPT]
                        </button>
                        <button
                            className="script-creator__btn"
                            onClick={() => setCreatorColorMode((prev) => getNextCreatorColorMode(prev))}
                        >
                            [MODE: {CREATOR_COLOR_MODE_LABELS[creatorColorMode]}]
                        </button>
                        <button
                            className={"script-creator__btn" + (activeView === "editor" ? " script-creator__btn--active" : "")}
                            onClick={() => setActiveView("editor")}
                        >
                            [EDITOR]
                        </button>
                        <button
                            className={"script-creator__btn" + (activeView === "schema" ? " script-creator__btn--active" : "")}
                            onClick={() => {
                                setSchemaRootId(selectedScreenId);
                                setActiveView("schema");
                            }}
                        >
                            [SCHEMA]
                        </button>
                        <button
                            className="script-creator__btn"
                            onClick={previewScript}
                        >
                            [PREVIEW]
                        </button>
                        <button
                            className={"script-creator__btn" + (configPanelVisible ? " script-creator__btn--active" : "")}
                            onClick={() => setConfigPanelVisible((prev) => !prev)}
                        >
                            [CONFIG: {configPanelVisible ? "ON" : "OFF"}]
                        </button>
                        <button className="script-creator__btn" onClick={closeCreator}>[CLOSE]</button>
                    </div>
                </div>

                <div className="script-creator__search">
                    <div className="script-creator__search-toolbar">
                        <label className="script-creator__field script-creator__search-field">
                            <div className="script-creator__search-label-row">
                                <span>Search</span>
                                <span className="script-creator__search-summary">{searchSummary}</span>
                            </div>
                            <input
                                type="search"
                                className="script-creator__search-input"
                                value={searchQuery}
                                placeholder="Search screens, elements, dialogs"
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    resetSearchNavigation();
                                }}
                                onKeyDown={handleSearchInputKeyDown}
                            />
                        </label>

                        <div className="script-creator__search-controls">
                            <button
                                type="button"
                                className={
                                    "script-creator__btn script-creator__search-toggle"
                                    + (searchMatchCase ? " script-creator__btn--active" : "")
                                }
                                title="Match Case"
                                aria-label="Match Case"
                                aria-pressed={searchMatchCase}
                                onClick={() => {
                                    setSearchMatchCase((prev) => !prev);
                                    resetSearchNavigation();
                                }}
                            >
                                <span className="script-creator__search-symbol">Aa</span>
                            </button>
                            <button
                                type="button"
                                className={
                                    "script-creator__btn script-creator__search-toggle"
                                    + (searchWholeWord ? " script-creator__btn--active" : "")
                                }
                                title="Match Whole Word"
                                aria-label="Match Whole Word"
                                aria-pressed={searchWholeWord}
                                onClick={() => {
                                    setSearchWholeWord((prev) => !prev);
                                    resetSearchNavigation();
                                }}
                            >
                                <span className="script-creator__search-symbol script-creator__search-symbol--whole-word">ab</span>
                            </button>
                            <button
                                type="button"
                                className={
                                    "script-creator__btn script-creator__search-nav"
                                    + (searchResultsVisible ? " script-creator__btn--active" : "")
                                }
                                title={searchResultsVisible ? "Hide Search Results" : "Show Search Results"}
                                aria-label={searchResultsVisible ? "Hide Search Results" : "Show Search Results"}
                                aria-pressed={searchResultsVisible}
                                disabled={!hasSearchQuery}
                                onClick={() => {
                                    setSearchResultsVisible((prev) => !prev);
                                }}
                            >
                                ::
                            </button>
                            <button
                                type="button"
                                className={
                                    "script-creator__btn script-creator__search-nav"
                                    + (shouldExpandSearchResults ? " script-creator__btn--active" : "")
                                }
                                title={shouldExpandSearchResults ? "Show Results Inline" : "Make Results Fill Script"}
                                aria-label={shouldExpandSearchResults ? "Show Results Inline" : "Make Results Fill Script"}
                                aria-pressed={shouldExpandSearchResults}
                                disabled={!shouldShowSearchResults}
                                onClick={() => {
                                    if (!shouldShowSearchResults) {
                                        return;
                                    }
                                    setSearchResultsExpanded((prev) => !prev);
                                }}
                            >
                                []
                            </button>
                            <button
                                type="button"
                                className={
                                    "script-creator__btn script-creator__search-nav"
                                    + (shouldFilterListsToMatches ? " script-creator__btn--active" : "")
                                }
                                title="Only Show Matching List Items"
                                aria-label="Only Show Matching List Items"
                                aria-pressed={shouldFilterListsToMatches}
                                disabled={!hasSearchQuery}
                                onClick={() => {
                                    setFilterListsToMatches((prev) => !prev);
                                }}
                            >
                                L
                            </button>
                            <button
                                type="button"
                                className="script-creator__btn script-creator__search-nav"
                                title="Previous Match"
                                aria-label="Previous Match"
                                disabled={!searchMatches.length}
                                onClick={() => stepSearchMatch(-1)}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                className="script-creator__btn script-creator__search-nav"
                                title="Next Match"
                                aria-label="Next Match"
                                disabled={!searchMatches.length}
                                onClick={() => stepSearchMatch(1)}
                            >
                                ↓
                            </button>
                        </div>
                    </div>

                    {shouldShowSearchResults && !shouldExpandSearchResults && renderSearchResults()}
                </div>

                {shouldExpandSearchResults ? (
                    <div className="script-creator__search-results-panel">
                        {renderSearchResults(true)}
                    </div>
                ) : (
                <div
                    ref={bodyRef}
                    className={"script-creator__body" + (activeView === "schema" ? " script-creator__body--single" : "")}
                    style={activeView === "editor"
                        ? ({ "--creator-sidebar-width": `${sidebarWidth}px` } as React.CSSProperties)
                        : undefined}
                >
                    {activeView === "editor" && (
                    <aside className="script-creator__sidebar">
                        {configPanelVisible && (
                            <div className="script-creator__meta-fields">
                                <label className="script-creator__field">
                                    <span>Name</span>
                                    <input
                                        value={script.config?.name || ""}
                                        onChange={(e) => updateConfig("name", e.target.value)}
                                    />
                                </label>

                                <label className="script-creator__field">
                                    <span>Author</span>
                                    <input
                                        value={script.config?.author || ""}
                                        onChange={(e) => updateConfig("author", e.target.value)}
                                    />
                                </label>

                                <label className="script-creator__field">
                                    <span>Theme Preset</span>
                                    <CreatorSelect
                                        value={scriptThemePreset}
                                        options={SCRIPT_THEME_OPTIONS}
                                        onChange={(nextValue) => {
                                            if (!nextValue.length) {
                                                removeConfigKey("theme");
                                                return;
                                            }

                                            if (nextValue === "custom" && script.config?.customTheme === undefined) {
                                                updateScript((prev) => ({
                                                    ...prev,
                                                    config: {
                                                        ...prev.config,
                                                        theme: "custom",
                                                        customTheme: sanitizeCustomTheme(prev.config?.customTheme || DEFAULT_CUSTOM_THEME),
                                                    },
                                                }));
                                                return;
                                            }

                                            updateConfig("theme", nextValue);
                                        }}
                                    />
                                </label>

                                <label className="script-creator__field">
                                    <span>Default Text Speed (ms)</span>
                                    <CreatorSpeedInput
                                        value={scriptDefaultTextSpeedMs === undefined ? "" : String(scriptDefaultTextSpeedMs)}
                                        placeholder={String(PHOSPHOR_DEFAULT_TEXT_SPEED_MS)}
                                        onChange={(nextValue) => {
                                            if (!nextValue.trim().length) {
                                                removeConfigKey("defaultTextSpeed");
                                                return;
                                            }

                                            const parsed = parseOptionalTextSpeed(nextValue);
                                            if (parsed === undefined) {
                                                return;
                                            }

                                            updateConfig("defaultTextSpeed", parsed);
                                        }}
                                    />
                                </label>

                                {scriptThemePreset === "custom" && (
                                    <>
                                        <label className="script-creator__field">
                                            <span>Custom Theme Base</span>
                                            <CreatorSelect
                                                value={scriptCustomTheme.baseThemeId}
                                                options={CUSTOM_THEME_BASE_OPTIONS}
                                                fallbackLabel={scriptCustomTheme.baseThemeId}
                                                onChange={(nextValue) => updateCustomThemeConfig({ baseThemeId: nextValue })}
                                            />
                                        </label>

                                        <label className="script-creator__field">
                                            <span>FG</span>
                                            <input
                                                type="color"
                                                value={scriptCustomTheme.fgHex}
                                                onChange={(e) => updateCustomThemeConfig({ fgHex: e.target.value })}
                                            />
                                        </label>

                                        <label className="script-creator__field">
                                            <span>Alert</span>
                                            <input
                                                type="color"
                                                value={scriptCustomTheme.alertHex}
                                                onChange={(e) => updateCustomThemeConfig({ alertHex: e.target.value })}
                                            />
                                        </label>

                                        <label className="script-creator__field">
                                            <span>Emphasis</span>
                                            <input
                                                type="color"
                                                value={scriptCustomTheme.emphasisHex}
                                                onChange={(e) => updateCustomThemeConfig({ emphasisHex: e.target.value })}
                                            />
                                        </label>

                                        <label className="script-creator__field">
                                            <span>Notice</span>
                                            <input
                                                type="color"
                                                value={scriptCustomTheme.noticeHex}
                                                onChange={(e) => updateCustomThemeConfig({ noticeHex: e.target.value })}
                                            />
                                        </label>

                                        <label className="script-creator__field">
                                            <span>Hyperlink</span>
                                            <input
                                                type="color"
                                                value={scriptCustomTheme.hyperlinkHex}
                                                onChange={(e) => updateCustomThemeConfig({ hyperlinkHex: e.target.value })}
                                            />
                                        </label>

                                        <label className="script-creator__field">
                                            <span>System</span>
                                            <input
                                                type="color"
                                                value={scriptCustomTheme.systemHex}
                                                onChange={(e) => updateCustomThemeConfig({ systemHex: e.target.value })}
                                            />
                                        </label>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="script-creator__list-header">
                            <span>{sidebarListMode === "screens" ? "Screens" : "Dialogs"}</span>
                            <div className="script-creator__actions script-creator__actions--sidebar-switch">
                                <button
                                    className="script-creator__btn"
                                    onClick={() => {
                                        setSidebarListMode((prev) => prev === "screens" ? "dialogs" : "screens");
                                    }}
                                >
                                    [{sidebarListMode === "screens" ? "SHOW DIALOGS" : "SHOW SCREENS"}]
                                </button>
                                {sidebarListMode === "screens" ? (
                                    <button className="script-creator__btn" onClick={addScreen}>[+ SCREEN]</button>
                                ) : (
                                    <button className="script-creator__btn" onClick={addDialog}>[+ DIALOG]</button>
                                )}
                            </div>
                        </div>

                        <div className={"script-creator__list " + (sidebarListMode === "screens" ? "script-creator__list--screens" : "script-creator__list--dialogs")}>
                            {sidebarListMode === "screens" && !visibleScreens.length && (
                                <span className="script-creator__hint">
                                    {shouldFilterListsToMatches ? "No matching screens." : "No screens in this script."}
                                </span>
                            )}
                            {sidebarListMode === "screens" && visibleScreens.map((screen: any) => (
                                <button
                                    key={screen.id}
                                    className={"script-creator__list-item" + (screen.id === selectedScreenId ? " script-creator__list-item--active" : "")}
                                    onClick={() => {
                                        setSelectedScreenId(screen.id);
                                        setSelectedElementIndex(0);
                                        setRawElementError(null);
                                    }}
                                >
                                    {screen.id}
                                </button>
                            ))}

                            {sidebarListMode === "dialogs" && !visibleDialogs.length && (
                                <span className="script-creator__hint">
                                    {shouldFilterListsToMatches ? "No matching dialogs." : "No dialogs in this script."}
                                </span>
                            )}
                            {sidebarListMode === "dialogs" && visibleDialogs.map((dialog: any, index: number) => {
                                const dialogId = (dialog?.id || "(unnamed)").toString();
                                return (
                                    <button
                                        key={`${dialogId}-${index}`}
                                        className={"script-creator__list-item" + (selectedDialogFocusId === dialogId ? " script-creator__list-item--active" : "")}
                                        onClick={() => {
                                            setSelectedDialogFocusId(dialogId);
                                            setSelectedDialogContentIndex(0);
                                            setRawElementError(null);
                                        }}
                                    >
                                        {dialogId}
                                </button>
                            );
                        })}
                        </div>

                        {sidebarListMode === "screens" && (
                            <div className="script-creator__actions script-creator__actions--screen-controls">
                                <button className="script-creator__btn" onClick={() => moveScreen(-1)} disabled={!canMoveScreenUp}>[MOVE UP]</button>
                                <button className="script-creator__btn" onClick={() => moveScreen(1)} disabled={!canMoveScreenDown}>[MOVE DOWN]</button>
                                <button className="script-creator__btn" onClick={removeScreen} disabled={script.screens.length <= 1}>[DELETE]</button>
                            </div>
                        )}

                        {sidebarListMode === "dialogs" && (
                            <div className="script-creator__actions script-creator__actions--dialog-controls">
                                <button className="script-creator__btn" onClick={() => moveDialog(-1)} disabled={!canMoveDialogUp}>[MOVE UP]</button>
                                <button className="script-creator__btn" onClick={() => moveDialog(1)} disabled={!canMoveDialogDown}>[MOVE DOWN]</button>
                                <button className="script-creator__btn" onClick={removeDialog} disabled={!canDeleteDialog}>[DELETE]</button>
                            </div>
                        )}
                    </aside>
                    )}

                    {activeView === "editor" && (
                    <div
                        className={"script-creator__resize-handle" + (isResizingSidebar ? " script-creator__resize-handle--active" : "")}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize sidebar"
                        onPointerDown={handleSidebarResizePointerDown}
                        onPointerMove={handleSidebarResizePointerMove}
                        onPointerUp={stopSidebarResize}
                        onPointerCancel={stopSidebarResize}
                        onLostPointerCapture={handleSidebarResizeLostPointerCapture}
                    />
                    )}

                    {activeView === "editor" && (
                    <main ref={editorRef} className="script-creator__editor">
                        {sidebarListMode === "screens" && selectedScreen && (
                            <div className="script-creator__editor-content">
                                <div className="script-creator__row script-creator__row--screen-header">
                                    <label className="script-creator__field">
                                        <span>Screen ID</span>
                                        <input
                                            value={screenIdDraft}
                                            onChange={(e) => handleScreenIdDraftChange(e.target.value)}
                                            onBlur={handleScreenIdDraftBlur}
                                        />
                                    </label>

                                    <div className="script-creator__actions script-creator__actions--screen-header">
                                        <button
                                            className={"script-creator__btn" + (screenControlsOpen ? " script-creator__btn--active" : "")}
                                            onClick={() => setScreenControlsOpen((prev) => !prev)}
                                            disabled={!selectedScreen}
                                        >
                                            [CONTROLS]
                                        </button>
                                        <button
                                            className={"script-creator__btn" + (screenEditorMode === "raw" ? " script-creator__btn--active" : "")}
                                            onClick={() => setScreenEditorMode((prev) => prev === "fields" ? "raw" : "fields")}
                                            disabled={!selectedScreen}
                                        >
                                            Raw Screen Json
                                        </button>
                                    </div>

                                    <label className="script-creator__field">
                                        <span>Type</span>
                                        <CreatorSelect
                                            value={selectedScreen.type}
                                            options={SCREEN_TYPE_OPTIONS}
                                            fallbackLabel={selectedScreen.type}
                                            onChange={(nextType) => updateScreen({ type: nextType })}
                                        />
                                    </label>
                                </div>

                                {screenEditorMode === "raw" && selectedScreen && (
                                    <div className="script-creator__screen-raw-panel">
                                        <label className="script-creator__field script-creator__field--fill">
                                            <span>Raw Screen JSON</span>
                                            <textarea
                                                className="script-creator__textarea-fill"
                                                data-search-exclude="true"
                                                spellCheck={false}
                                                value={rawScreenDraft}
                                                onChange={(e) => {
                                                    const nextRaw = e.target.value;
                                                    setRawScreenDraft(nextRaw);
                                                    try {
                                                        const parsed = JSON.parse(nextRaw);
                                                        replaceSelectedScreen(parsed);
                                                        setRawScreenError(null);
                                                    } catch {
                                                        setRawScreenError(null);
                                                    }
                                                }}
                                                onBlur={() => {
                                                    try {
                                                        const parsed = JSON.parse(rawScreenDraft);
                                                        replaceSelectedScreen(parsed);
                                                        setRawScreenError(null);
                                                    } catch {
                                                        setRawScreenError("JSON parse error");
                                                    }
                                                }}
                                            />
                                        </label>
                                        {rawScreenError && <div className="script-creator__error">{rawScreenError}</div>}
                                    </div>
                                )}

                                <div className="script-creator__list-header">
                                    <span>Elements</span>
                                    <div className="script-creator__actions">
                                        <CreatorSelect
                                            className="script-creator-select--actions"
                                            value={newElementType}
                                            options={ADDABLE_ELEMENT_OPTIONS}
                                            onChange={(nextType) => setNewElementType(nextType as AddableElementType)}
                                        />
                                        <button className="script-creator__btn" onClick={addElement}>[ADD ELEMENT]</button>
                                        <button
                                            className="script-creator__btn"
                                            onClick={() => setElementEditorMode((prev) => prev === "fields" ? "raw" : "fields")}
                                        >
                                            Raw Element Json
                                        </button>
                                    </div>
                                </div>

                                <div className="script-creator__element-layout">
                                    <div className="script-creator__element-list-panel">
                                        <div className="script-creator__list script-creator__list--elements">
                                            {!visibleElementEntries.length && (
                                                <span className="script-creator__hint">
                                                    {shouldFilterListsToMatches ? "No matching elements in this screen." : "No elements in this screen."}
                                                </span>
                                            )}
                                            {visibleElementEntries.map(({ index, label }: IndexedLabeledEntry) => {
                                                return (
                                                    <button
                                                        key={`${selectedScreen.id}-${index}`}
                                                        className={"script-creator__list-item" + (index === selectedElementIndex ? " script-creator__list-item--active" : "")}
                                                        onClick={() => {
                                                            setSelectedElementIndex(index);
                                                            setRawElementError(null);
                                                        }}
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        <div className="script-creator__actions script-creator__actions--element-controls">
                                            <button
                                                className="script-creator__btn"
                                                onClick={() => moveElement(-1)}
                                                disabled={!canMoveElementUp}
                                            >
                                                [MOVE UP]
                                            </button>
                                            <button
                                                className="script-creator__btn"
                                                onClick={() => moveElement(1)}
                                                disabled={!canMoveElementDown}
                                            >
                                                [MOVE DOWN]
                                            </button>
                                            <button
                                                className="script-creator__btn"
                                                onClick={removeElement}
                                                disabled={!canDeleteElement}
                                            >
                                                [DELETE]
                                            </button>
                                        </div>
                                    </div>

                                    <div className="script-creator__element-editor">
                                        {screenControlsOpen && selectedScreen && (
                                            <div className="script-creator__screen-controls-panel">
                                                <label className="script-creator__field">
                                                    <span>On Done Target</span>
                                                    <CreatorSelect
                                                        value={selectedScreenOnDoneTarget}
                                                        options={targetSelectOptions}
                                                        editable
                                                        placeholder="screen id"
                                                        onChange={updateScreenOnDoneTarget}
                                                    />
                                                </label>

                                                {selectedScreenOnDoneTarget.length > 0 && (
                                                    <label className="script-creator__field">
                                                        <span>On Done Delay (ms)</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="1"
                                                            value={selectedScreenOnDoneDelayMs}
                                                            placeholder="0"
                                                            onChange={(e) => updateScreenOnDoneDelayMs(e.target.value)}
                                                        />
                                                    </label>
                                                )}

                                                <label className="script-creator__field">
                                                    <span>Default Text Speed (ms)</span>
                                                    <CreatorSpeedInput
                                                        key={`screen-speed-${selectedScreen.id}`}
                                                        value={selectedScreenDefaultTextSpeed}
                                                        placeholder={String(resolvedScriptDefaultTextSpeedMs)}
                                                        onChange={updateScreenDefaultTextSpeed}
                                                    />
                                                </label>

                                                {showAlienHeaderTitle && (
                                                    <label className="script-creator__field">
                                                        <span>Header Title</span>
                                                        <input
                                                            value={selectedScreen.headerTitle || ""}
                                                            placeholder={alienHeaderTitleFallback}
                                                            onChange={(e) => {
                                                                const nextValue = e.target.value;
                                                                updateScreen({ headerTitle: nextValue.length ? nextValue : undefined });
                                                            }}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        )}

                                        {elementEditorMode === "fields" && (
                                            <>
                                                {typeof selectedElement === "string" && (
                                                    <>
                                                        <label className="script-creator__field script-creator__field--fill">
                                                            <span>Text</span>
                                                            <textarea
                                                                className="script-creator__textarea-fill"
                                                                value={selectedElement}
                                                                onChange={(e) => updateElement(e.target.value)}
                                                            />
                                                            <small className="script-creator__markdown-hint">
                                                                Markdown: `#`, `**bold**`, `*italic*`, `__underline__`, `~~strikethrough~~`, `[label](url)`, `- bullets`, `&gt; quote`, `\&gt;` literal `&gt;`, `---`
                                                            </small>
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Class Name (Apply Style)</span>
                                                            <CreatorSelect
                                                                value=""
                                                                options={TEXT_LINE_STYLE_OPTIONS}
                                                                onChange={(nextClassName) => {
                                                                    if (!nextClassName.length) {
                                                                        return;
                                                                    }
                                                                    updateElement({
                                                                        type: "text",
                                                                        text: selectedElement,
                                                                        className: nextClassName,
                                                                    });
                                                                }}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Text Align</span>
                                                            <CreatorSelect
                                                                value="left"
                                                                options={TEXT_ALIGN_OPTIONS}
                                                                onChange={(nextAlign) => {
                                                                    if (!nextAlign || nextAlign === "left") {
                                                                        return;
                                                                    }
                                                                    // A plain string can't hold an align property,
                                                                    // so promote it to a text object (same as styling).
                                                                    updateElement({
                                                                        type: "text",
                                                                        text: selectedElement,
                                                                        align: nextAlign,
                                                                    });
                                                                }}
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && (selectedElement.type === "link" || selectedElement.type === "href") && (
                                                    <>
                                                        <label className="script-creator__field">
                                                            <span>Button Text</span>
                                                            <input
                                                                value={selectedElement.text || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, text: e.target.value })}
                                                            />
                                                        </label>

                                                        <div className="script-creator__link-targets">
                                                            <div className="script-creator__list-header">
                                                                <span>Targets</span>
                                                                <button className="script-creator__btn" onClick={addLinkTarget}>[+ TARGET]</button>
                                                            </div>

                                                            {selectedLinkTargets.map((targetEntry: LinkTargetEntry, targetIndex: number) => {
                                                                const targetLabel = targetEntry.type === "dialog"
                                                                    ? "Dialog ID"
                                                                    : targetEntry.type === "href"
                                                                        ? "URL"
                                                                        : "Target";
                                                                const canMoveUp = targetIndex > 0;
                                                                const canMoveDown = targetIndex < selectedLinkTargets.length - 1;

                                                                return (
                                                                    <div key={`link-target-${targetIndex}`} className="script-creator__link-target-row">
                                                                        <div className="script-creator__link-target-grid">
                                                                            <label className="script-creator__field">
                                                                                <span>Type</span>
                                                                                <CreatorSelect
                                                                                    value={targetEntry.type}
                                                                                    options={LINK_TARGET_TYPE_OPTIONS}
                                                                                    onChange={(nextTypeRaw) => {
                                                                                        const nextType = asLinkTargetType(nextTypeRaw, "link");
                                                                                        updateLinkTargets((prevTargets) => {
                                                                                            return prevTargets.map((entry, index) => {
                                                                                                if (index !== targetIndex) {
                                                                                                    return entry;
                                                                                                }

                                                                                                const next: LinkTargetEntry = {
                                                                                                    ...entry,
                                                                                                    type: nextType,
                                                                                                    action: nextType === "action"
                                                                                                        ? (entry.action || "resetState")
                                                                                                        : undefined,
                                                                                                };

                                                                                                if (nextType === "dialog" && !next.target.trim().length) {
                                                                                                    next.target = (script.dialogs?.[0]?.id || "").toString();
                                                                                                }

                                                                                                return next;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>

                                                                            <label className="script-creator__field">
                                                                                <span>Shift / Long Press</span>
                                                                                <CreatorSelect
                                                                                    value={targetEntry.shiftKey ? "true" : "false"}
                                                                                    options={BOOLEAN_OPTIONS}
                                                                                    onChange={(nextValue) => {
                                                                                        const nextShiftKey = nextValue === "true";
                                                                                        updateLinkTargets((prevTargets) => {
                                                                                            return prevTargets.map((entry, index) => {
                                                                                                return index === targetIndex
                                                                                                    ? { ...entry, shiftKey: nextShiftKey }
                                                                                                    : entry;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                        </div>

                                                                        <label className="script-creator__field">
                                                                            <span>{targetLabel}{targetEntry.type === "action" ? " (optional)" : ""}</span>
                                                                            <CreatorSelect
                                                                                value={targetEntry.target || ""}
                                                                                options={targetSelectOptions}
                                                                                editable
                                                                                placeholder={targetEntry.type === "dialog" ? "dialog id" : "screen id"}
                                                                                onChange={(nextTarget) => {
                                                                                    updateLinkTargets((prevTargets) => {
                                                                                        return prevTargets.map((entry, index) => {
                                                                                            return index === targetIndex
                                                                                                ? { ...entry, target: nextTarget }
                                                                                                : entry;
                                                                                        });
                                                                                    });
                                                                                }}
                                                                            />
                                                                        </label>

                                                                        {targetEntry.type === "action" && (
                                                                            <label className="script-creator__field">
                                                                                <span>Action</span>
                                                                                <input
                                                                                    value={targetEntry.action || ""}
                                                                                    onChange={(e) => {
                                                                                        const nextAction = e.target.value;
                                                                                        updateLinkTargets((prevTargets) => {
                                                                                            return prevTargets.map((entry, index) => {
                                                                                                return index === targetIndex
                                                                                                    ? { ...entry, action: nextAction }
                                                                                                    : entry;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                        )}

                                                                        <div className="script-creator__actions script-creator__actions--link-target">
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => moveLinkTarget(targetIndex, -1)}
                                                                                disabled={!canMoveUp}
                                                                            >
                                                                                [UP]
                                                                            </button>
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => moveLinkTarget(targetIndex, 1)}
                                                                                disabled={!canMoveDown}
                                                                            >
                                                                                [DOWN]
                                                                            </button>
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => removeLinkTarget(targetIndex)}
                                                                                disabled={selectedLinkTargets.length <= 1}
                                                                            >
                                                                                [DELETE]
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && selectedElementIsPrompt && (
                                                    <>
                                                        <label className="script-creator__field">
                                                            <span>Prompt Text</span>
                                                            <input
                                                                value={selectedElement.prompt || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, prompt: e.target.value })}
                                                            />
                                                        </label>

                                                        <div className="script-creator__link-target-grid">
                                                            <label className="script-creator__field">
                                                                <span>Case Sensitive</span>
                                                                <CreatorSelect
                                                                    value={selectedElement.caseSensitive === false ? "false" : "true"}
                                                                    options={BOOLEAN_OPTIONS}
                                                                    onChange={(nextValue) => updateElement({
                                                                        ...selectedElement,
                                                                        caseSensitive: nextValue === "true",
                                                                    })}
                                                                />
                                                            </label>

                                                            <label className="script-creator__field">
                                                                <span>Blinking Cursor</span>
                                                                <CreatorSelect
                                                                    value={selectedElement.cursor === true ? "true" : "false"}
                                                                    options={BOOLEAN_OPTIONS}
                                                                    onChange={(nextValue) => updateElement({
                                                                        ...selectedElement,
                                                                        cursor: nextValue === "true",
                                                                    })}
                                                                />
                                                            </label>
                                                        </div>

                                                        <div className="script-creator__link-targets">
                                                            <div className="script-creator__list-header">
                                                                <span>Commands</span>
                                                                <button className="script-creator__btn" onClick={addPromptCommand}>[+ COMMAND]</button>
                                                            </div>

                                                            {!selectedPromptCommands.length && (
                                                                <span className="script-creator__hint">No commands configured.</span>
                                                            )}

                                                            {selectedPromptCommands.map((promptCommand: PromptCommandEntry, commandIndex: number) => {
                                                                const actionType = asPromptActionType(promptCommand.action?.type, "link");
                                                                const needsTarget = actionType === "link" || actionType === "dialog";
                                                                const canMoveUp = commandIndex > 0;
                                                                const canMoveDown = commandIndex < selectedPromptCommands.length - 1;

                                                                return (
                                                                    <div key={`prompt-command-${commandIndex}`} className="script-creator__link-target-row">
                                                                        <div className="script-creator__link-target-grid">
                                                                            <label className="script-creator__field">
                                                                                <span>Command</span>
                                                                                <input
                                                                                    value={promptCommand.command}
                                                                                    onChange={(e) => {
                                                                                        const nextCommand = e.target.value;
                                                                                        updatePromptCommands((prevCommands) => {
                                                                                            return prevCommands.map((entry, index) => {
                                                                                                return index === commandIndex
                                                                                                    ? { ...entry, command: nextCommand }
                                                                                                    : entry;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>

                                                                            <label className="script-creator__field">
                                                                                <span>Type</span>
                                                                                <CreatorSelect
                                                                                    value={actionType}
                                                                                    options={PROMPT_ACTION_TYPE_OPTIONS}
                                                                                    onChange={(nextTypeRaw) => {
                                                                                        const nextType = asPromptActionType(nextTypeRaw, "link");
                                                                                        updatePromptCommands((prevCommands) => {
                                                                                            return prevCommands.map((entry, index) => {
                                                                                                if (index !== commandIndex) {
                                                                                                    return entry;
                                                                                                }

                                                                                                const nextAction: PromptActionEntry = {
                                                                                                    ...entry.action,
                                                                                                    type: nextType,
                                                                                                };

                                                                                                if (nextType === "action" && !nextAction.action) {
                                                                                                    nextAction.action = "resetState";
                                                                                                }

                                                                                                if (
                                                                                                    (nextType === "link" || nextType === "dialog")
                                                                                                    && (!nextAction.target || !nextAction.target.length)
                                                                                                ) {
                                                                                                    nextAction.target = selectedScreen?.id || "";
                                                                                                }

                                                                                                if (nextType !== "action") {
                                                                                                    delete nextAction.action;
                                                                                                }

                                                                                                if (nextType !== "link" && nextType !== "dialog") {
                                                                                                    delete nextAction.target;
                                                                                                }

                                                                                                return {
                                                                                                    ...entry,
                                                                                                    action: nextAction,
                                                                                                };
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                        </div>

                                                                        {needsTarget && (
                                                                            <label className="script-creator__field">
                                                                                <span>{actionType === "dialog" ? "Dialog ID" : "Target Screen"}</span>
                                                                                <CreatorSelect
                                                                                    value={promptCommand.action?.target || ""}
                                                                                    options={targetSelectOptions}
                                                                                    editable
                                                                                    placeholder={actionType === "dialog" ? "dialog id" : "screen id"}
                                                                                    onChange={(nextTarget) => {
                                                                                        updatePromptCommands((prevCommands) => {
                                                                                            return prevCommands.map((entry, index) => {
                                                                                                return index === commandIndex
                                                                                                    ? {
                                                                                                        ...entry,
                                                                                                        action: {
                                                                                                            ...entry.action,
                                                                                                            target: nextTarget,
                                                                                                        },
                                                                                                    }
                                                                                                    : entry;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                        )}

                                                                        {actionType === "action" && (
                                                                            <label className="script-creator__field">
                                                                                <span>Action</span>
                                                                                <input
                                                                                    value={promptCommand.action?.action || ""}
                                                                                    onChange={(e) => {
                                                                                        const nextAction = e.target.value;
                                                                                        updatePromptCommands((prevCommands) => {
                                                                                            return prevCommands.map((entry, index) => {
                                                                                                return index === commandIndex
                                                                                                    ? {
                                                                                                        ...entry,
                                                                                                        action: {
                                                                                                            ...entry.action,
                                                                                                            action: nextAction,
                                                                                                        },
                                                                                                    }
                                                                                                    : entry;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                        )}

                                                                        <div className="script-creator__actions script-creator__actions--link-target">
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => movePromptCommand(commandIndex, -1)}
                                                                                disabled={!canMoveUp}
                                                                            >
                                                                                [UP]
                                                                            </button>
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => movePromptCommand(commandIndex, 1)}
                                                                                disabled={!canMoveDown}
                                                                            >
                                                                                [DOWN]
                                                                            </button>
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => removePromptCommand(commandIndex)}
                                                                            >
                                                                                [DELETE]
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && selectedElementIsLogin && (
                                                    <>
                                                        <label className="script-creator__field">
                                                            <span>Username Prompt</span>
                                                            <input
                                                                value={selectedElement.usernamePrompt || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, usernamePrompt: e.target.value })}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Password Prompt</span>
                                                            <input
                                                                value={selectedElement.passwordPrompt || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, passwordPrompt: e.target.value })}
                                                            />
                                                        </label>

                                                        <div className="script-creator__link-target-grid">
                                                            <label className="script-creator__field">
                                                                <span>Username Case Sensitive</span>
                                                                <CreatorSelect
                                                                    value={selectedElement.usernameCaseSensitive === false ? "false" : "true"}
                                                                    options={BOOLEAN_OPTIONS}
                                                                    onChange={(nextValue) => updateElement({
                                                                        ...selectedElement,
                                                                        usernameCaseSensitive: nextValue === "true",
                                                                    })}
                                                                />
                                                            </label>

                                                            <label className="script-creator__field">
                                                                <span>Hide Username</span>
                                                                <CreatorSelect
                                                                    value={selectedElement.hideUsername === true ? "true" : "false"}
                                                                    options={BOOLEAN_OPTIONS}
                                                                    onChange={(nextValue) => updateElement({
                                                                        ...selectedElement,
                                                                        hideUsername: nextValue === "true",
                                                                    })}
                                                                />
                                                            </label>
                                                        </div>

                                                        <div className="script-creator__link-target-grid">
                                                            <label className="script-creator__field">
                                                                <span>Password Case Sensitive</span>
                                                                <CreatorSelect
                                                                    value={selectedElement.passwordCaseSensitive === false ? "false" : "true"}
                                                                    options={BOOLEAN_OPTIONS}
                                                                    onChange={(nextValue) => updateElement({
                                                                        ...selectedElement,
                                                                        passwordCaseSensitive: nextValue === "true",
                                                                    })}
                                                                />
                                                            </label>

                                                            <label className="script-creator__field">
                                                                <span>Hide Password</span>
                                                                <CreatorSelect
                                                                    value={selectedElement.hidePassword === false ? "false" : "true"}
                                                                    options={BOOLEAN_OPTIONS}
                                                                    onChange={(nextValue) => updateElement({
                                                                        ...selectedElement,
                                                                        hidePassword: nextValue === "true",
                                                                    })}
                                                                />
                                                            </label>
                                                        </div>

                                                        <div className="script-creator__link-targets">
                                                            <div className="script-creator__list-header">
                                                                <span>Credential Matches</span>
                                                                <button className="script-creator__btn" onClick={addLoginCredential}>[+ CREDENTIAL]</button>
                                                            </div>

                                                            {!selectedLoginCredentials.length && (
                                                                <span className="script-creator__hint">No credentials configured.</span>
                                                            )}

                                                            {selectedLoginCredentials.map((credential: LoginCredentialEntry, credentialIndex: number) => {
                                                                const canMoveUp = credentialIndex > 0;
                                                                const canMoveDown = credentialIndex < selectedLoginCredentials.length - 1;
                                                                return (
                                                                    <div key={`login-credential-${credentialIndex}`} className="script-creator__link-target-row">
                                                                        <div className="script-creator__link-target-grid">
                                                                            <label className="script-creator__field">
                                                                                <span>Username</span>
                                                                                <input
                                                                                    value={credential.username}
                                                                                    onChange={(e) => {
                                                                                        const nextUsername = e.target.value;
                                                                                        updateLoginCredentials((prevCredentials) => {
                                                                                            return prevCredentials.map((entry, index) => {
                                                                                                return index === credentialIndex
                                                                                                    ? { ...entry, username: nextUsername }
                                                                                                    : entry;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>

                                                                            <label className="script-creator__field">
                                                                                <span>Password</span>
                                                                                <input
                                                                                    value={credential.password}
                                                                                    onChange={(e) => {
                                                                                        const nextPassword = e.target.value;
                                                                                        updateLoginCredentials((prevCredentials) => {
                                                                                            return prevCredentials.map((entry, index) => {
                                                                                                return index === credentialIndex
                                                                                                    ? { ...entry, password: nextPassword }
                                                                                                    : entry;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                        </div>

                                                                        <label className="script-creator__field">
                                                                            <span>Success Target Screen</span>
                                                                            <CreatorSelect
                                                                                value={credential.target || ""}
                                                                                options={targetSelectOptions}
                                                                                editable
                                                                                placeholder="screen id"
                                                                                onChange={(nextTarget) => {
                                                                                    updateLoginCredentials((prevCredentials) => {
                                                                                        return prevCredentials.map((entry, index) => {
                                                                                            return index === credentialIndex
                                                                                                ? { ...entry, target: nextTarget }
                                                                                                : entry;
                                                                                        });
                                                                                    });
                                                                                }}
                                                                            />
                                                                        </label>

                                                                        <div className="script-creator__actions script-creator__actions--link-target">
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => moveLoginCredential(credentialIndex, -1)}
                                                                                disabled={!canMoveUp}
                                                                            >
                                                                                [UP]
                                                                            </button>
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => moveLoginCredential(credentialIndex, 1)}
                                                                                disabled={!canMoveDown}
                                                                            >
                                                                                [DOWN]
                                                                            </button>
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => removeLoginCredential(credentialIndex)}
                                                                                disabled={selectedLoginCredentials.length <= 1}
                                                                            >
                                                                                [DELETE]
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>

                                                        <div className="script-creator__link-targets">
                                                            <div className="script-creator__list-header">
                                                                <span>No Match Action</span>
                                                            </div>

                                                            <div className="script-creator__link-target-row">
                                                                <div className="script-creator__link-target-grid">
                                                                    <label className="script-creator__field">
                                                                        <span>Type</span>
                                                                        <CreatorSelect
                                                                            value={asPromptActionType(selectedLoginNoMatchAction.type, "dialog")}
                                                                            options={PROMPT_ACTION_TYPE_OPTIONS}
                                                                            onChange={(nextTypeRaw) => {
                                                                                const nextType = asPromptActionType(nextTypeRaw, "dialog");
                                                                                updateLoginNoMatchAction((prevAction) => {
                                                                                    const nextAction: PromptActionEntry = {
                                                                                        ...prevAction,
                                                                                        type: nextType,
                                                                                    };
                                                                                    if (nextType === "action" && !nextAction.action) {
                                                                                        nextAction.action = "resetState";
                                                                                    }
                                                                                    if (nextType === "link" && (!nextAction.target || !nextAction.target.length)) {
                                                                                        nextAction.target = selectedScreen?.id || "";
                                                                                    }
                                                                                    if (nextType === "dialog" && typeof nextAction.target !== "string") {
                                                                                        nextAction.target = "";
                                                                                    }
                                                                                    if (nextType !== "action") {
                                                                                        delete nextAction.action;
                                                                                    }
                                                                                    if (nextType !== "link" && nextType !== "dialog") {
                                                                                        delete nextAction.target;
                                                                                    }
                                                                                    return nextAction;
                                                                                });
                                                                            }}
                                                                        />
                                                                    </label>
                                                                </div>

                                                                {(selectedLoginNoMatchAction.type === "link" || selectedLoginNoMatchAction.type === "dialog") && (
                                                                    <label className="script-creator__field">
                                                                        <span>{selectedLoginNoMatchAction.type === "dialog" ? "Dialog ID" : "Target Screen"}</span>
                                                                        <CreatorSelect
                                                                            value={selectedLoginNoMatchAction.target || ""}
                                                                            options={targetSelectOptions}
                                                                            editable
                                                                            placeholder={selectedLoginNoMatchAction.type === "dialog" ? "dialog id" : "screen id"}
                                                                            onChange={(nextTarget) => {
                                                                                updateLoginNoMatchAction((prevAction) => ({
                                                                                    ...prevAction,
                                                                                    target: nextTarget,
                                                                                }));
                                                                            }}
                                                                        />
                                                                    </label>
                                                                )}

                                                                {selectedLoginNoMatchAction.type === "action" && (
                                                                    <label className="script-creator__field">
                                                                        <span>Action</span>
                                                                        <input
                                                                            value={selectedLoginNoMatchAction.action || ""}
                                                                            onChange={(e) => {
                                                                                const nextActionValue = e.target.value;
                                                                                updateLoginNoMatchAction((prevAction) => ({
                                                                                    ...prevAction,
                                                                                    action: nextActionValue,
                                                                                }));
                                                                            }}
                                                                        />
                                                                    </label>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && selectedElement.type === "text" && (
                                                    <label className="script-creator__field script-creator__field--fill">
                                                        <span>Text Content</span>
                                                        <textarea
                                                            className="script-creator__textarea-fill"
                                                            value={selectedElement.text || ""}
                                                            onChange={(e) => updateElement({ ...selectedElement, text: e.target.value })}
                                                        />
                                                        <small className="script-creator__markdown-hint">
                                                            Markdown: `#`, `**bold**`, `*italic*`, `__underline__`, `~~strikethrough~~`, `[label](url)`, `- bullets`, `&gt; quote`, `\&gt;` literal `&gt;`, `---`
                                                        </small>
                                                    </label>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && (selectedElement.type === "toggle" || selectedElement.type === "list" || selectedElement.type === "dropdown") && (
                                                    <div className="script-creator__cycler">
                                                        <div className="script-creator__list-header">
                                                            <span>States</span>
                                                            <button className="script-creator__btn" onClick={addCyclerState}>[+ STATE]</button>
                                                        </div>

                                                        <div className="script-creator__cycler-list">
                                                            {selectedCyclerStates.map((state: any, stateIndex: number) => {
                                                                const behavior = getCyclerStateBehavior(state);
                                                                return (
                                                                    <div key={`state-${stateIndex}`} className="script-creator__cycler-state">
                                                                        <label className="script-creator__field">
                                                                            <span>Text</span>
                                                                            <input
                                                                                value={state.text || ""}
                                                                                onChange={(e) => {
                                                                                    const nextText = e.target.value;
                                                                                    updateCyclerStates((prevStates) => {
                                                                                        return prevStates.map((entry: any, index: number) => {
                                                                                            return index === stateIndex
                                                                                                ? { ...entry, text: nextText }
                                                                                                : entry;
                                                                                        });
                                                                                    });
                                                                                }}
                                                                            />
                                                                        </label>

                                                                        <label className="script-creator__field">
                                                                            <span>Behavior</span>
                                                                            <CreatorSelect
                                                                                    value={behavior}
                                                                                    options={CYCLER_STATE_BEHAVIOR_OPTIONS}
                                                                                    onChange={(nextBehaviorRaw) => {
                                                                                        const nextBehavior = nextBehaviorRaw as CyclerStateBehavior;
                                                                                        updateCyclerStates((prevStates) => {
                                                                                            return prevStates.map((entry: any, index: number) => {
                                                                                                if (index !== stateIndex) {
                                                                                                    return entry;
                                                                                                }

                                                                                                const nextState: any = { ...entry };
                                                                                                if (nextBehavior === "none") {
                                                                                                    delete nextState.target;
                                                                                                    delete nextState.action;
                                                                                                    delete nextState.dialog;
                                                                                                    delete nextState.requireShift;
                                                                                                    return nextState;
                                                                                                }

                                                                                                if (nextBehavior === "dialog") {
                                                                                                    delete nextState.target;
                                                                                                    delete nextState.action;
                                                                                                    if (typeof nextState.dialog !== "string" || !nextState.dialog.trim().length) {
                                                                                                        nextState.dialog = (script.dialogs?.[0]?.id || "").toString();
                                                                                                    }
                                                                                                    return nextState;
                                                                                                }

                                                                                                delete nextState.dialog;
                                                                                                delete nextState.requireShift;

                                                                                                if (typeof nextState.target !== "string") {
                                                                                                    nextState.target = selectedScreen?.id || "";
                                                                                                }

                                                                                                if (nextBehavior === "link") {
                                                                                                    delete nextState.action;
                                                                                                    return nextState;
                                                                                                }

                                                                                                if (typeof nextState.action !== "string" || !nextState.action.trim().length) {
                                                                                                    nextState.action = "resetState";
                                                                                                }

                                                                                                return nextState;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                        </label>

                                                                        <label className="script-creator__field">
                                                                            <span>Class Name</span>
                                                                            <CreatorSelect
                                                                                value={state.className || ""}
                                                                                options={cyclerStateClassNameSelectOptions}
                                                                                searchable
                                                                                onChange={(nextClassName) => {
                                                                                    updateCyclerStates((prevStates) => {
                                                                                        return prevStates.map((entry: any, index: number) => {
                                                                                            if (index !== stateIndex) {
                                                                                                return entry;
                                                                                            }

                                                                                            if (!nextClassName.length) {
                                                                                                const nextState = { ...entry };
                                                                                                delete nextState.className;
                                                                                                return nextState;
                                                                                            }

                                                                                            return {
                                                                                                ...entry,
                                                                                                className: nextClassName,
                                                                                            };
                                                                                        });
                                                                                    });
                                                                                }}
                                                                            />
                                                                        </label>

                                                                        {behavior === "dialog" && (
                                                                            <>
                                                                                <label className="script-creator__field">
                                                                                    <span>Dialog ID</span>
                                                                                    <CreatorSelect
                                                                                        value={state.dialog || ""}
                                                                                        options={targetSelectOptions}
                                                                                        editable
                                                                                        placeholder="dialog id"
                                                                                        onChange={(nextDialog) => {
                                                                                            updateCyclerStates((prevStates) => {
                                                                                                return prevStates.map((entry: any, index: number) => {
                                                                                                    return index === stateIndex
                                                                                                        ? { ...entry, dialog: nextDialog }
                                                                                                        : entry;
                                                                                                });
                                                                                            });
                                                                                        }}
                                                                                    />
                                                                                </label>

                                                                                <label className="script-creator__field">
                                                                                    <span>Require Shift</span>
                                                                                    <CreatorSelect
                                                                                        value={state.requireShift ? "true" : "false"}
                                                                                        options={BOOLEAN_OPTIONS}
                                                                                        onChange={(nextValue) => {
                                                                                            const nextRequireShift = nextValue === "true";
                                                                                            updateCyclerStates((prevStates) => {
                                                                                                return prevStates.map((entry: any, index: number) => {
                                                                                                    if (index !== stateIndex) {
                                                                                                        return entry;
                                                                                                    }
                                                                                                    if (!nextRequireShift) {
                                                                                                        const nextState = { ...entry };
                                                                                                        delete nextState.requireShift;
                                                                                                        return nextState;
                                                                                                    }
                                                                                                    return { ...entry, requireShift: true };
                                                                                                });
                                                                                            });
                                                                                        }}
                                                                                    />
                                                                                </label>
                                                                            </>
                                                                        )}

                                                                        {(behavior === "link" || behavior === "action") && (
                                                                            <label className="script-creator__field">
                                                                                <span>Target Screen</span>
                                                                                <CreatorSelect
                                                                                    value={state.target || ""}
                                                                                    options={targetSelectOptions}
                                                                                    editable
                                                                                    placeholder="screen id"
                                                                                    onChange={(nextTarget) => {
                                                                                        updateCyclerStates((prevStates) => {
                                                                                            return prevStates.map((entry: any, index: number) => {
                                                                                                return index === stateIndex
                                                                                                    ? { ...entry, target: nextTarget }
                                                                                                    : entry;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                        )}

                                                                        {behavior === "action" && (
                                                                            <label className="script-creator__field">
                                                                                <span>Action</span>
                                                                                <input
                                                                                    value={state.action || ""}
                                                                                    onChange={(e) => {
                                                                                        const nextAction = e.target.value;
                                                                                        updateCyclerStates((prevStates) => {
                                                                                            return prevStates.map((entry: any, index: number) => {
                                                                                                return index === stateIndex
                                                                                                    ? { ...entry, action: nextAction }
                                                                                                    : entry;
                                                                                            });
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                        )}

                                                                        <div className="script-creator__actions script-creator__actions--cycler-state">
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => {
                                                                                    updateCyclerStates((prevStates) => {
                                                                                        return prevStates.map((entry: any, index: number) => ({
                                                                                            ...entry,
                                                                                            active: index === stateIndex,
                                                                                        }));
                                                                                    });
                                                                                }}
                                                                                disabled={!!state.active}
                                                                            >
                                                                                [SET ACTIVE]
                                                                            </button>
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => moveCyclerState(stateIndex, -1)}
                                                                                disabled={stateIndex === 0}
                                                                            >
                                                                                [UP]
                                                                            </button>
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => moveCyclerState(stateIndex, 1)}
                                                                                disabled={stateIndex === selectedCyclerStates.length - 1}
                                                                            >
                                                                                [DOWN]
                                                                            </button>
                                                                            <button
                                                                                className="script-creator__btn"
                                                                                onClick={() => removeCyclerState(stateIndex)}
                                                                                disabled={selectedCyclerStates.length <= 1}
                                                                            >
                                                                                [DELETE]
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && (selectedElement.type === "bitmap" || selectedElement.type === "image") && (
                                                    <>
                                                        <label className="script-creator__field">
                                                            <span>Source Path</span>
                                                            <input
                                                                value={selectedElement.src || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, src: e.target.value })}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Alt Text</span>
                                                            <input
                                                                value={selectedElement.alt || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, alt: e.target.value })}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Fill Width</span>
                                                            <CreatorSelect
                                                                value={selectedElement.fillWidth ? "true" : "false"}
                                                                options={BOOLEAN_OPTIONS}
                                                                onChange={(nextValue) => updateElement({
                                                                    ...selectedElement,
                                                                    fillWidth: nextValue === "true",
                                                                })}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Scale</span>
                                                            <input
                                                                type="number"
                                                                step="0.1"
                                                                min="0"
                                                                value={selectedElement.scale ?? ""}
                                                                onChange={(e) => {
                                                                    const nextValue = e.target.value;
                                                                    if (!nextValue.length) {
                                                                        const nextElement = { ...selectedElement };
                                                                        delete nextElement.scale;
                                                                        updateElement(nextElement);
                                                                        return;
                                                                    }

                                                                    const parsed = Number(nextValue);
                                                                    if (!Number.isFinite(parsed)) {
                                                                        return;
                                                                    }
                                                                    updateElement({
                                                                        ...selectedElement,
                                                                        scale: parsed,
                                                                    });
                                                                }}
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && selectedElement.type === "reportComposer" && (
                                                    <>
                                                        <label className="script-creator__field">
                                                            <span>Composer ID</span>
                                                            <input
                                                                value={selectedElement.composerId || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, composerId: e.target.value })}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Title Template</span>
                                                            <input
                                                                value={selectedElement.titleTemplate || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, titleTemplate: e.target.value })}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field script-creator__field--fill">
                                                            <span>Template</span>
                                                            <textarea
                                                                className="script-creator__textarea-fill"
                                                                value={selectedElement.template || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, template: e.target.value })}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Save Target Screen</span>
                                                            <CreatorSelect
                                                                value={selectedElement.saveTarget || ""}
                                                                options={targetSelectOptions}
                                                                editable
                                                                placeholder="screen id"
                                                                onChange={(nextTarget) => {
                                                                    if (!nextTarget.length) {
                                                                        const nextElement = { ...selectedElement };
                                                                        delete nextElement.saveTarget;
                                                                        updateElement(nextElement);
                                                                        return;
                                                                    }

                                                                    updateElement({
                                                                        ...selectedElement,
                                                                        saveTarget: nextTarget,
                                                                    });
                                                                }}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Cancel Target Screen</span>
                                                            <CreatorSelect
                                                                value={selectedElement.cancelTarget || ""}
                                                                options={targetSelectOptions}
                                                                editable
                                                                placeholder="screen id"
                                                                onChange={(nextTarget) => {
                                                                    if (!nextTarget.length) {
                                                                        const nextElement = { ...selectedElement };
                                                                        delete nextElement.cancelTarget;
                                                                        updateElement(nextElement);
                                                                        return;
                                                                    }

                                                                    updateElement({
                                                                        ...selectedElement,
                                                                        cancelTarget: nextTarget,
                                                                    });
                                                                }}
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && selectedElement.type === "reportList" && (
                                                    <>
                                                        <label className="script-creator__field">
                                                            <span>Composer ID</span>
                                                            <input
                                                                value={selectedElement.composerId || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, composerId: e.target.value })}
                                                            />
                                                        </label>

                                                        <label className="script-creator__field">
                                                            <span>Empty Text</span>
                                                            <input
                                                                value={selectedElement.emptyText || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, emptyText: e.target.value })}
                                                            />
                                                        </label>
                                                    </>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && classNameOptions.length > 0 && (
                                                    <label className="script-creator__field">
                                                        <span>Class Name</span>
                                                        <CreatorSelect
                                                            value={selectedElement.className || ""}
                                                            options={classNameSelectOptions}
                                                            searchable
                                                            onChange={(nextValue) => {
                                                                if (!nextValue.length) {
                                                                    const nextElement = { ...selectedElement };
                                                                    delete nextElement.className;
                                                                    updateElement(nextElement);
                                                                    return;
                                                                }
                                                                updateElement({
                                                                    ...selectedElement,
                                                                    className: nextValue,
                                                                });
                                                            }}
                                                        />
                                                    </label>
                                                )}

                                                {selectedElement && typeof selectedElement === "object" && (
                                                    <label className="script-creator__field">
                                                        <span>Text Align</span>
                                                        <CreatorSelect
                                                            value={selectedElement.align || "left"}
                                                            options={TEXT_ALIGN_OPTIONS}
                                                            onChange={updateElementAlign}
                                                        />
                                                    </label>
                                                )}

                                                {selectedElementSupportsTextSpeed && (
                                                    <label className="script-creator__field">
                                                        <span>Text Speed (ms)</span>
                                                        <CreatorSpeedInput
                                                            key={`element-speed-${selectedScreen?.id || ""}-${selectedElementIndex}`}
                                                            value={selectedElementTextSpeed}
                                                            placeholder={selectedElementTextSpeedPlaceholder}
                                                            onChange={updateElementTextSpeed}
                                                        />
                                                    </label>
                                                )}
                                            </>
                                        )}

                                        {elementEditorMode === "raw" && selectedElement !== undefined && (
                                            <label className="script-creator__field script-creator__field--fill">
                                                <span>Raw JSON</span>
                                                <textarea
                                                    className="script-creator__textarea-fill"
                                                    value={rawElementDraft}
                                                    onChange={(e) => {
                                                        const nextRaw = e.target.value;
                                                        setRawElementDraft(nextRaw);
                                                        try {
                                                            const parsed = JSON.parse(nextRaw);
                                                            updateElement(parsed);
                                                            setRawElementError(null);
                                                        } catch {
                                                            setRawElementError(null);
                                                        }
                                                    }}
                                                    onBlur={() => {
                                                        try {
                                                            const parsed = JSON.parse(rawElementDraft);
                                                            updateElement(parsed);
                                                            setRawElementError(null);
                                                        } catch {
                                                            setRawElementError("JSON parse error");
                                                        }
                                                    }}
                                                />
                                            </label>
                                        )}

                                        {rawElementError && <div className="script-creator__error">{rawElementError}</div>}
                                    </div>
                                </div>
                            </div>
                        )}

                        {sidebarListMode === "dialogs" && selectedDialog && (
                            <div className="script-creator__editor-content">
                                <div className="script-creator__row">
                                    <label className="script-creator__field">
                                        <span>Dialog ID</span>
                                        <input
                                            value={selectedDialog.id || ""}
                                            onChange={(e) => renameDialogId(e.target.value)}
                                        />
                                    </label>

                                    <label className="script-creator__field">
                                        <span>Type</span>
                                        <CreatorSelect
                                            value={typeof selectedDialog.type === "string" ? selectedDialog.type : "alert"}
                                            options={DIALOG_TYPE_OPTIONS}
                                            fallbackLabel={typeof selectedDialog.type === "string" ? selectedDialog.type : "alert"}
                                            onChange={(nextType) => updateDialog({ type: nextType })}
                                        />
                                    </label>
                                </div>

                                <div className="script-creator__row">
                                    <label className="script-creator__field">
                                        <span>Action Buttons</span>
                                        <label style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedDialog.showActions === true}
                                                onChange={(e) => updateDialog({ showActions: e.target.checked })}
                                            />
                                            <span>{selectedDialog.showActions === true ? "Enabled" : "Disabled"}</span>
                                        </label>
                                    </label>
                                </div>

                                <div className="script-creator__list-header">
                                    <span>Dialog Content</span>
                                    <div className="script-creator__actions">
                                        <button className="script-creator__btn" onClick={addDialogContentEntry}>[ADD LINE]</button>
                                    </div>
                                </div>

                                <div className="script-creator__element-layout">
                                    <div className="script-creator__element-list-panel">
                                        <div className="script-creator__list script-creator__list--elements">
                                            {!visibleDialogContentEntries.length && (
                                                <span className="script-creator__hint">
                                                    {shouldFilterListsToMatches ? "No matching content lines in this dialog." : "No content lines in this dialog."}
                                                </span>
                                            )}
                                            {visibleDialogContentEntries.map(({ index, label }: IndexedLabeledEntry) => {
                                                return (
                                                    <button
                                                        key={`${selectedDialog.id || "dialog"}-entry-${index}`}
                                                        className={"script-creator__list-item" + (index === selectedDialogContentIndex ? " script-creator__list-item--active" : "")}
                                                        onClick={() => {
                                                            setSelectedDialogContentIndex(index);
                                                            setRawElementError(null);
                                                        }}
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        <div className="script-creator__actions script-creator__actions--element-controls">
                                            <button
                                                className="script-creator__btn"
                                                onClick={() => moveDialogContentEntry(-1)}
                                                disabled={!canMoveDialogContentUp}
                                            >
                                                [MOVE UP]
                                            </button>
                                            <button
                                                className="script-creator__btn"
                                                onClick={() => moveDialogContentEntry(1)}
                                                disabled={!canMoveDialogContentDown}
                                            >
                                                [MOVE DOWN]
                                            </button>
                                            <button
                                                className="script-creator__btn"
                                                onClick={removeDialogContentEntry}
                                                disabled={!canDeleteDialogContent}
                                            >
                                                [DELETE]
                                            </button>
                                        </div>
                                    </div>

                                    <div className="script-creator__element-editor">
                                        {selectedDialogContentEntryIsTextLike && (
                                            <>
                                                <label className="script-creator__field script-creator__field--fill">
                                                    <span>Text</span>
                                                    <textarea
                                                        className="script-creator__textarea-fill"
                                                        value={selectedDialogTextValue}
                                                        onChange={(e) => {
                                                            updateDialogTextEntry(e.target.value);
                                                            setRawElementError(null);
                                                        }}
                                                    />
                                                    <small className="script-creator__markdown-hint">
                                                        Markdown: `#`, `**bold**`, `*italic*`, `__underline__`, `~~strikethrough~~`, `[label](url)`, `- bullets`, `&gt; quote`, `\&gt;` literal `&gt;`, `---`
                                                    </small>
                                                </label>

                                                <label className="script-creator__field">
                                                    <span>Class Name (Apply Style)</span>
                                                    <CreatorSelect
                                                        value={selectedDialogTextClassName || ""}
                                                        options={TEXT_LINE_STYLE_OPTIONS}
                                                        fallbackLabel={selectedDialogTextClassName || "(none)"}
                                                        searchable
                                                        onChange={(nextClassName) => {
                                                            updateDialogTextClassName(nextClassName);
                                                            setRawElementError(null);
                                                        }}
                                                    />
                                                </label>
                                            </>
                                        )}

                                        {selectedDialogContentEntry !== undefined && selectedDialogContentEntryIsObject && (
                                            <label className="script-creator__field script-creator__field--fill">
                                                <span>Raw JSON</span>
                                                <textarea
                                                    className="script-creator__textarea-fill"
                                                    data-search-exclude={selectedDialogContentEntryIsTextLike ? "true" : undefined}
                                                    value={rawDialogContentDraft}
                                                    onChange={(e) => {
                                                        const nextRaw = e.target.value;
                                                        setRawDialogContentDraft(nextRaw);
                                                        try {
                                                            const parsed = JSON.parse(nextRaw);
                                                            updateDialogContentEntry(parsed);
                                                            setRawElementError(null);
                                                        } catch {
                                                            setRawElementError(null);
                                                        }
                                                    }}
                                                    onBlur={() => {
                                                        try {
                                                            const parsed = JSON.parse(rawDialogContentDraft);
                                                            updateDialogContentEntry(parsed);
                                                            setRawElementError(null);
                                                        } catch {
                                                            setRawElementError("JSON parse error");
                                                        }
                                                    }}
                                                />
                                            </label>
                                        )}

                                        {selectedDialogContentEntry === undefined && (
                                            <span className="script-creator__hint">Select a content entry to edit.</span>
                                        )}

                                        {rawElementError && <div className="script-creator__error">{rawElementError}</div>}
                                    </div>
                                </div>
                            </div>
                        )}

                        {sidebarListMode === "dialogs" && !selectedDialog && (
                            <div className="script-creator__editor-content">
                                <span className="script-creator__hint">No dialog selected.</span>
                            </div>
                        )}
                    </main>
                    )}

                    {activeView === "schema" && (
                        <main className="script-creator__schema-view">
                            <div className="script-creator__schema-toolbar">
                                <label className="script-creator__field">
                                    <span>Root Screen</span>
                                    <CreatorSelect
                                        value={effectiveSchemaRootId}
                                        options={schemaRootSelectOptions}
                                        disabled={!schemaRootSelectOptions.length}
                                        fallbackLabel={effectiveSchemaRootId || "(none)"}
                                        onChange={(nextValue) => setSchemaRootId(nextValue)}
                                    />
                                </label>
                                <span className="script-creator__schema-hint">
                                    Tree is built from screen links, dialog links, prompts, toggles/lists/dropdowns, and screen onDone targets.
                                </span>
                            </div>

                            <div className="script-creator__schema-tree">
                                <pre>{schemaLines.join("\n")}</pre>
                            </div>
                        </main>
                    )}
                </div>
                )}

                <div className="script-creator__footer">
                    {selectedScriptIsLocal && !!onDeleteLocalScript && (
                        <button
                            className="script-creator__btn"
                            onClick={() => void deleteSelectedLocalScript()}
                        >
                            [DELETE]
                        </button>
                    )}
                    <button className="script-creator__btn" onClick={applyScript}>[APPLY TO APP]</button>
                    {selectedScriptCanSaveModule && onSaveModule && (
                        <button
                            className="script-creator__btn"
                            onClick={() => void saveModule()}
                            type="button"
                            disabled={moduleSaveState === "saving"}
                        >
                            [SAVE MODULE]
                        </button>
                    )}
                    <button className="script-creator__btn" onClick={copyJson}>[COPY JSON]</button>
                    <button className="script-creator__btn" onClick={downloadJson}>[DOWNLOAD JSON]</button>
                    <button className="script-creator__btn" onClick={openImportScreensPicker}>[IMPORT SCREENS]</button>
                    <input
                        ref={importFileInputRef}
                        type="file"
                        accept="application/json,.json"
                        style={{ display: "none" }}
                        onChange={handleImportFileChange}
                    />
                    {importStatus && (
                        <div
                            className={`script-creator__footer-status script-creator__footer-status--${importStatus.tone}`}
                            aria-live="polite"
                            style={{
                                flex: "0 0 auto",
                                border: "1px solid currentColor",
                                padding: "0.1rem 0.4rem",
                                whiteSpace: "nowrap",
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                                fontSize: "0.65rem",
                                lineHeight: 1,
                                pointerEvents: "none",
                                color: importStatus.tone === "success" ? "#8ee28f" : "#ff8b5c",
                            }}
                        >
                            {importStatus.text}
                        </div>
                    )}
                    {moduleSaveStatusLabel && (
                        <div
                            className={`script-creator__footer-status script-creator__footer-status--${moduleSaveState}`}
                            aria-live="polite"
                            style={{
                                marginLeft: "auto",
                                flex: "0 0 auto",
                                border: "1px solid currentColor",
                                padding: "0.1rem 0.4rem",
                                whiteSpace: "nowrap",
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                                fontSize: "0.65rem",
                                lineHeight: 1,
                                pointerEvents: "none",
                                color: moduleSaveState === "saved"
                                    ? "#8ee28f"
                                    : moduleSaveState === "error"
                                        ? "#ff8b5c"
                                        : "#f2d15b",
                            }}
                        >
                            {moduleSaveStatusLabel}
                        </div>
                    )}
                </div>
            </div>

            {importPickerOpen && importCandidate && (
                <div
                    className="script-creator__import-modal"
                    onClick={(e) => {
                        e.stopPropagation();
                        closeImportPicker();
                    }}
                >
                    <div className="script-creator__import-panel" onClick={(e) => e.stopPropagation()}>
                        <div className="script-creator__import-header">
                            <strong>Import Screens</strong>
                            <span className="script-creator__import-count">
                                {importSelectedIndices.size + importSelectedDialogIndices.size} of{" "}
                                {importCandidate.screens.length + importCandidate.dialogs.length} selected
                            </span>
                            <button className="script-creator__btn" onClick={closeImportPicker}>[CLOSE]</button>
                        </div>

                        <div className="script-creator__import-body">
                            <div className="script-creator__import-list">
                                <div className="script-creator__import-group-label">SCREENS</div>
                                {!importCandidate.screens.length && (
                                    <span className="script-creator__hint">No screens in this file.</span>
                                )}
                                {importCandidate.screens.map((screen: any, index: number) => {
                                    const id = (screen?.id || `screen${index}`).toString();
                                    const count = Array.isArray(screen?.content) ? screen.content.length : 0;
                                    const isActive = importPreview?.kind === "screen" && importPreview.index === index;
                                    return (
                                        <div
                                            key={`screen-${id}-${index}`}
                                            className={
                                                "script-creator__import-item"
                                                + (isActive ? " script-creator__import-item--active" : "")
                                            }
                                        >
                                            <input
                                                type="checkbox"
                                                className="script-creator__import-check"
                                                checked={importSelectedIndices.has(index)}
                                                onChange={() => toggleImportSelected(index)}
                                                aria-label={`Import screen ${id}`}
                                            />
                                            <button
                                                type="button"
                                                className="script-creator__import-item-label"
                                                onClick={() => setImportPreview({ kind: "screen", index })}
                                            >
                                                <span className="script-creator__import-item-id">{id}</span>
                                                <span className="script-creator__import-item-meta">
                                                    {count} {count === 1 ? "line" : "lines"}
                                                </span>
                                            </button>
                                        </div>
                                    );
                                })}

                                {importCandidate.dialogs.length > 0 && (
                                    <div className="script-creator__import-group-label">DIALOGS</div>
                                )}
                                {importCandidate.dialogs.map((dialog: any, index: number) => {
                                    const id = (dialog?.id || `dialog${index}`).toString();
                                    const count = Array.isArray(dialog?.content) ? dialog.content.length : 0;
                                    const isActive = importPreview?.kind === "dialog" && importPreview.index === index;
                                    return (
                                        <div
                                            key={`dialog-${id}-${index}`}
                                            className={
                                                "script-creator__import-item"
                                                + (isActive ? " script-creator__import-item--active" : "")
                                            }
                                        >
                                            <input
                                                type="checkbox"
                                                className="script-creator__import-check"
                                                checked={importSelectedDialogIndices.has(index)}
                                                onChange={() => toggleImportDialogSelected(index)}
                                                aria-label={`Import dialog ${id}`}
                                            />
                                            <button
                                                type="button"
                                                className="script-creator__import-item-label"
                                                onClick={() => setImportPreview({ kind: "dialog", index })}
                                            >
                                                <span className="script-creator__import-item-id">{id}</span>
                                                <span className="script-creator__import-item-meta">
                                                    {count} {count === 1 ? "line" : "lines"}
                                                </span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="script-creator__import-preview">
                                {(() => {
                                    const source = importPreview?.kind === "dialog"
                                        ? importCandidate.dialogs
                                        : importCandidate.screens;
                                    const item = importPreview ? source[importPreview.index] : undefined;
                                    if (!item) {
                                        return <span className="script-creator__hint">Select an item to preview.</span>;
                                    }
                                    const fallbackId = `${importPreview?.kind === "dialog" ? "dialog" : "screen"}${importPreview?.index ?? 0}`;
                                    const previewId = (item.id || fallbackId).toString();
                                    const titlePrefix = importPreview?.kind === "dialog" ? "[DIALOG] " : "";
                                    const lines = getScreenPreviewLines(item);
                                    return (
                                        <>
                                            <div className="script-creator__import-preview-title">{titlePrefix}{previewId}</div>
                                            <div className="script-creator__import-preview-body">
                                                {lines.map((line, lineIndex) => (
                                                    <div key={lineIndex} className="script-creator__import-preview-line">
                                                        {line.length ? line : " "}
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>

                        <div className="script-creator__import-footer">
                            <button className="script-creator__btn" onClick={selectAllImport}>[SELECT ALL]</button>
                            <button className="script-creator__btn" onClick={deselectAllImport}>[DESELECT ALL]</button>
                            <button
                                className="script-creator__btn"
                                onClick={confirmImportSelected}
                                disabled={!importSelectedIndices.size && !importSelectedDialogIndices.size}
                            >
                                [IMPORT SELECTED]
                            </button>
                            <button className="script-creator__btn" onClick={closeImportPicker}>[CANCEL]</button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};

export default ScriptCreator;
