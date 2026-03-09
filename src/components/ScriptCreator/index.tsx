import React, { FC, useMemo, useState } from "react";
import "./style.scss";

interface ScriptCreatorProps {
    initialScript: any;
    onApply: (scriptJson: any) => void;
    onPreview: (scriptJson: any, screenId: string, elementIndex: number) => void;
    onClose: () => void;
}

type AddableElementType =
    "plainText"
    | "text"
    | "alertText"
    | "noticeText"
    | "link"
    | "bitmap"
    | "prompt"
    | "toggle"
    | "list"
    | "reportComposer"
    | "dialogLink";

interface AddableElementOption {
    value: AddableElementType;
    label: string;
}

const ADDABLE_ELEMENT_OPTIONS: AddableElementOption[] = [
    { value: "plainText", label: "Text Line" },
    { value: "text", label: "Text Block" },
    { value: "alertText", label: "Alert Text" },
    { value: "noticeText", label: "Notice Text" },
    { value: "link", label: "Link Button" },
    { value: "bitmap", label: "Bitmap/Image" },
    { value: "prompt", label: "Prompt Input" },
    { value: "toggle", label: "Toggle" },
    { value: "list", label: "List" },
    { value: "reportComposer", label: "Report Composer" },
    { value: "dialogLink", label: "Dialog Link (+ Dialog)" },
];

