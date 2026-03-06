export interface TerminalScriptApi {
    getActiveScreenId: () => string | null;
    getScreenIds: () => string[];
    hasVisitedScreen: (screenId: string) => boolean;
    changeScreen: (screenId: string) => void;
    toggleDialog: (dialogId?: string) => void;
    patchScreenElement: (screenId: string, scriptId: string, patch: Record<string, any>) => boolean;
    ensureScreenElement: (screenId: string, scriptId: string, element: Record<string, any>) => boolean;
    removeScreenElement: (screenId: string, scriptId: string) => boolean;
    getVar: <T = any>(key: string) => T | undefined;
    setVar: (key: string, value: any) => void;
    deleteVar: (key: string) => void;
}

export interface TerminalScriptActionMeta {
    source: "link" | "toggle" | "prompt" | "internal";
    command?: string;
    args?: any;
    state?: any;
    linkTarget?: any;
    shiftKey?: boolean;
}

export interface TerminalScript {
    onMount?: (api: TerminalScriptApi) => void;
    onScreenChanged?: (screenId: string, api: TerminalScriptApi) => void;
    onToggleState?: (state: any, api: TerminalScriptApi) => boolean | void;
    onPromptCommand?: (command: string, args: any, api: TerminalScriptApi) => boolean | void;
    onAction?: (action: string, target: string | undefined, meta: TerminalScriptActionMeta, api: TerminalScriptApi) => boolean | void;
}