const createDefaultScript = () => ({
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

const ensureScriptShape = (raw: any): any => {
    const base = cloneJson(raw && typeof raw === "object" ? raw : createDefaultScript());
    if (!base.config || typeof base.config !== "object") {
        base.config = {};
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
        .map((screen: any, index: number) => ({
            ...screen,
            id: typeof screen.id === "string" && screen.id.trim() ? screen.id : `screen${index}`,
            type: typeof screen.type === "string" ? screen.type : "screen",
            content: Array.isArray(screen.content) ? screen.content : [],
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

const readScreenTargetsFromAction = (action: any): string[] => {
    if (!action || typeof action !== "object") {
        return [];
    }

    const actionType = typeof action.type === "string" ? action.type.toLowerCase() : "";
    if (actionType !== "link" && actionType !== "href") {
        return [];
    }

    if (typeof action.target === "string") {
        return [action.target];
    }

    if (!Array.isArray(action.target)) {
        return [];
    }

    return uniqueTargets(action.target.flatMap((targetEntry: any) => {
        if (!targetEntry || typeof targetEntry !== "object") {
            return [];
        }
        const targetType = typeof targetEntry.type === "string" ? targetEntry.type.toLowerCase() : "";
        if (targetType !== "link" && targetType !== "href") {
            return [];
        }
        return typeof targetEntry.target === "string" ? [targetEntry.target] : [];
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

    if (elementType === "toggle" || elementType === "list") {
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

    if (elementType === "reportcomposer") {
        return uniqueTargets([element.saveTarget, element.cancelTarget]);
    }

    return [];
};

const buildScreenConnectionMap = (script: any): { screenIds: string[]; connectionMap: Record<string, string[]> } => {
    const screens = Array.isArray(script?.screens) ? script.screens : [];
    const screenIds = screens
        .map((screen: any) => (typeof screen?.id === "string" ? screen.id : ""))
        .filter((id: string) => id.length > 0);
    const idSet = new Set(screenIds);

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

    screenIds.forEach((id) => {
        if (!connectionMap[id]) {
            connectionMap[id] = [];
        }
    });

    return {
        screenIds,
        connectionMap,
    };
};

const buildSchemaTreeLines = (rootId: string, screenIds: string[], connectionMap: Record<string, string[]>): string[] => {
    if (!screenIds.length) {
        return ["No screens available."];
    }

    const firstRoot = screenIds.includes(rootId) ? rootId : screenIds[0];
    const lines: string[] = [firstRoot];
    const globalSeen = new Set<string>([firstRoot]);
    const visited = new Set<string>([firstRoot]);

    const drawChildren = (nodeId: string, prefix: string, ancestors: Set<string>) => {
        const children = connectionMap[nodeId] || [];
        children.forEach((childId, index) => {
            const isLast = index === children.length - 1;
            const connector = `${prefix}${isLast ? "└─ " : "├─ "}`;

            if (ancestors.has(childId)) {
                lines.push(`${connector}${childId} (cycle)`);
                return;
            }

            if (globalSeen.has(childId)) {
                lines.push(`${connector}${childId} (seen)`);
                return;
            }

            lines.push(`${connector}${childId}`);
            globalSeen.add(childId);
            visited.add(childId);
            const nextAncestors = new Set(ancestors);
            nextAncestors.add(childId);
            drawChildren(childId, `${prefix}${isLast ? "   " : "│  "}`, nextAncestors);
        });
    };

    drawChildren(firstRoot, "", new Set([firstRoot]));

    const disconnected = screenIds.filter((id) => !visited.has(id));
    if (disconnected.length) {
        lines.push("");
        lines.push("Unreached from selected root:");
        disconnected.forEach((id) => {
            lines.push(id);
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

const ScriptCreator: FC<ScriptCreatorProps> = ({ initialScript, onApply, onPreview, onClose }) => {
    const initialSelectedScreenId = getInitialSelectedScreenId(initialScript);
    const [script, setScript] = useState<any>(() => ensureScriptShape(initialScript));
    const [selectedScreenId, setSelectedScreenId] = useState<string>(() => initialSelectedScreenId);
    const [schemaRootId, setSchemaRootId] = useState<string>(() => initialSelectedScreenId);
    const [selectedElementIndex, setSelectedElementIndex] = useState<number>(() => {
        return getInitialSelectedElementIndex(initialScript, initialSelectedScreenId);
    });
    const [newElementType, setNewElementType] = useState<AddableElementType>("plainText");
    const [rawElementError, setRawElementError] = useState<string | null>(null);
    const [elementEditorMode, setElementEditorMode] = useState<"fields" | "raw">("fields");
    const [activeView, setActiveView] = useState<"editor" | "schema">("editor");

    const selectedScreen = useMemo(() => {
        return script.screens.find((screen: any) => screen.id === selectedScreenId) || null;
    }, [script, selectedScreenId]);

    const selectedElement = selectedScreen?.content?.[selectedElementIndex];
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
        return buildSchemaTreeLines(effectiveSchemaRootId, schemaData.screenIds, schemaData.connectionMap);
    }, [effectiveSchemaRootId, schemaData]);

    const updateScript = (updater: (prev: any) => any) => {
        setScript((prev: any) => ensureScriptShape(updater(prev)));
    };

    const updateConfig = (key: string, value: string) => {
        updateScript((prev) => ({
            ...prev,
            config: {
                ...prev.config,
                [key]: value,
            },
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

    const addScreen = () => {
        const newId = nextScreenId(script.screens);
        updateScript((prev) => ({
            ...prev,
            screens: [
                ...prev.screens,
                {
                    id: newId,
                    type: "screen",
                    content: [""],
                },
            ],
        }));
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

            case "reportComposer":
                element = {
                    type: "reportComposer",
                    template: "",
                    saveTarget: selectedScreen.id,
                    cancelTarget: selectedScreen.id,
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

        const nextIndex = selectedScreen.content.length;
        updateScript((prev) => ({
            ...prev,
            dialogs: nextDialogs,
            screens: prev.screens.map((screen: any) => {
                if (screen.id !== selectedScreen.id) {
                    return screen;
                }
                return {
                    ...screen,
                    content: [...selectedScreen.content, element],
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

    const applyScript = () => {
        onApply(cloneJson(script));
    };

    const previewScript = () => {
        if (!selectedScreenId) {
            return;
        }
        onPreview(cloneJson(script), selectedScreenId, selectedElementIndex);
    };

    const startNewScript = () => {
        const freshScript = ensureScriptShape(createDefaultScript());
        const firstScreenId = freshScript.screens[0]?.id || "";

        setScript(freshScript);
        setSelectedScreenId(firstScreenId);
        setSchemaRootId(firstScreenId);
        setSelectedElementIndex(0);
        setElementEditorMode("fields");
        setRawElementError(null);
        setActiveView("editor");
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

    return (
        <section className="script-creator" onClick={onClose}>
            <div className="script-creator__panel" onClick={(e) => e.stopPropagation()}>
                <div className="script-creator__header">
                    <strong>Script Creator</strong>
                    <div className="script-creator__header-actions">
                        <button
                            className="script-creator__btn"
                            onClick={startNewScript}
                        >
                            [NEW SCRIPT]
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
                        <button className="script-creator__btn" onClick={onClose}>[CLOSE]</button>
                    </div>
                </div>

                <div className={"script-creator__body" + (activeView === "schema" ? " script-creator__body--single" : "")}>
                    {activeView === "editor" && (
                    <aside className="script-creator__sidebar">
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

                        <div className="script-creator__list-header">
                            <span>Screens</span>
                            <button className="script-creator__btn" onClick={addScreen}>[+ SCREEN]</button>
                        </div>

                        <div className="script-creator__list">
                            {script.screens.map((screen: any) => (
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
                        </div>

                        <button className="script-creator__btn" onClick={removeScreen} disabled={script.screens.length <= 1}>[DELETE SCREEN]</button>
                    </aside>
                    )}

                    {activeView === "editor" && (
                    <main className="script-creator__editor">
                        {selectedScreen && (
                            <div className="script-creator__editor-content">
                                <div className="script-creator__row">
                                    <label className="script-creator__field">
                                        <span>Screen ID</span>
                                        <input
                                            value={selectedScreen.id}
                                            onChange={(e) => renameScreenId(e.target.value)}
                                        />
                                    </label>

                                    <label className="script-creator__field">
                                        <span>Type</span>
                                        <select
                                            value={selectedScreen.type}
                                            onChange={(e) => updateScreen({ type: e.target.value })}
                                        >
                                            <option value="screen">screen</option>
                                            <option value="static">static</option>
                                        </select>
                                    </label>
                                </div>

                                <div className="script-creator__list-header">
                                    <span>Elements</span>
                                    <div className="script-creator__actions">
                                        <select
                                            value={newElementType}
                                            onChange={(e) => setNewElementType(e.target.value as AddableElementType)}
                                        >
                                            {ADDABLE_ELEMENT_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        <button className="script-creator__btn" onClick={addElement}>[ADD ELEMENT]</button>
                                        <button
                                            className="script-creator__btn"
                                            onClick={() => setElementEditorMode((prev) => prev === "fields" ? "raw" : "fields")}
                                        >
                                            {elementEditorMode === "fields" ? "[VIEW RAW JSON]" : "[VIEW FIELDS]"}
                                        </button>
                                    </div>
                                </div>

                                <div className="script-creator__element-layout">
                                    <div className="script-creator__list script-creator__list--elements">
                                        {selectedScreen.content.map((entry: any, index: number) => {
                                            const label = typeof entry === "string"
                                                ? `text: ${entry.slice(0, 24) || "(empty)"}`
                                                : `${entry?.type || "object"}: ${(entry?.text || entry?.prompt || entry?.src || "").toString().slice(0, 24)}`;
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

                                    <div className="script-creator__element-editor">
                                        {elementEditorMode === "fields" && (
                                            <>
                                                {typeof selectedElement === "string" && (
                                                    <label className="script-creator__field script-creator__field--fill">
                                                        <span>Text</span>
                                                        <textarea
                                                            className="script-creator__textarea-fill"
                                                            value={selectedElement}
                                                            onChange={(e) => updateElement(e.target.value)}
                                                        />
                                                    </label>
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

                                                        <label className="script-creator__field">
                                                            <span>Target Screen</span>
                                                            <input
                                                                value={selectedElement.target || ""}
                                                                onChange={(e) => updateElement({ ...selectedElement, target: e.target.value })}
                                                            />
                                                        </label>
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
                                                    </label>
                                                )}
                                            </>
                                        )}

                                        {elementEditorMode === "raw" && selectedElement !== undefined && (
                                            <label className="script-creator__field script-creator__field--fill">
                                                <span>Raw JSON</span>
                                                <textarea
                                                    className="script-creator__textarea-fill"
                                                    value={JSON.stringify(selectedElement, null, 2)}
                                                    onChange={(e) => {
                                                        try {
                                                            const parsed = JSON.parse(e.target.value);
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

                                        <div className="script-creator__actions script-creator__actions--footer">
                                            <button className="script-creator__btn" onClick={() => moveElement(-1)}>[MOVE UP]</button>
                                            <button className="script-creator__btn" onClick={() => moveElement(1)}>[MOVE DOWN]</button>
                                            <button className="script-creator__btn" onClick={removeElement}>[DELETE ELEMENT]</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </main>
                    )}

                    {activeView === "schema" && (
                        <main className="script-creator__schema-view">
                            <div className="script-creator__schema-toolbar">
                                <label className="script-creator__field">
                                    <span>Root Screen</span>
                                    <select
                                        value={effectiveSchemaRootId}
                                        onChange={(e) => setSchemaRootId(e.target.value)}
                                    >
                                        {schemaData.screenIds.map((id) => (
                                            <option key={id} value={id}>{id}</option>
                                        ))}
                                    </select>
                                </label>
                                <span className="script-creator__schema-hint">
                                    Tree is built from screen links, prompts, toggles/lists, and screen onDone targets.
                                </span>
                            </div>

                            <div className="script-creator__schema-tree">
                                <pre>{schemaLines.join("\n")}</pre>
                            </div>
                        </main>
                    )}
                </div>

                <div className="script-creator__footer">
                    <button className="script-creator__btn" onClick={applyScript}>[APPLY TO APP]</button>
                    <button className="script-creator__btn" onClick={copyJson}>[COPY JSON]</button>
                    <button className="script-creator__btn" onClick={downloadJson}>[DOWNLOAD JSON]</button>
                </div>
            </div>
        </section>
    );
};

export default ScriptCreator;
