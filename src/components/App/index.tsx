import React, { Component, ReactElement } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import "./style.scss";

import Phosphor from "../Phosphor";
import ScriptCreator from "../ScriptCreator";
import ModulesPanel from "../ModulesPanel";
import { BUNDLED_SCRIPTS, BundledScript, DEFAULT_SCRIPT } from "../../data";
import {
    THEMES,
    Theme,
    CustomThemeConfig,
    createCustomTheme,
    customThemeFromTheme,
    loadPersistedCustomTheme,
    loadPersistedTheme,
    persistCustomTheme,
    persistTheme,
    applyTheme,
    sanitizeCustomTheme,
} from "../../themes";
import {
    deleteModule,
    ModuleRecord,
    ProfileRole,
    ModuleVisibility,
    fetchAccessibleModuleById,
    getCurrentSession,
    getProfileRole,
    isModuleLinkShareable,
    isSupabaseConfigured,
    listOwnModules,
    listSubscribedModules,
    onAuthStateChange,
    saveModule,
    signInWithGoogle,
    signOut,
    subscribeToModule,
    unsubscribeFromModule,
    updateModuleMetadata,
} from "../../lib/modules";
import { APP_TITLE } from "../../lib/branding";
import {
    loadPersistedHeaderVisible,
    loadPersistedOwnScriptsVisibility,
    loadPersistedSoundEnabled,
    persistHeaderVisible,
    loadPersistedSubscribedScriptsVisibility,
    persistOwnScriptsVisibility,
    persistSoundEnabled,
    persistSubscribedScriptsVisibility,
} from "../../lib/preferences";
import { getModulesBrowserUrl, getTerminalAppUrl } from "../../lib/routes";
import { isTypingContext } from "../../lib/terminalInput";
import type { MainframePhase } from "../MainframeGame/shared";

const CUSTOM_SCRIPTS_STORAGE_KEY = "phosphor:custom-scripts:v1";
const ACTIVE_SCRIPT_STORAGE_KEY = "phosphor:active-script:v1";
const MAX_CUSTOM_SCRIPTS = 50;
const MODULE_SCRIPT_ID_PREFIX = "module:";
const MODULE_QUERY_PARAM = "module";
const BUNDLED_SUBSCRIBED_ENTRY_PREFIX = "bundled:";
// Bundled scripts that appear in the modules menu as "subscribed" entries the
// user can show/hide from the script dropdown.
const BUNDLED_SUBSCRIBED_SCRIPT_IDS = ["ypsilon14", "sample", "alien-terminal"] as const;
// Subset that starts hidden from the dropdown until the user turns it on.
const BUNDLED_HIDDEN_BY_DEFAULT_SCRIPT_IDS = ["alien-terminal"] as const;
const BUNDLED_OWNER_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const PRINT_OPTIONS_STORAGE_KEY = "phosphor:print-options:v1";

// Ensure hidden-by-default bundled scripts start hidden (false) unless the user
// has an explicit stored preference. Everything else keeps the "visible unless
// explicitly false" default, so the existing show/hide logic is unchanged.
const seedHiddenByDefaultVisibility = (
    visibilityById: Record<string, boolean>
): Record<string, boolean> => {
    const next = { ...visibilityById };
    BUNDLED_HIDDEN_BY_DEFAULT_SCRIPT_IDS.forEach((scriptId) => {
        const entryId = `${BUNDLED_SUBSCRIBED_ENTRY_PREFIX}${scriptId}`;
        if (typeof next[entryId] !== "boolean") {
            next[entryId] = false;
        }
    });
    return next;
};

// One element of a printed hardcopy: either a line of text or a captured graphic.
type PrintoutItem =
    | { type: "text"; text: string }
    | { type: "image"; src: string; width: number };

interface PrintOptions {
    header: boolean;
    footer: boolean;
    zebra: boolean;
    terminalFont: boolean;
    lineNumbers: boolean;
}

const DEFAULT_PRINT_OPTIONS: PrintOptions = {
    header: true,
    footer: true,
    zebra: true,
    terminalFont: true,
    lineNumbers: false,
};

const loadPrintOptions = (): PrintOptions => {
    try {
        const raw = window.localStorage.getItem(PRINT_OPTIONS_STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_PRINT_OPTIONS };
        }
        const parsed = JSON.parse(raw);
        return {
            header: parsed.header !== false,
            footer: parsed.footer !== false,
            zebra: parsed.zebra !== false,
            terminalFont: parsed.terminalFont !== false,
            lineNumbers: parsed.lineNumbers === true,
        };
    } catch {
        return { ...DEFAULT_PRINT_OPTIONS };
    }
};

const persistPrintOptions = (options: PrintOptions): void => {
    try {
        window.localStorage.setItem(PRINT_OPTIONS_STORAGE_KEY, JSON.stringify(options));
    } catch {
        // ignore storage failures (private mode, quota, etc.)
    }
};
const SHUTDOWN_THEME = createCustomTheme({
    baseThemeId: "white",
    bgHex: "#000000",
    fgHex: "#f4f6fb",
    textHex: "#f4f6fb",
    alertHex: "#f4f6fb",
    emphasisHex: "#f4f6fb",
    noticeHex: "#f4f6fb",
    hyperlinkHex: "#f4f6fb",
    systemHex: "#f4f6fb",
});

interface AppState {
    activeScript: BundledScript;
    activeScriptRevision: number;
    activeTerminalScreenId: string | null;
    printPayload: { items: PrintoutItem[]; scriptName: string; screenId: string; timestamp: string } | null;
    printOptionsOpen: boolean;
    printOptions: PrintOptions;
    customScripts: BundledScript[];
    activeTheme: Theme;
    customTheme: CustomThemeConfig;
    customThemeEditorOpen: boolean;
    themeSubmenuOpen: boolean;
    headerOverflowLevel: number;
    headerVisible: boolean;
    soundEnabled: boolean;
    scriptDropdownOpen: boolean;
    optionsDropdownOpen: boolean;
    profileDropdownOpen: boolean;
    mobileMenuOpen: boolean;
    creatorOpen: boolean;
    creatorInitialScript: any | null;
    creatorRemountVersion: number;
    modulesOpen: boolean;
    previewMode: boolean;
    uploadError: string | null;
    authSession: Session | null;
    profileRole: ProfileRole;
    authLoading: boolean;
    modulesBusy: boolean;
    modulesError: string | null;
    modulesNotice: string | null;
    myModules: ModuleRecord[];
    ownScriptsVisibilityById: Record<string, boolean>;
    subscribedModules: ModuleRecord[];
    subscribedScriptsVisibilityById: Record<string, boolean>;
    activeModule: ModuleRecord | null;
    terminalShutdownPhase: MainframePhase | null;
}

type CreatorScriptOption = BundledScript & {
    canSaveModule: boolean;
};

class App extends Component<any, AppState> {
    private _headerRef: React.RefObject<HTMLElement>;
    private _titleRef: React.RefObject<HTMLAnchorElement>;
    private _controlsRef: React.RefObject<HTMLDivElement>;
    private _headerLayoutRafId: number | null = null;
    private _authSubscription: { unsubscribe: () => void } | null = null;

    constructor(props: any) {
        super(props);

        const persistedTheme = loadPersistedTheme();
        const customTheme = loadPersistedCustomTheme();
        const headerVisible = loadPersistedHeaderVisible();
        const soundEnabled = loadPersistedSoundEnabled();
        const ownScriptsVisibilityById = loadPersistedOwnScriptsVisibility();
        const subscribedScriptsVisibilityById = seedHiddenByDefaultVisibility(loadPersistedSubscribedScriptsVisibility());
        const customScripts = this._loadCustomScripts();
        const activeScript = this._resolveInitialActiveScript(customScripts);
        const initialThemeState = this._resolveThemeStateForScript(activeScript.json, persistedTheme, customTheme);
        this._headerRef = React.createRef<HTMLElement>();
        this._titleRef = React.createRef<HTMLAnchorElement>();
        this._controlsRef = React.createRef<HTMLDivElement>();
        this.state = {
            activeScript,
            activeScriptRevision: 0,
            activeTerminalScreenId: null,
            printPayload: null,
            printOptionsOpen: false,
            printOptions: loadPrintOptions(),
            customScripts,
            activeTheme: initialThemeState.activeTheme,
            customTheme: initialThemeState.customTheme,
            customThemeEditorOpen: false,
            themeSubmenuOpen: false,
            headerOverflowLevel: 0,
            headerVisible,
            soundEnabled,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            profileDropdownOpen: false,
            mobileMenuOpen: false,
            creatorOpen: false,
            creatorInitialScript: null,
            creatorRemountVersion: 0,
            modulesOpen: this._hasAuthReturnParams(),
            previewMode: false,
            uploadError: null,
            authSession: null,
            profileRole: "user",
            authLoading: isSupabaseConfigured(),
            modulesBusy: false,
            modulesError: null,
            modulesNotice: null,
            myModules: [],
            ownScriptsVisibilityById,
            subscribedModules: [],
            subscribedScriptsVisibilityById,
            activeModule: null,
            terminalShutdownPhase: null,
        };

        this._handleScriptSelect    = this._handleScriptSelect.bind(this);
        this._handleThemeSelect     = this._handleThemeSelect.bind(this);
        this._handleThemeColorChange = this._handleThemeColorChange.bind(this);
        this._handleCustomThemeEditorToggle = this._handleCustomThemeEditorToggle.bind(this);
        this._handleFileChange      = this._handleFileChange.bind(this);
        this._handleDropdownToggle  = this._handleDropdownToggle.bind(this);
        this._handleOptionsDropdownToggle = this._handleOptionsDropdownToggle.bind(this);
        this._handleProfileDropdownToggle = this._handleProfileDropdownToggle.bind(this);
        this._handleMobileMenuToggle = this._handleMobileMenuToggle.bind(this);
        this._handleWindowResize = this._handleWindowResize.bind(this);
        this._scheduleHeaderLayoutUpdate = this._scheduleHeaderLayoutUpdate.bind(this);
        this._updateHeaderLayout = this._updateHeaderLayout.bind(this);
        this._handleClickOutside    = this._handleClickOutside.bind(this);
        this._handleReloadCurrentScript = this._handleReloadCurrentScript.bind(this);
        this._handlePrint = this._handlePrint.bind(this);
        this._openPrintOptions = this._openPrintOptions.bind(this);
        this._closePrintOptions = this._closePrintOptions.bind(this);
        this._handleClearData       = this._handleClearData.bind(this);
        this._handleSoundToggle     = this._handleSoundToggle.bind(this);
        this._handleHeaderVisibilityToggle = this._handleHeaderVisibilityToggle.bind(this);
        this._handleCreatorOpen     = this._handleCreatorOpen.bind(this);
        this._handleCreatorClose    = this._handleCreatorClose.bind(this);
        this._handleCreatorApply    = this._handleCreatorApply.bind(this);
        this._handleCreatorPreview  = this._handleCreatorPreview.bind(this);
        this._handleClearLocalModules = this._handleClearLocalModules.bind(this);
        this._handleDeleteLocalScript = this._handleDeleteLocalScript.bind(this);
        this._handleCreatorSaveModule = this._handleCreatorSaveModule.bind(this);
        this._handlePreviewReturn   = this._handlePreviewReturn.bind(this);
        this._handlePhosphorScreenChanged = this._handlePhosphorScreenChanged.bind(this);
        this._handleModulesOpen     = this._handleModulesOpen.bind(this);
        this._handleModulesClose    = this._handleModulesClose.bind(this);
        this._handleModulesDismissError = this._handleModulesDismissError.bind(this);
        this._handleModulesDismissNotice = this._handleModulesDismissNotice.bind(this);
        this._handleGoogleSignIn    = this._handleGoogleSignIn.bind(this);
        this._handleSignOut         = this._handleSignOut.bind(this);
        this._handleRefreshModules  = this._handleRefreshModules.bind(this);
        this._handleModuleLoad      = this._handleModuleLoad.bind(this);
        this._handleBundledSubscribedScriptLoad = this._handleBundledSubscribedScriptLoad.bind(this);
        this._handleCopyBundledLibraryLink = this._handleCopyBundledLibraryLink.bind(this);
        this._handleModuleSubscribe = this._handleModuleSubscribe.bind(this);
        this._handleModuleUnsubscribe = this._handleModuleUnsubscribe.bind(this);
        this._handleModuleSave      = this._handleModuleSave.bind(this);
        this._handleModuleCopyLink  = this._handleModuleCopyLink.bind(this);
        this._handleModuleUpdateDetails = this._handleModuleUpdateDetails.bind(this);
        this._handleModuleSetVisibility = this._handleModuleSetVisibility.bind(this);
        this._handleModuleDelete = this._handleModuleDelete.bind(this);
        this._handleToggleOwnScriptVisibility = this._handleToggleOwnScriptVisibility.bind(this);
        this._handleToggleSubscribedScriptVisibility = this._handleToggleSubscribedScriptVisibility.bind(this);
        this._handleMainframePhaseChange = this._handleMainframePhaseChange.bind(this);
        this._handleGlobalKeyDown = this._handleGlobalKeyDown.bind(this);
    }

    public componentDidMount(): void {
        applyTheme(this._isTerminalShutdownActive(this.state.terminalShutdownPhase) ? SHUTDOWN_THEME : this.state.activeTheme);
        this._applyHeaderHeightCss(this.state.headerVisible);
        document.addEventListener("click", this._handleClickOutside);
        document.addEventListener("keydown", this._handleGlobalKeyDown);
        window.addEventListener("resize", this._handleWindowResize);
        this._scheduleHeaderLayoutUpdate();
        void this._initializeModules();
    }

    public componentDidUpdate(_prevProps: any, prevState: AppState): void {
        this._scheduleHeaderLayoutUpdate();
        if (prevState.activeScript.id !== this.state.activeScript.id) {
            this._persistActiveScriptId(this.state.activeScript.id);
        }
        const prevShutdownActive = this._isTerminalShutdownActive(prevState.terminalShutdownPhase);
        const nextShutdownActive = this._isTerminalShutdownActive(this.state.terminalShutdownPhase);
        if (prevState.activeTheme !== this.state.activeTheme || prevShutdownActive !== nextShutdownActive) {
            applyTheme(nextShutdownActive ? SHUTDOWN_THEME : this.state.activeTheme);
        }
        const prevHeaderRendered = prevState.headerVisible && !this._isTerminalShutdownActive(prevState.terminalShutdownPhase);
        const nextHeaderRendered = this.state.headerVisible && !this._isTerminalShutdownActive(this.state.terminalShutdownPhase);
        if (prevHeaderRendered !== nextHeaderRendered) {
            this._applyHeaderHeightCss(nextHeaderRendered);
        }
    }

    public componentWillUnmount(): void {
        document.removeEventListener("click", this._handleClickOutside);
        document.removeEventListener("keydown", this._handleGlobalKeyDown);
        window.removeEventListener("resize", this._handleWindowResize);
        if (this._headerLayoutRafId !== null) {
            window.cancelAnimationFrame(this._headerLayoutRafId);
            this._headerLayoutRafId = null;
        }
        if (this._authSubscription) {
            this._authSubscription.unsubscribe();
            this._authSubscription = null;
        }
    }

    private _applyHeaderHeightCss(headerVisible: boolean): void {
        document.documentElement.style.setProperty("--header-height", headerVisible ? "50px" : "0px");
    }

    private _isTerminalShutdownActive(phase: MainframePhase | null): boolean {
        return phase === "shutdown" || phase === "epilogue";
    }

    private _handleGlobalKeyDown(event: KeyboardEvent): void {
        if (event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        if (event.shiftKey && event.key.toLowerCase() === "h") {
            // Shift+H is how you type a capital "H". Never steal it while the user
            // is typing — in a terminal prompt/login, or any real text field
            // (Script Creator, library search, report composer, ...).
            if (isTypingContext()) {
                return;
            }

            event.preventDefault();
            this._handleHeaderVisibilityToggle();
        }
    }

    private _loadCustomScripts(): BundledScript[] {
        try {
            const raw = localStorage.getItem(CUSTOM_SCRIPTS_STORAGE_KEY);
            if (!raw) {
                return [];
            }

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .map((entry: any) => {
                    if (!entry || typeof entry !== "object") {
                        return null;
                    }
                    if (typeof entry.id !== "string" || typeof entry.label !== "string") {
                        return null;
                    }
                    if (!entry.json || typeof entry.json !== "object" || !Array.isArray(entry.json.screens) || !entry.json.screens.length) {
                        return null;
                    }
                    return {
                        id: entry.id,
                        label: entry.label,
                        json: entry.json,
                    } as BundledScript;
                })
                .filter((entry: BundledScript | null): entry is BundledScript => !!entry)
                .slice(0, MAX_CUSTOM_SCRIPTS);
        } catch {
            return [];
        }
    }

    private _persistCustomScripts(customScripts: BundledScript[]): void {
        try {
            localStorage.setItem(CUSTOM_SCRIPTS_STORAGE_KEY, JSON.stringify(customScripts));
        } catch {
            // ignore storage write failures
        }
    }

    private _upsertCustomScripts(currentScripts: BundledScript[], nextScript: BundledScript): BundledScript[] {
        const withoutExisting = currentScripts.filter((script) => script.id !== nextScript.id);
        return [nextScript, ...withoutExisting].slice(0, MAX_CUSTOM_SCRIPTS);
    }

    private _resolveInitialActiveScript(customScripts: BundledScript[]): BundledScript {
        const persistedId = this._readPersistedActiveScriptId();
        if (!persistedId) {
            return DEFAULT_SCRIPT;
        }

        const availableScripts = [...BUNDLED_SCRIPTS, ...customScripts];
        const restored = availableScripts.find((script) => script.id === persistedId);
        return restored || DEFAULT_SCRIPT;
    }

    private _readPersistedActiveScriptId(): string | null {
        try {
            const raw = localStorage.getItem(ACTIVE_SCRIPT_STORAGE_KEY);
            if (!raw) {
                return null;
            }
            return raw;
        } catch {
            return null;
        }
    }

    private _persistActiveScriptId(scriptId: string): void {
        if (!scriptId || scriptId.startsWith("custom:preview:") || this._isModuleScriptId(scriptId)) {
            return;
        }
        try {
            localStorage.setItem(ACTIVE_SCRIPT_STORAGE_KEY, scriptId);
        } catch {
            // ignore storage write failures
        }
    }

    private _isModuleScriptId(scriptId: string): boolean {
        return scriptId.startsWith(MODULE_SCRIPT_ID_PREFIX);
    }

    private _buildModuleScript(module: ModuleRecord, scriptJsonOverride?: any): BundledScript {
        return {
            id: `${MODULE_SCRIPT_ID_PREFIX}${module.id}`,
            label: module.title.toUpperCase().slice(0, 48),
            json: scriptJsonOverride || module.script_json,
        };
    }

    private _formatLocalUploadLabel(rawLabel: string): string {
        const normalizedLabel = (rawLabel || "LOCAL SCRIPT")
            .toString()
            .trim()
            .replace(/^\[LOCAL\]\s*/i, "")
            .toUpperCase();
        return `[LOCAL] ${normalizedLabel}`.slice(0, 48);
    }

    private _isBundledSubscribedScriptId(scriptId: string): boolean {
        return (BUNDLED_SUBSCRIBED_SCRIPT_IDS as readonly string[]).includes(scriptId);
    }

    private _toBundledSubscribedEntryId(scriptId: string): string | null {
        if (!this._isBundledSubscribedScriptId(scriptId)) {
            return null;
        }

        return `${BUNDLED_SUBSCRIBED_ENTRY_PREFIX}${scriptId}`;
    }

    private _fromBundledSubscribedEntryId(entryId: string): string | null {
        if (!entryId.startsWith(BUNDLED_SUBSCRIBED_ENTRY_PREFIX)) {
            return null;
        }

        const scriptId = entryId.slice(BUNDLED_SUBSCRIBED_ENTRY_PREFIX.length);
        return this._isBundledSubscribedScriptId(scriptId) ? scriptId : null;
    }

    private _findBundledScriptBySubscribedEntryId(entryId: string): BundledScript | null {
        const scriptId = this._fromBundledSubscribedEntryId(entryId);
        if (!scriptId) {
            return null;
        }

        return BUNDLED_SCRIPTS.find((script) => script.id === scriptId) || null;
    }

    private _buildBundledSubscribedModules(): ModuleRecord[] {
        return BUNDLED_SCRIPTS
            .filter((script) => this._isBundledSubscribedScriptId(script.id))
            .map((script): ModuleRecord => ({
                id: `${BUNDLED_SUBSCRIBED_ENTRY_PREFIX}${script.id}`,
                owner_id: BUNDLED_OWNER_ID_PLACEHOLDER,
                title: script.label,
                summary: "Bundled script included with Phosphor.",
                script_json: script.json,
                cover_image_url: null,
                visibility: "public",
                rating_count: 0,
                rating_average: 0,
                subscription_count: 0,
                published_at: null,
                created_at: "Built-in",
                updated_at: "Built-in",
            }));
    }

    private _resolveThemeStateForScript(
        scriptJson: any,
        fallbackTheme?: Theme,
        fallbackCustomTheme?: CustomThemeConfig
    ): Pick<AppState, "activeTheme" | "customTheme"> {
        const rawThemeId = typeof scriptJson?.config?.theme === "string"
            ? scriptJson.config.theme
            : (typeof scriptJson?.config?.themeId === "string" ? scriptJson.config.themeId : "");
        const themeId = rawThemeId.trim().toLowerCase();

        if (themeId === "custom") {
            const customTheme = sanitizeCustomTheme(scriptJson?.config?.customTheme);
            return {
                activeTheme: createCustomTheme(customTheme),
                customTheme,
            };
        }

        const presetTheme = THEMES.find((theme) => theme.id === themeId);
        if (presetTheme) {
            return {
                activeTheme: presetTheme,
                customTheme: fallbackCustomTheme || loadPersistedCustomTheme(),
            };
        }

        return {
            activeTheme: fallbackTheme || loadPersistedTheme(),
            customTheme: fallbackCustomTheme || loadPersistedCustomTheme(),
        };
    }

    private _applyScriptThemePreset(scriptJson: any): Pick<AppState, "activeTheme" | "customTheme"> {
        const nextThemeState = this._resolveThemeStateForScript(scriptJson);
        applyTheme(nextThemeState.activeTheme);
        return nextThemeState;
    }

    private _getScriptDefaultTextSpeed(scriptJson: any): number | undefined {
        const rawValue = scriptJson?.config?.defaultTextSpeed;
        const parsed = typeof rawValue === "number"
            ? rawValue
            : (typeof rawValue === "string" && rawValue.trim().length ? Number(rawValue) : Number.NaN);

        if (!Number.isFinite(parsed) || parsed <= 0) {
            return undefined;
        }

        return parsed;
    }

    private _sanitizeScriptJson(scriptJson: any): any {
        const cleanedJson = JSON.parse(JSON.stringify(scriptJson));
        if (cleanedJson?.config && typeof cleanedJson.config === "object") {
            delete cleanedJson.config.previewStartScreen;
            delete cleanedJson.config.previewSelectedElementIndex;
            delete cleanedJson.config.previewSidebarListMode;
        }
        return cleanedJson;
    }

    private _buildCreatorInitialScript(scriptJson: any, screenId?: string | null): any {
        const seededJson = JSON.parse(JSON.stringify(scriptJson || {}));

        // Only override previewStartScreen if screenId is explicitly provided (not null)
        if (screenId && Array.isArray(seededJson?.screens)) {
            const screenExists = seededJson.screens.some((screen: any) => {
                return screen && typeof screen.id === "string" && screen.id === screenId;
            });
            if (screenExists) {
                seededJson.config = {
                    ...(seededJson.config || {}),
                    previewStartScreen: screenId,
                    previewSidebarListMode: "screens",
                };
                delete seededJson.config.previewSelectedElementIndex;
            }
        }

        return seededJson;
    }

    private _readModuleIdFromLocation(): string | null {
        try {
            const url = new URL(window.location.href);
            return url.searchParams.get(MODULE_QUERY_PARAM);
        } catch {
            return null;
        }
    }

    private _shouldReturnToModulesBrowser(): boolean {
        try {
            const params = new URLSearchParams(window.location.search);
            const authReturn = params.get("auth_return");
            return authReturn === "modules" || authReturn === "library";
        } catch {
            return false;
        }
    }

    private _hasAuthReturnParams(): boolean {
        try {
            const params = new URLSearchParams(window.location.search);
            return params.has("code") && params.has("state");
        } catch {
            return false;
        }
    }

    private _getModulesBrowserReturnUrl(): string {
        try {
            const currentUrl = new URL(window.location.href);
            const nextUrl = new URL(getModulesBrowserUrl());
            nextUrl.hash = currentUrl.hash;
            nextUrl.search = currentUrl.search;

            [
                "code",
                "state",
                "error",
                "error_code",
                "error_description",
                "auth_return",
                "provider_token",
                "provider_refresh_token",
            ].forEach((param) => {
                nextUrl.searchParams.delete(param);
            });

            return nextUrl.toString();
        } catch {
            return getModulesBrowserUrl();
        }
    }

    private _clearTransientAuthParams(): void {
        try {
            const url = new URL(window.location.href);
            const removableParams = [
                "code",
                "state",
                "error",
                "error_code",
                "error_description",
                "auth_return",
                "provider_token",
                "provider_refresh_token",
            ];
            let changed = false;
            removableParams.forEach((param) => {
                if (url.searchParams.has(param)) {
                    url.searchParams.delete(param);
                    changed = true;
                }
            });
            if (changed) {
                window.history.replaceState({}, "", url.toString());
            }
        } catch {
            // ignore invalid URLs
        }
    }

    private _setModuleQueryParam(moduleId: string | null): void {
        try {
            const url = new URL(window.location.href);
            if (moduleId) {
                url.searchParams.set(MODULE_QUERY_PARAM, moduleId);
            } else {
                url.searchParams.delete(MODULE_QUERY_PARAM);
            }
            ["code", "state", "error", "error_code", "error_description"].forEach((param) => {
                url.searchParams.delete(param);
            });
            window.history.replaceState({}, "", url.toString());
        } catch {
            // ignore invalid URLs
        }
    }

    private _makeModuleShareUrl(moduleId: string): string {
        return getTerminalAppUrl(moduleId);
    }

    private _getPhosphorStorageSlug(scriptJson: any): string {
        return ((scriptJson?.config?.script || scriptJson?.config?.name || "default") as string)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    private _clearActiveScriptRuntimeState(): void {
        try {
            const slug = this._getPhosphorStorageSlug(this.state.activeScript?.json);
            const sessionKey = `phosphor:session:${slug}:v1`;
            const shipLogKey = `phosphor:ship-logs:${slug}:v1`;
            const userReportKey = `phosphor:user-reports:${slug}:v1`;
            localStorage.removeItem(sessionKey);
            localStorage.removeItem(shipLogKey);
            localStorage.removeItem(userReportKey);
        } catch {
            // ignore storage failures
        }
    }

    private _getSessionUserId(): string | null {
        return this.state.authSession?.user?.id || null;
    }

    private _buildOwnScriptVisibility(
        myModules: ModuleRecord[],
        currentVisibilityById: Record<string, boolean>
    ): Record<string, boolean> {
        return myModules.reduce((acc: Record<string, boolean>, module) => {
            acc[module.id] = currentVisibilityById[module.id] !== false;
            return acc;
        }, {});
    }

    private _buildSubscribedScriptVisibility(
        subscribedModules: ModuleRecord[],
        currentVisibilityById: Record<string, boolean>
    ): Record<string, boolean> {
        const bundledEntries = this._buildBundledSubscribedModules();
        const bundledVisibility = bundledEntries.reduce((acc: Record<string, boolean>, module) => {
            acc[module.id] = currentVisibilityById[module.id] !== false;
            return acc;
        }, {});

        return subscribedModules.reduce((acc: Record<string, boolean>, module) => {
            acc[module.id] = currentVisibilityById[module.id] !== false;
            return acc;
        }, bundledVisibility);
    }

    private _handleToggleOwnScriptVisibility(moduleId: string): void {
        this.setState((prev): Pick<AppState, "ownScriptsVisibilityById" | "modulesNotice" | "modulesError"> => {
            const module = prev.myModules.find((entry) => entry.id === moduleId);
            if (!module) {
                return {
                    ownScriptsVisibilityById: prev.ownScriptsVisibilityById,
                    modulesNotice: prev.modulesNotice,
                    modulesError: prev.modulesError,
                };
            }

            const nextValue = prev.ownScriptsVisibilityById[moduleId] === false;
            const nextVisibilityById = {
                ...prev.ownScriptsVisibilityById,
                [moduleId]: nextValue,
            };
            persistOwnScriptsVisibility(nextVisibilityById);
            return {
                ownScriptsVisibilityById: nextVisibilityById,
                modulesNotice: nextValue
                    ? `"${module.title}" now appears in the script dropdown.`
                    : `"${module.title}" hidden from the script dropdown.`,
                modulesError: null,
            };
        });
    }

    private _handleToggleSubscribedScriptVisibility(moduleId: string): void {
        this.setState((prev): Pick<AppState, "subscribedScriptsVisibilityById" | "modulesNotice" | "modulesError"> => {
            const module = prev.subscribedModules.find((entry) => entry.id === moduleId) || null;
            const bundledScript = this._findBundledScriptBySubscribedEntryId(moduleId);

            if (!module && !bundledScript) {
                return {
                    subscribedScriptsVisibilityById: prev.subscribedScriptsVisibilityById,
                    modulesNotice: prev.modulesNotice,
                    modulesError: prev.modulesError,
                };
            }

            const nextValue = prev.subscribedScriptsVisibilityById[moduleId] === false;
            const nextVisibilityById = {
                ...prev.subscribedScriptsVisibilityById,
                [moduleId]: nextValue,
            };
            persistSubscribedScriptsVisibility(nextVisibilityById);

            const entryTitle = module?.title || bundledScript?.label || "This script";
            return {
                subscribedScriptsVisibilityById: nextVisibilityById,
                modulesNotice: nextValue
                    ? `"${entryTitle}" now appears in the script dropdown.`
                    : `"${entryTitle}" hidden from the script dropdown.`,
                modulesError: null,
            };
        });
    }

    private _upsertModuleRecord(currentModules: ModuleRecord[], nextModule: ModuleRecord): ModuleRecord[] {
        const otherModules = currentModules.filter((module) => module.id !== nextModule.id);
        return [nextModule, ...otherModules].sort((left, right) => {
            return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
        });
    }

    private _findModuleByScriptId(scriptId: string): ModuleRecord | null {
        if (!this._isModuleScriptId(scriptId)) {
            return null;
        }

        const moduleId = scriptId.slice(MODULE_SCRIPT_ID_PREFIX.length);
        const candidateModules = [
            this.state.activeModule,
            ...this.state.myModules,
            ...this.state.subscribedModules,
        ].filter((module): module is ModuleRecord => !!module);

        return candidateModules.find((module) => module.id === moduleId) || null;
    }

    private _getOwnedActiveModule(userId: string | null): ModuleRecord | null {
        if (!userId) {
            return null;
        }

        return this.state.activeModule?.owner_id === userId ? this.state.activeModule : null;
    }

    private _applySavedModuleState(savedModule: ModuleRecord, cleanedScriptJson: any, modulesNotice: string): void {
        const nextThemeState = this._applyScriptThemePreset(cleanedScriptJson);
        const nextScript = this._buildModuleScript(savedModule, cleanedScriptJson);

        this.setState((prev): Pick<AppState,
            "activeScript"
            | "activeScriptRevision"
            | "activeTerminalScreenId"
            | "activeModule"
            | "activeTheme"
            | "customTheme"
            | "myModules"
            | "ownScriptsVisibilityById"
            | "creatorInitialScript"
            | "modulesBusy"
            | "modulesError"
            | "modulesNotice"
        > => ({
            ...(() => {
                const myModules = this._upsertModuleRecord(prev.myModules, savedModule);
                const ownScriptsVisibilityById = {
                    ...this._buildOwnScriptVisibility(myModules, prev.ownScriptsVisibilityById),
                    [savedModule.id]: prev.ownScriptsVisibilityById[savedModule.id] !== false,
                };
                persistOwnScriptsVisibility(ownScriptsVisibilityById);
                return {
                    myModules,
                    ownScriptsVisibilityById,
                };
            })(),
            activeScript: nextScript,
            activeScriptRevision: prev.activeScriptRevision + 1,
            activeTerminalScreenId: null,
            activeModule: savedModule,
            ...nextThemeState,
            creatorInitialScript: null,
            modulesBusy: false,
            modulesError: null,
            modulesNotice,
        }));

        if (isModuleLinkShareable(savedModule.visibility)) {
            this._setModuleQueryParam(savedModule.id);
            return;
        }

        this._setModuleQueryParam(null);
    }

    private async _initializeModules(): Promise<void> {
        if (!isSupabaseConfigured()) {
            this.setState({ authLoading: false });
            return;
        }

        try {
            const session = await getCurrentSession();
            this.setState({
                authSession: session,
                authLoading: false,
            });

            this._authSubscription = onAuthStateChange((nextSession) => {
                this.setState({
                    authSession: nextSession,
                    authLoading: false,
                });

                if (nextSession?.user?.id) {
                    void this._handleRefreshModules(nextSession.user.id);
                    return;
                }

                this.setState({
                    myModules: [],
                    subscribedModules: [],
                    profileRole: "user",
                    profileDropdownOpen: false,
                });
            });

            if (session?.user?.id) {
                await this._handleRefreshModules(session.user.id);
            }

            if (this._shouldReturnToModulesBrowser()) {
                window.location.href = this._getModulesBrowserReturnUrl();
                return;
            }

            await this._loadSharedModuleFromLocation(session);
        } catch (error: any) {
            this.setState({
                authLoading: false,
                modulesError: error?.message || "Could not initialize Supabase.",
            });
        } finally {
            this._clearTransientAuthParams();
        }
    }

    private async _loadSharedModuleFromLocation(sessionOverride?: Session | null): Promise<void> {
        const moduleId = this._readModuleIdFromLocation();
        if (!moduleId || !isSupabaseConfigured()) {
            return;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
        });

        try {
            const sessionUserId = sessionOverride?.user?.id || this._getSessionUserId();
            const sessionRole = sessionUserId
                ? await getProfileRole(sessionUserId).catch(() => "user")
                : "user";
            const module = await fetchAccessibleModuleById(moduleId, sessionUserId, {
                role: sessionRole as "user" | "admin",
            });
            if (!module) {
                this.setState({
                    modulesBusy: false,
                    modulesError: "The module could not be found, or you do not have access to it.",
                });
                return;
            }

            this._loadModuleIntoApp(module, {
                notice: "Shared module loaded.",
                keepQueryParam: true,
            });
        } catch (error: any) {
            this.setState({
                modulesBusy: false,
                modulesError: error?.message || "Could not load the shared module.",
            });
        }
    }

    private _loadModuleIntoApp(
        module: ModuleRecord,
        options?: {
            notice?: string | null;
            keepQueryParam?: boolean;
        }
    ): void {
        const nextScript = this._buildModuleScript(module);
        const nextThemeState = this._applyScriptThemePreset(nextScript.json);
        this.setState((prev): Pick<AppState,
            "activeScript"
            | "activeScriptRevision"
            | "activeTerminalScreenId"
            | "activeModule"
            | "activeTheme"
            | "customTheme"
            | "creatorOpen"
            | "creatorInitialScript"
            | "previewMode"
            | "uploadError"
            | "modulesBusy"
            | "modulesError"
            | "modulesNotice"
            | "scriptDropdownOpen"
            | "optionsDropdownOpen"
            | "customThemeEditorOpen"
            | "mobileMenuOpen"
        > => ({
            activeScript: nextScript,
            activeScriptRevision: prev.activeScriptRevision + 1,
            activeTerminalScreenId: null,
            activeModule: module as ModuleRecord | null,
            ...nextThemeState,
            creatorOpen: false,
            creatorInitialScript: null,
            previewMode: false,
            uploadError: null as string | null,
            modulesBusy: false,
            modulesError: null as string | null,
            modulesNotice: options?.notice || null,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
        }));

        if (options?.keepQueryParam) {
            return;
        }

        if (isModuleLinkShareable(module.visibility)) {
            this._setModuleQueryParam(module.id);
            return;
        }

        this._setModuleQueryParam(null);
    }

    private _handleWindowResize(): void {
        this._scheduleHeaderLayoutUpdate();
    }

    private _scheduleHeaderLayoutUpdate(): void {
        if (this._headerLayoutRafId !== null) {
            return;
        }

        this._headerLayoutRafId = window.requestAnimationFrame(this._updateHeaderLayout);
    }

    private _setHeaderOverflowLevelClass(header: HTMLElement, level: number): void {
        header.classList.toggle("phosphor-header--compact", level > 0);

        for (let index = 1; index <= 7; index += 1) {
            header.classList.remove(`phosphor-header--overflow-${index}`);
        }

        if (level > 0) {
            header.classList.add(`phosphor-header--overflow-${level}`);
        }
    }

    private _updateHeaderLayout(): void {
        this._headerLayoutRafId = null;

        const header = this._headerRef.current;
        const title = this._titleRef.current;
        const controls = this._controlsRef.current;
        if (!header || !title || !controls) {
            return;
        }

        let nextOverflowLevel = 0;
        for (let level = 0; level <= 7; level += 1) {
            this._setHeaderOverflowLevelClass(header, level);

            const headerRect = header.getBoundingClientRect();
            const titleRect = title.getBoundingClientRect();
            const controlsRect = controls.getBoundingClientRect();
            const controlChildren = Array.from(controls.children)
                .filter((child): child is HTMLElement => child instanceof HTMLElement)
                .filter((child) => child.offsetParent !== null);

            let controlsVisualLeft = controlsRect.left;
            let controlsVisualRight = controlsRect.right;
            controlChildren.forEach((child) => {
                const childRect = child.getBoundingClientRect();
                controlsVisualLeft = Math.min(controlsVisualLeft, childRect.left);
                controlsVisualRight = Math.max(controlsVisualRight, childRect.right);
            });

            const titleOverlap = controlsVisualLeft < titleRect.right + 8;
            const controlsOutsideHeader = controlsVisualLeft < headerRect.left + 1
                || controlsVisualRight > headerRect.right - 1;
            const fits = !titleOverlap
                && !controlsOutsideHeader
                && header.scrollWidth <= header.clientWidth + 1
                && controls.scrollWidth <= controls.clientWidth + 1;

            if (fits) {
                nextOverflowLevel = level;
                break;
            }

            nextOverflowLevel = 7;
        }

        this._setHeaderOverflowLevelClass(header, nextOverflowLevel);

        if (nextOverflowLevel === this.state.headerOverflowLevel) {
            return;
        }

        this.setState({
            headerOverflowLevel: nextOverflowLevel,
            mobileMenuOpen: false,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            profileDropdownOpen: false,
            customThemeEditorOpen: false,
        });
    }

    private _handleClickOutside(e: MouseEvent): void {
        if (!this.state.scriptDropdownOpen
            && !this.state.optionsDropdownOpen
            && !this.state.profileDropdownOpen
            && !this.state.mobileMenuOpen) {
            return;
        }

        const target = e.target;
        if (!(target instanceof Element)) {
            return;
        }
        const nextState: Partial<AppState> = {};
        const overflowWrapper = target.closest(".phosphor-header__overflow-wrapper");

        if (this.state.scriptDropdownOpen
            && !target.closest(".phosphor-header__script-wrapper")
            && !(this.state.headerOverflowLevel >= 2 && overflowWrapper)) {
            nextState.scriptDropdownOpen = false;
        }

        if (this.state.optionsDropdownOpen
            && !target.closest(".phosphor-header__options-wrapper")
            && !(this.state.headerOverflowLevel >= 1 && overflowWrapper)) {
            nextState.optionsDropdownOpen = false;
            nextState.customThemeEditorOpen = false;
        }

        if (this.state.profileDropdownOpen && !target.closest(".phosphor-header__profile-wrapper")) {
            nextState.profileDropdownOpen = false;
        }

        if (this.state.mobileMenuOpen && !target.closest(".phosphor-header")) {
            nextState.mobileMenuOpen = false;
            nextState.scriptDropdownOpen = false;
            nextState.optionsDropdownOpen = false;
            nextState.profileDropdownOpen = false;
            nextState.customThemeEditorOpen = false;
        }

        if (Object.keys(nextState).length) {
            this.setState(nextState as Pick<AppState,
                "scriptDropdownOpen"
                | "optionsDropdownOpen"
                | "profileDropdownOpen"
                | "mobileMenuOpen"
                | "customThemeEditorOpen"
            >);
        }
    }

    private _handleDropdownToggle(): void {
        this.setState((prev) => ({
            scriptDropdownOpen: !prev.scriptDropdownOpen,
            optionsDropdownOpen: false,
            profileDropdownOpen: false,
            customThemeEditorOpen: false,
        }));
    }

    private _handleOptionsDropdownToggle(): void {
        this.setState((prev) => ({
            optionsDropdownOpen: !prev.optionsDropdownOpen,
            scriptDropdownOpen: false,
            profileDropdownOpen: false,
            customThemeEditorOpen: prev.optionsDropdownOpen ? false : prev.customThemeEditorOpen,
            themeSubmenuOpen: prev.optionsDropdownOpen ? false : prev.themeSubmenuOpen,
        }));
    }

    private _handleProfileDropdownToggle(): void {
        this.setState((prev) => ({
            profileDropdownOpen: !prev.profileDropdownOpen,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
        }));
    }

    private _handleMobileMenuToggle(): void {
        if (this.state.headerOverflowLevel === 0) {
            return;
        }

        this.setState((prev) => ({
            mobileMenuOpen: !prev.mobileMenuOpen,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            profileDropdownOpen: false,
            customThemeEditorOpen: false,
        }));
    }

    private _handleCustomThemeEditorToggle(): void {
        this.setState((prev) => {
            if (prev.activeTheme.id !== "custom") {
                return null;
            }

            return {
                customThemeEditorOpen: !prev.customThemeEditorOpen,
            };
        });
    }

    private _handleScriptSelect(script: BundledScript): void {
        if (script.id === this.state.activeScript.id) {
            this.setState({
                scriptDropdownOpen: false,
                optionsDropdownOpen: false,
                profileDropdownOpen: false,
                customThemeEditorOpen: false,
                mobileMenuOpen: false,
            });
            return;
        }
        const nextActiveModule = this._isModuleScriptId(script.id) ? this.state.activeModule : null;
        const resolvedActiveModule = this._findModuleByScriptId(script.id) || nextActiveModule;
        const nextThemeState = this._applyScriptThemePreset(script.json);
        this.setState((prev): Pick<AppState,
            "activeScript"
            | "activeScriptRevision"
            | "activeTerminalScreenId"
            | "activeModule"
            | "activeTheme"
            | "customTheme"
            | "scriptDropdownOpen"
            | "optionsDropdownOpen"
            | "profileDropdownOpen"
            | "customThemeEditorOpen"
            | "mobileMenuOpen"
            | "creatorInitialScript"
            | "previewMode"
            | "uploadError"
        > => ({
            activeScript: script,
            activeScriptRevision: prev.activeScriptRevision + 1,
            activeTerminalScreenId: null,
            activeModule: resolvedActiveModule,
            ...nextThemeState,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            profileDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            creatorInitialScript: null,
            previewMode: false,
            uploadError: null as string | null,
        }));

        if (!resolvedActiveModule) {
            this._setModuleQueryParam(null);
            return;
        }

        if (isModuleLinkShareable(resolvedActiveModule.visibility)) {
            this._setModuleQueryParam(resolvedActiveModule.id);
            return;
        }

        this._setModuleQueryParam(null);
    }

    // seedFromActiveTheme: shift-click on CUSTOM copies the theme you are currently
    // on into the custom swatches instead of restoring your last saved custom colors.
    private _handleThemeSelect(themeId: string, seedFromActiveTheme: boolean = false): void {
        if (themeId === "custom") {
            this.setState((prev) => {
                const baseThemeId = prev.activeTheme.id === "custom"
                    ? prev.customTheme.baseThemeId
                    : prev.activeTheme.id;
                const customTheme: CustomThemeConfig = seedFromActiveTheme && prev.activeTheme.id !== "custom"
                    ? customThemeFromTheme(prev.activeTheme)
                    : {
                        ...prev.customTheme,
                        baseThemeId,
                    };
                const nextTheme = createCustomTheme(customTheme);
                applyTheme(nextTheme);
                persistTheme(nextTheme);
                persistCustomTheme(customTheme);
                return {
                    customTheme,
                    activeTheme: nextTheme,
                    optionsDropdownOpen: true,
                    customThemeEditorOpen: true,
                };
            });
            return;
        }

        const nextTheme = THEMES.find((theme) => theme.id === themeId);
        if (!nextTheme) {
            return;
        }

        applyTheme(nextTheme);
        persistTheme(nextTheme);
        this.setState({
            activeTheme: nextTheme,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
        });
    }

    private _handleThemeColorChange(
        key: "bgHex" | "fgHex" | "textHex" | "alertHex" | "emphasisHex" | "noticeHex" | "hyperlinkHex" | "systemHex",
        value: string
    ): void {
        this.setState((prev): Pick<AppState, "customTheme" | "activeTheme"> => {
            const customTheme: CustomThemeConfig = {
                ...prev.customTheme,
                [key]: value,
            };
            persistCustomTheme(customTheme);

            if (prev.activeTheme.id !== "custom") {
                return {
                    customTheme,
                    activeTheme: prev.activeTheme,
                };
            }

            const nextTheme = createCustomTheme(customTheme);
            applyTheme(nextTheme);
            persistTheme(nextTheme);
            return {
                customTheme,
                activeTheme: nextTheme,
            };
        });
    }

    private _handleClearData(): void {
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
    }

    private _handleClearLocalModules(): void {
        const shouldResetActiveScript = this.state.activeScript.id.startsWith("custom:");
        const nextThemeState = shouldResetActiveScript
            ? this._applyScriptThemePreset(DEFAULT_SCRIPT.json)
            : null;

        this._persistCustomScripts([]);
        this.setState((prev): Pick<AppState,
            "customScripts"
            | "activeScript"
            | "activeScriptRevision"
            | "activeTerminalScreenId"
            | "activeModule"
            | "activeTheme"
            | "customTheme"
            | "scriptDropdownOpen"
            | "optionsDropdownOpen"
            | "profileDropdownOpen"
            | "customThemeEditorOpen"
            | "mobileMenuOpen"
            | "creatorInitialScript"
            | "previewMode"
            | "uploadError"
        > => ({
            customScripts: [],
            activeScript: shouldResetActiveScript ? DEFAULT_SCRIPT : prev.activeScript,
            activeScriptRevision: shouldResetActiveScript
                ? prev.activeScriptRevision + 1
                : prev.activeScriptRevision,
            activeTerminalScreenId: shouldResetActiveScript ? null : prev.activeTerminalScreenId,
            activeModule: shouldResetActiveScript ? null : prev.activeModule,
            ...(nextThemeState || { activeTheme: prev.activeTheme, customTheme: prev.customTheme }),
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            profileDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            creatorInitialScript: null,
            previewMode: false,
            uploadError: null as string | null,
        }));

        if (shouldResetActiveScript) {
            this._setModuleQueryParam(null);
        }
    }

    private _handleDeleteLocalScript(scriptId: string): boolean {
        const isLocalScript = scriptId.startsWith("custom:") && !scriptId.startsWith("custom:preview:");
        if (!isLocalScript) {
            return false;
        }

        const exists = this.state.customScripts.some((script) => script.id === scriptId);
        if (!exists) {
            return false;
        }

        const shouldResetActiveScript = this.state.activeScript.id === scriptId;
        const nextThemeState = shouldResetActiveScript
            ? this._applyScriptThemePreset(DEFAULT_SCRIPT.json)
            : null;

        this.setState((prev): Pick<AppState,
            "customScripts"
            | "activeScript"
            | "activeScriptRevision"
            | "activeTerminalScreenId"
            | "activeModule"
            | "activeTheme"
            | "customTheme"
            | "creatorInitialScript"
            | "previewMode"
            | "uploadError"
        > => {
            const customScripts = prev.customScripts.filter((script) => script.id !== scriptId);
            this._persistCustomScripts(customScripts);
            return {
                customScripts,
                activeScript: shouldResetActiveScript ? DEFAULT_SCRIPT : prev.activeScript,
                activeScriptRevision: shouldResetActiveScript
                    ? prev.activeScriptRevision + 1
                    : prev.activeScriptRevision,
                activeTerminalScreenId: shouldResetActiveScript ? null : prev.activeTerminalScreenId,
                activeModule: shouldResetActiveScript ? null : prev.activeModule,
                ...(nextThemeState || { activeTheme: prev.activeTheme, customTheme: prev.customTheme }),
                creatorInitialScript: null,
                previewMode: false,
                uploadError: null as string | null,
            };
        });

        if (shouldResetActiveScript) {
            this._setModuleQueryParam(null);
        }

        return true;
    }

    private _handleReloadCurrentScript(): void {
        this._clearActiveScriptRuntimeState();
        this.setState((prev): Pick<AppState,
            "activeScriptRevision"
            | "activeTerminalScreenId"
            | "scriptDropdownOpen"
            | "optionsDropdownOpen"
            | "customThemeEditorOpen"
            | "mobileMenuOpen"
            | "creatorOpen"
            | "creatorInitialScript"
            | "previewMode"
            | "uploadError"
            | "modulesNotice"
        > => ({
            activeScriptRevision: prev.activeScriptRevision + 1,
            activeTerminalScreenId: null,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            creatorOpen: false,
            creatorInitialScript: null,
            previewMode: false,
            uploadError: null as string | null,
            modulesNotice: "Reloaded from the beginning.",
        }));
    }

    private _handleSoundToggle(): void {
        this.setState((prev) => {
            const soundEnabled = !prev.soundEnabled;
            persistSoundEnabled(soundEnabled);
            return {
                soundEnabled,
            };
        });
    }

    // Turn a bitmap into a printer "screen dump": grayscale + inverted, so bright
    // on-screen pixels become dark ink on white paper. Ink is carried by the alpha
    // channel (black at variable opacity) so it prints as legible dark-on-white
    // without needing the browser's "background graphics" option. Null if unreadable.
    private _rasterizeScreenDumpImage(source: HTMLCanvasElement | HTMLImageElement): string | null {
        const width = source instanceof HTMLCanvasElement ? source.width : (source.naturalWidth || source.width);
        const height = source instanceof HTMLCanvasElement ? source.height : (source.naturalHeight || source.height);
        if (!width || !height) {
            return null;
        }

        const offscreen = document.createElement("canvas");
        offscreen.width = width;
        offscreen.height = height;
        const ctx = offscreen.getContext("2d");
        if (!ctx) {
            return null;
        }

        ctx.imageSmoothingEnabled = false;
        try {
            ctx.drawImage(source, 0, 0, width, height);
            const data = ctx.getImageData(0, 0, width, height);
            const pixels = data.data;
            for (let i = 0; i < pixels.length; i += 4) {
                // brightness of the on-screen pixel, weighted by how opaque it was
                const luminance = (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) * (pixels[i + 3] / 255);
                // black ink whose opacity tracks that brightness => dark where bright, clear where dark
                pixels[i] = 0;
                pixels[i + 1] = 0;
                pixels[i + 2] = 0;
                pixels[i + 3] = Math.round(luminance);
            }
            ctx.putImageData(data, 0, 0);
            return offscreen.toDataURL("image/png");
        } catch {
            // cross-origin sources taint the canvas and block getImageData/toDataURL
            return null;
        }
    }

    // Capture the current terminal screen as an ordered list of printable items
    // (text lines and graphics) for a "hardcopy" the way an old line printer would.
    private _extractCurrentScreenItems(): PrintoutItem[] {
        const main = document.querySelector(".__main__");
        if (!main) {
            return [];
        }

        const items: PrintoutItem[] = [];
        Array.from(main.children).forEach((child) => {
            // Bitmaps render a <canvas> (static) or <img> (animated/gif).
            const source = child.querySelector("canvas") || child.querySelector("img");
            if (source) {
                const width = Math.round(source.getBoundingClientRect().width);
                let src = this._rasterizeScreenDumpImage(source as HTMLCanvasElement | HTMLImageElement);
                if (!src && source instanceof HTMLImageElement) {
                    // fall back to the raw (unprocessed) source if pixels can't be read
                    src = source.currentSrc || source.src || null;
                }

                if (src) {
                    items.push({ type: "image", src, width });
                } else {
                    const alt = (source.getAttribute("alt") || "").trim();
                    items.push({ type: "text", text: alt.length ? `[ GRAPHIC: ${alt.toUpperCase()} ]` : "[ GRAPHIC OMITTED ]" });
                }
                return;
            }

            // strip the null char the Text element uses to keep blank lines from collapsing
            const text = (child.textContent || "").split(String.fromCharCode(0)).join("");
            items.push({ type: "text", text });
        });

        // trim trailing blank text lines so the printout ends where the content does
        while (items.length) {
            const last = items[items.length - 1];
            if (last.type === "text" && !last.text.trim().length) {
                items.pop();
            } else {
                break;
            }
        }

        return items;
    }

    private _openPrintOptions(): void {
        this.setState({
            printOptionsOpen: true,
            optionsDropdownOpen: false,
            mobileMenuOpen: false,
            scriptDropdownOpen: false,
            profileDropdownOpen: false,
        });
    }

    private _closePrintOptions(): void {
        this.setState({ printOptionsOpen: false });
    }

    private _togglePrintOption(key: keyof PrintOptions): void {
        this.setState((prev) => {
            const printOptions = { ...prev.printOptions, [key]: !prev.printOptions[key] };
            persistPrintOptions(printOptions);
            return { printOptions };
        });
    }

    private _handlePrint(): void {
        const items = this._extractCurrentScreenItems();
        if (!items.length) {
            this.setState({ printOptionsOpen: false });
            return;
        }

        const now = new Date();
        const timestamp = now.toLocaleString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });

        const scriptName = this.state.activeScript.label
            || this.state.activeScript.json?.config?.name
            || "UNTITLED SCRIPT";

        this.setState(
            {
                printPayload: {
                    items,
                    scriptName,
                    screenId: this.state.activeTerminalScreenId || "UNKNOWN",
                    timestamp,
                },
                printOptionsOpen: false,
            },
            () => {
                const cleanup = () => {
                    window.removeEventListener("afterprint", cleanup);
                    window.clearTimeout(fallbackTimer);
                    this.setState({ printPayload: null });
                };
                // afterprint fires once the print dialog closes in all modern browsers;
                // the long fallback just prevents the hidden node from lingering forever.
                const fallbackTimer = window.setTimeout(cleanup, 60000);
                window.addEventListener("afterprint", cleanup);
                window.print();
            }
        );
    }

    private _handleHeaderVisibilityToggle(): void {
        this.setState((prev) => {
            const headerVisible = !prev.headerVisible;
            persistHeaderVisible(headerVisible);
            return {
                headerVisible,
                scriptDropdownOpen: false,
                optionsDropdownOpen: false,
                profileDropdownOpen: false,
                customThemeEditorOpen: false,
                mobileMenuOpen: false,
            };
        });
    }

    private _handleMainframePhaseChange(phase: MainframePhase): void {
        this.setState((prev) => {
            const nextPhase = phase === "glitch" || phase === "shutdown" || phase === "epilogue" ? phase : null;
            if (prev.terminalShutdownPhase === nextPhase) {
                return null;
            }

            return {
                terminalShutdownPhase: nextPhase,
            };
        });
    }

    private _handleCreatorOpen(event?: React.MouseEvent<HTMLButtonElement>): void {
        const shouldPreserveSavedState = !!event?.shiftKey;
        this.setState((prev): Pick<AppState,
            | "creatorOpen"
            | "creatorInitialScript"
            | "creatorRemountVersion"
            | "scriptDropdownOpen"
            | "optionsDropdownOpen"
            | "profileDropdownOpen"
            | "customThemeEditorOpen"
            | "mobileMenuOpen"
            | "previewMode"
            | "uploadError"
        > => ({
            creatorOpen: true,
            creatorInitialScript: this._buildCreatorInitialScript(
                prev.activeScript.json,
                shouldPreserveSavedState ? null : prev.activeTerminalScreenId
            ),
            creatorRemountVersion: shouldPreserveSavedState
                ? prev.creatorRemountVersion
                : prev.creatorRemountVersion + 1,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            profileDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            previewMode: false,
            uploadError: null as string | null,
        }));
    }

    private _handleCreatorClose(scriptJson?: any): void {
        // Save the script state if provided, so shift-click can restore to this state
        if (scriptJson && Array.isArray(scriptJson?.screens)) {
            this.setState((prev): Pick<AppState, "creatorOpen" | "creatorInitialScript" | "activeScript" | "customScripts"> => {
                const nextScript: BundledScript = {
                    ...prev.activeScript,
                    json: this._sanitizeScriptJson(scriptJson),
                };
                return {
                    creatorOpen: false,
                    creatorInitialScript: null,
                    activeScript: nextScript,
                    customScripts: prev.customScripts.map((s) =>
                        s.id === nextScript.id ? nextScript : s
                    ),
                };
            });
        } else {
            this.setState({
                creatorOpen: false,
                creatorInitialScript: null,
            });
        }
    }

    private _handleCreatorApply(scriptJson: any): void {
        if (!Array.isArray(scriptJson?.screens) || !scriptJson.screens.length) {
            this.setState({ uploadError: "Invalid JSON: missing 'screens' array." });
            return;
        }

        const cleanedJson = this._sanitizeScriptJson(scriptJson);
        const label = (cleanedJson?.config?.name || "CUSTOM").toString();
        const sessionUserId = this._getSessionUserId();
        const ownedActiveModule = this._getOwnedActiveModule(sessionUserId);
        // Only treat as "editing owned module" when user actually owns it
        const editingOwnedModule = !!this.state.activeModule && !!ownedActiveModule;
        const isExistingLocal = this.state.activeScript.id.startsWith("custom:")
            && !this.state.activeScript.id.startsWith("custom:preview:");
        const keepExistingId = editingOwnedModule || isExistingLocal;
        const nextScript: BundledScript = {
            id: keepExistingId ? this.state.activeScript.id : `custom:creator:${Date.now()}`,
            // Owned modules keep their plain title; all local copies get [LOCAL] prefix
            label: editingOwnedModule
                ? label.toUpperCase().slice(0, 48)
                : this._formatLocalUploadLabel(label),
            json: cleanedJson,
        };
        const nextThemeState = this._applyScriptThemePreset(cleanedJson);

        this.setState((prev): Pick<AppState,
            "activeScript"
            | "activeScriptRevision"
            | "activeTerminalScreenId"
            | "activeModule"
            | "customScripts"
            | "activeTheme"
            | "customTheme"
            | "creatorOpen"
            | "creatorInitialScript"
            | "scriptDropdownOpen"
            | "optionsDropdownOpen"
            | "customThemeEditorOpen"
            | "mobileMenuOpen"
            | "previewMode"
            | "uploadError"
            | "modulesNotice"
        > => {
            const customScripts = editingOwnedModule
                ? prev.customScripts
                : this._upsertCustomScripts(prev.customScripts, nextScript);
            if (!editingOwnedModule) {
                this._persistCustomScripts(customScripts);
            }
            return {
                activeScript: nextScript,
                activeScriptRevision: prev.activeScriptRevision + 1,
                activeTerminalScreenId: null,
                // Clear the active module when creating a local copy from a non-owned module
                activeModule: editingOwnedModule ? prev.activeModule : null,
                customScripts,
                ...nextThemeState,
                creatorOpen: false,
                creatorInitialScript: null,
                scriptDropdownOpen: false,
                optionsDropdownOpen: false,
                customThemeEditorOpen: false,
                mobileMenuOpen: false,
                previewMode: false,
                uploadError: null as string | null,
                modulesNotice: editingOwnedModule ? "Local edits applied. Save the module to push them to Supabase." : prev.modulesNotice,
            };
        });
    }

    private _handleCreatorPreview(
        scriptJson: any,
        screenId: string,
        elementIndex: number,
        sidebarListMode: "screens" | "dialogs"
    ): void {
        if (!Array.isArray(scriptJson?.screens) || !scriptJson.screens.length) {
            this.setState({ uploadError: "Invalid JSON: missing 'screens' array." });
            return;
        }

        const exists = scriptJson.screens.some((screen: any) => {
            return screen && typeof screen.id === "string" && screen.id === screenId;
        });
        if (!exists) {
            this.setState({ uploadError: "Preview failed: selected screen was not found." });
            return;
        }

        const previewJson = JSON.parse(JSON.stringify(scriptJson));
        const selectedScreen = previewJson.screens.find((screen: any) => {
            return screen && typeof screen.id === "string" && screen.id === screenId;
        });
        const maxIndex = Math.max(0, ((selectedScreen?.content?.length || 1) - 1));
        const safeElementIndex = Number.isFinite(elementIndex)
            ? Math.min(maxIndex, Math.max(0, Math.floor(elementIndex)))
            : 0;

        previewJson.config = {
            ...(previewJson.config || {}),
            previewStartScreen: screenId,
            previewSelectedElementIndex: safeElementIndex,
            previewSidebarListMode: sidebarListMode,
        };

        const label = (previewJson?.config?.name || "PREVIEW").toString();
        const previewScript: BundledScript = {
            id: `custom:preview:${Date.now()}`,
            label: label.toUpperCase().slice(0, 48),
            json: previewJson,
        };
        const nextThemeState = this._applyScriptThemePreset(previewJson);

        this.setState((prev): Pick<AppState,
            "activeScript"
            | "activeScriptRevision"
            | "activeTerminalScreenId"
            | "activeTheme"
            | "customTheme"
            | "creatorOpen"
            | "creatorInitialScript"
            | "scriptDropdownOpen"
            | "optionsDropdownOpen"
            | "customThemeEditorOpen"
            | "mobileMenuOpen"
            | "previewMode"
            | "uploadError"
        > => ({
            activeScript: previewScript,
            activeScriptRevision: prev.activeScriptRevision + 1,
            activeTerminalScreenId: null,
            ...nextThemeState,
            creatorOpen: false,
            creatorInitialScript: null,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            previewMode: true,
            uploadError: null as string | null,
        }));
    }

    private _handlePreviewReturn(): void {
        this.setState({
            creatorOpen: true,
            creatorInitialScript: this._buildCreatorInitialScript(
                this.state.activeScript.json,
                this.state.activeTerminalScreenId
            ),
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            profileDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            previewMode: false,
            uploadError: null as string | null,
        });
    }

    private _handlePhosphorScreenChanged(screenId: string): void {
        if (!screenId || screenId === this.state.activeTerminalScreenId) {
            return;
        }

        this.setState({
            activeTerminalScreenId: screenId,
        });
    }

    private _handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            this.setState({ uploadError: "File is too large. Maximum size is 5 MB." });
            e.target.value = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target?.result as string);
                if (!Array.isArray(parsed?.screens) || !parsed.screens.length) {
                    this.setState({ uploadError: "Invalid JSON: missing 'screens' array." });
                    return;
                }

                const label = parsed?.config?.name || file.name.replace(/\.json$/i, "");
                const customScript: BundledScript = {
                    id: `custom:${Date.now()}`,
                    label: this._formatLocalUploadLabel(label),
                    json: parsed,
                };
                const nextThemeState = this._applyScriptThemePreset(parsed);
                this.setState((prev): Pick<AppState,
                    "activeScript"
                    | "activeScriptRevision"
                    | "activeTerminalScreenId"
                    | "customScripts"
                    | "activeTheme"
                    | "customTheme"
                    | "activeModule"
                    | "scriptDropdownOpen"
                    | "optionsDropdownOpen"
                    | "customThemeEditorOpen"
                    | "mobileMenuOpen"
                    | "creatorInitialScript"
                    | "previewMode"
                    | "uploadError"
                > => {
                    const customScripts = this._upsertCustomScripts(prev.customScripts, customScript);
                    this._persistCustomScripts(customScripts);
                    return {
                        activeScript: customScript,
                        activeScriptRevision: prev.activeScriptRevision + 1,
                        activeTerminalScreenId: null,
                        customScripts,
                        ...nextThemeState,
                        activeModule: null as ModuleRecord | null,
                        scriptDropdownOpen: false,
                        optionsDropdownOpen: false,
                        customThemeEditorOpen: false,
                        mobileMenuOpen: false,
                        creatorInitialScript: null,
                        previewMode: false,
                        uploadError: null as string | null,
                    };
                });
                this._setModuleQueryParam(null);
            } catch {
                this.setState({ uploadError: "Could not parse JSON file." });
            }
        };
        reader.readAsText(file);

        // reset so re-uploading the same file still triggers onChange
        e.target.value = "";
    }

    private _handleModulesOpen(): void {
        this.setState({
            modulesOpen: true,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            profileDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
        });
    }

    private _handleModulesClose(): void {
        this.setState({ modulesOpen: false });
    }

    private _handleModulesDismissError(): void {
        this.setState({ modulesError: null });
    }

    private _handleModulesDismissNotice(): void {
        this.setState({ modulesNotice: null });
    }

    private async _handleGoogleSignIn(): Promise<void> {
        if (!isSupabaseConfigured()) {
            this.setState({ modulesError: "Supabase is not configured in this environment." });
            return;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
            modulesNotice: null,
            profileDropdownOpen: false,
        });

        try {
            await signInWithGoogle(window.location.href);
        } catch (error: any) {
            this.setState({
                modulesBusy: false,
                modulesError: error?.message || "Could not start Google sign-in.",
            });
        }
    }

    private async _handleSignOut(): Promise<void> {
        this.setState({
            modulesBusy: true,
            modulesError: null,
            modulesNotice: null,
        });

        try {
            await signOut();
            this.setState({
                modulesBusy: false,
                modulesNotice: "Signed out.",
                myModules: [],
                subscribedModules: [],
                profileRole: "user",
                profileDropdownOpen: false,
            });
        } catch (error: any) {
            this.setState({
                modulesBusy: false,
                modulesError: error?.message || "Could not sign out.",
            });
        }
    }

    private async _handleRefreshModules(explicitUserIdOrEvent?: string | React.SyntheticEvent<any>): Promise<void> {
        const userId = typeof explicitUserIdOrEvent === "string"
            ? explicitUserIdOrEvent
            : this._getSessionUserId();
        if (!userId) {
            return;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
        });

        try {
            const [myModules, subscribedModules, profileRole] = await Promise.all([
                listOwnModules(userId),
                listSubscribedModules(userId),
                getProfileRole(userId).catch(() => "user" as ProfileRole),
            ]);
            this.setState((prev) => {
                const knownModules = [...myModules, ...subscribedModules];
                const refreshedActiveModule = prev.activeModule
                    ? knownModules.find((module) => module.id === prev.activeModule!.id) || prev.activeModule
                    : null;
                const ownScriptsVisibilityById = this._buildOwnScriptVisibility(
                    myModules,
                    prev.ownScriptsVisibilityById
                );
                const subscribedScriptsVisibilityById = this._buildSubscribedScriptVisibility(
                    subscribedModules,
                    prev.subscribedScriptsVisibilityById
                );
                persistOwnScriptsVisibility(ownScriptsVisibilityById);
                persistSubscribedScriptsVisibility(subscribedScriptsVisibilityById);

                return {
                    myModules,
                    ownScriptsVisibilityById,
                    subscribedModules,
                    subscribedScriptsVisibilityById,
                    profileRole,
                    activeModule: refreshedActiveModule,
                    modulesBusy: false,
                };
            });
        } catch (error: any) {
            this.setState({
                modulesBusy: false,
                modulesError: error?.message || "Could not load your modules.",
            });
        }
    }

    private _handleModuleLoad(module: ModuleRecord): void {
        this._loadModuleIntoApp(module, {
            notice: `Loaded module "${module.title}".`,
        });
    }

    private _handleBundledSubscribedScriptLoad(entryId: string): void {
        const bundledScript = this._findBundledScriptBySubscribedEntryId(entryId);
        if (!bundledScript) {
            return;
        }

        this._handleScriptSelect(bundledScript);
        this.setState({
            modulesNotice: `Loaded "${bundledScript.label}".`,
            modulesError: null,
        });
    }

    private async _handleCopyBundledLibraryLink(entryId: string): Promise<void> {
        const bundledScript = this._findBundledScriptBySubscribedEntryId(entryId);
        if (!bundledScript) {
            return;
        }

        const libraryUrl = getModulesBrowserUrl({ q: bundledScript.label });
        try {
            await navigator.clipboard.writeText(libraryUrl);
            this.setState({
                modulesNotice: "Library link copied to clipboard.",
                modulesError: null,
            });
        } catch {
            this.setState({
                modulesError: `Could not copy automatically. Share this URL manually: ${libraryUrl}`,
            });
        }
    }

    private async _handleModuleSubscribe(module: ModuleRecord): Promise<void> {
        const userId = this._getSessionUserId();
        if (!userId) {
            this.setState({ modulesError: "Sign in before subscribing to a module." });
            return;
        }

        if (module.owner_id === userId) {
            this.setState({ modulesError: "You already own this module.", modulesNotice: null });
            return;
        }

        if (module.visibility === "private") {
            const role = await getProfileRole(userId).catch(() => "user");
            if (role !== "admin") {
                this.setState({
                    modulesError: "Only admins can subscribe to private modules.",
                    modulesNotice: null,
                });
                return;
            }
        }

        if (this.state.subscribedModules.some((entry) => entry.id === module.id)) {
            this.setState({
                modulesNotice: `Already subscribed to "${module.title}".`,
                modulesError: null,
            });
            return;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
            modulesNotice: null,
        });

        try {
            await subscribeToModule(module.id, userId);
            const [myModules, subscribedModules] = await Promise.all([
                listOwnModules(userId),
                listSubscribedModules(userId),
            ]);

            this.setState((prev): Pick<AppState,
                "myModules"
                | "ownScriptsVisibilityById"
                | "subscribedModules"
                | "subscribedScriptsVisibilityById"
                | "activeModule"
                | "modulesBusy"
                | "modulesNotice"
                | "modulesError"
            > => {
                const knownModules = [...myModules, ...subscribedModules];
                const refreshedActiveModule = prev.activeModule
                    ? knownModules.find((entry) => entry.id === prev.activeModule!.id) || prev.activeModule
                    : null;
                const ownScriptsVisibilityById = this._buildOwnScriptVisibility(
                    myModules,
                    prev.ownScriptsVisibilityById
                );
                const subscribedScriptsVisibilityById = this._buildSubscribedScriptVisibility(
                    subscribedModules,
                    prev.subscribedScriptsVisibilityById
                );
                persistOwnScriptsVisibility(ownScriptsVisibilityById);
                persistSubscribedScriptsVisibility(subscribedScriptsVisibilityById);

                return {
                    myModules,
                    ownScriptsVisibilityById,
                    subscribedModules,
                    subscribedScriptsVisibilityById,
                    activeModule: refreshedActiveModule,
                    modulesBusy: false,
                    modulesNotice: `Subscribed to "${module.title}".`,
                    modulesError: null,
                };
            });
        } catch (error: any) {
            this.setState({
                modulesBusy: false,
                modulesError: error?.message || "Could not subscribe to the module.",
            });
        }
    }

    private async _handleModuleUnsubscribe(module: ModuleRecord): Promise<void> {
        const userId = this._getSessionUserId();
        if (!userId) {
            this.setState({ modulesError: "Sign in before unsubscribing from a module." });
            return;
        }

        if (!this.state.subscribedModules.some((entry) => entry.id === module.id)) {
            this.setState({
                modulesNotice: `Already unsubscribed from "${module.title}".`,
                modulesError: null,
            });
            return;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
            modulesNotice: null,
        });

        try {
            await unsubscribeFromModule(module.id, userId);
            const [myModules, subscribedModules] = await Promise.all([
                listOwnModules(userId),
                listSubscribedModules(userId),
            ]);

            this.setState((prev): Pick<AppState,
                "myModules"
                | "ownScriptsVisibilityById"
                | "subscribedModules"
                | "subscribedScriptsVisibilityById"
                | "activeModule"
                | "modulesBusy"
                | "modulesNotice"
                | "modulesError"
            > => {
                const knownModules = [...myModules, ...subscribedModules];
                const refreshedActiveModule = prev.activeModule
                    ? knownModules.find((entry) => entry.id === prev.activeModule!.id) || prev.activeModule
                    : null;
                const ownScriptsVisibilityById = this._buildOwnScriptVisibility(
                    myModules,
                    prev.ownScriptsVisibilityById
                );
                const subscribedScriptsVisibilityById = this._buildSubscribedScriptVisibility(
                    subscribedModules,
                    prev.subscribedScriptsVisibilityById
                );
                persistOwnScriptsVisibility(ownScriptsVisibilityById);
                persistSubscribedScriptsVisibility(subscribedScriptsVisibilityById);

                return {
                    myModules,
                    ownScriptsVisibilityById,
                    subscribedModules,
                    subscribedScriptsVisibilityById,
                    activeModule: refreshedActiveModule,
                    modulesBusy: false,
                    modulesNotice: `Unsubscribed from "${module.title}".`,
                    modulesError: null,
                };
            });
        } catch (error: any) {
            this.setState({
                modulesBusy: false,
                modulesError: error?.message || "Could not unsubscribe from the module.",
            });
        }
    }

    private async _handleModuleSave(payload: {
        title: string;
        summary: string;
        visibility: ModuleVisibility;
    }): Promise<boolean> {
        const userId = this._getSessionUserId();
        if (!userId) {
            this.setState({ modulesError: "Sign in before saving a module." });
            return false;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
            modulesNotice: null,
        });

        const ownedActiveModule = this._getOwnedActiveModule(userId);
        const cleanedScriptJson = this._sanitizeScriptJson(this.state.activeScript.json);

        try {
            const savedModule = await saveModule({
                id: ownedActiveModule?.id,
                ownerId: userId,
                title: payload.title,
                summary: payload.summary,
                visibility: payload.visibility,
                scriptJson: cleanedScriptJson,
            });

            this._applySavedModuleState(savedModule, cleanedScriptJson, ownedActiveModule ? "Module updated." : "Module created.");
            return true;
        } catch (error: any) {
            const errorMessage = error?.message || "Could not save the module.";
            this.setState({
                modulesBusy: false,
                modulesError: errorMessage,
            });
            return false;
        }
    }

    private async _handleCreatorSaveModule(scriptJson: any): Promise<boolean> {
        const saveAttemptLabel = `creator-save-${Date.now().toString(36)}`;
        console.log(`[Phosphor] ${saveAttemptLabel} creator save requested`, {
            userId: this._getSessionUserId(),
            activeModuleId: this.state.activeModule?.id || null,
            activeModuleTitle: this.state.activeModule?.title || null,
            activeModuleOwnerId: this.state.activeModule?.owner_id || null,
            activeScriptLabel: this.state.activeScript.label,
        });

        if (!Array.isArray(scriptJson?.screens) || !scriptJson.screens.length) {
            console.error(`[Phosphor] ${saveAttemptLabel} creator save rejected before Supabase call: missing screens array.`);
            this.setState({
                uploadError: "Invalid JSON: missing 'screens' array.",
            });
            return false;
        }

        const userId = this._getSessionUserId();
        const ownedActiveModule = this._getOwnedActiveModule(userId);
        if (!userId || !ownedActiveModule) {
            console.error(`[Phosphor] ${saveAttemptLabel} creator save rejected before Supabase call: no owned active module is selected.`, {
                userId,
                activeModuleId: this.state.activeModule?.id || null,
                activeModuleOwnerId: this.state.activeModule?.owner_id || null,
            });
            this.setState({
                modulesError: "Open one of your modules before using Save Module.",
            });
            return false;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
            modulesNotice: null,
        });

        const cleanedScriptJson = this._sanitizeScriptJson(scriptJson);
        console.log(`[Phosphor] ${saveAttemptLabel} creator save sanitized script JSON`, cleanedScriptJson);

        try {
            const savedModule = await saveModule({
                id: ownedActiveModule.id,
                ownerId: userId,
                title: ownedActiveModule.title,
                summary: ownedActiveModule.summary,
                visibility: ownedActiveModule.visibility,
                scriptJson: cleanedScriptJson,
            });

            console.log(`[Phosphor] ${saveAttemptLabel} creator save completed successfully`, {
                moduleId: savedModule.id,
                title: savedModule.title,
                visibility: savedModule.visibility,
            });
            this._applySavedModuleState(savedModule, cleanedScriptJson, "Module updated.");
            return true;
        } catch (error: any) {
            const errorMessage = error?.message || "Could not save the module.";
            console.error(`[Phosphor] ${saveAttemptLabel} creator save failed`, {
                message: error?.message,
                code: error?.code,
                details: error?.details,
                hint: error?.hint,
                error,
            });
            this.setState({
                modulesBusy: false,
                modulesError: errorMessage,
            });
            return false;
        }
    }

    private async _handleModuleCopyLink(module: ModuleRecord): Promise<void> {
        if (!isModuleLinkShareable(module.visibility)) {
            this.setState({ modulesError: "Only public or unlisted modules can be shared." });
            return;
        }

        const shareUrl = this._makeModuleShareUrl(module.id);
        try {
            await navigator.clipboard.writeText(shareUrl);
            this.setState({
                modulesNotice: "Share link copied to clipboard.",
                modulesError: null,
            });
        } catch {
            this.setState({
                modulesError: `Could not copy automatically. Share this URL manually: ${shareUrl}`,
            });
        }
    }

    private async _handleModuleUpdateDetails(
        module: ModuleRecord,
        payload: {
            title: string;
            summary: string;
        }
    ): Promise<boolean> {
        const userId = this._getSessionUserId();
        if (!userId || module.owner_id !== userId) {
            this.setState({ modulesError: "Only the owner can edit this module.", modulesNotice: null });
            return false;
        }

        const nextTitle = payload.title.trim();
        if (!nextTitle.length) {
            this.setState({ modulesError: "Add a title before saving.", modulesNotice: null });
            return false;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
            modulesNotice: null,
        });

        try {
            const updatedModule = await updateModuleMetadata({
                id: module.id,
                ownerId: userId,
                title: nextTitle,
                summary: payload.summary.trim(),
                visibility: module.visibility,
            });
            const [myModules, subscribedModules] = await Promise.all([
                listOwnModules(userId),
                listSubscribedModules(userId),
            ]);

            this.setState((prev): Pick<AppState,
                "myModules"
                | "ownScriptsVisibilityById"
                | "subscribedModules"
                | "subscribedScriptsVisibilityById"
                | "activeModule"
                | "modulesBusy"
                | "modulesNotice"
                | "modulesError"
            > => {
                const knownModules = [...myModules, ...subscribedModules];
                const refreshedActiveModule = prev.activeModule?.id === updatedModule.id
                    ? updatedModule
                    : (prev.activeModule
                        ? knownModules.find((entry) => entry.id === prev.activeModule!.id) || prev.activeModule
                        : null);
                const ownScriptsVisibilityById = this._buildOwnScriptVisibility(
                    myModules,
                    prev.ownScriptsVisibilityById
                );
                const subscribedScriptsVisibilityById = this._buildSubscribedScriptVisibility(
                    subscribedModules,
                    prev.subscribedScriptsVisibilityById
                );
                persistOwnScriptsVisibility(ownScriptsVisibilityById);
                persistSubscribedScriptsVisibility(subscribedScriptsVisibilityById);

                return {
                    myModules,
                    ownScriptsVisibilityById,
                    subscribedModules,
                    subscribedScriptsVisibilityById,
                    activeModule: refreshedActiveModule,
                    modulesBusy: false,
                    modulesNotice: `Updated "${updatedModule.title}".`,
                    modulesError: null,
                };
            });

            return true;
        } catch (error: any) {
            this.setState({
                modulesBusy: false,
                modulesError: error?.message || "Could not update the module.",
                modulesNotice: null,
            });
            return false;
        }
    }

    private async _handleModuleSetVisibility(
        module: ModuleRecord,
        nextVisibility: ModuleVisibility
    ): Promise<boolean> {
        const userId = this._getSessionUserId();
        if (!userId || module.owner_id !== userId) {
            this.setState({ modulesError: "Only the owner can change module visibility.", modulesNotice: null });
            return false;
        }

        if (module.visibility === nextVisibility) {
            return true;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
            modulesNotice: null,
        });

        try {
            const updatedModule = await updateModuleMetadata({
                id: module.id,
                ownerId: userId,
                title: module.title,
                summary: module.summary,
                visibility: nextVisibility,
            });
            const [myModules, subscribedModules] = await Promise.all([
                listOwnModules(userId),
                listSubscribedModules(userId),
            ]);

            this.setState((prev): Pick<AppState,
                "myModules"
                | "ownScriptsVisibilityById"
                | "subscribedModules"
                | "subscribedScriptsVisibilityById"
                | "activeModule"
                | "modulesBusy"
                | "modulesNotice"
                | "modulesError"
            > => {
                const knownModules = [...myModules, ...subscribedModules];
                const refreshedActiveModule = prev.activeModule?.id === updatedModule.id
                    ? updatedModule
                    : (prev.activeModule
                        ? knownModules.find((entry) => entry.id === prev.activeModule!.id) || prev.activeModule
                        : null);
                const ownScriptsVisibilityById = this._buildOwnScriptVisibility(
                    myModules,
                    prev.ownScriptsVisibilityById
                );
                const subscribedScriptsVisibilityById = this._buildSubscribedScriptVisibility(
                    subscribedModules,
                    prev.subscribedScriptsVisibilityById
                );
                persistOwnScriptsVisibility(ownScriptsVisibilityById);
                persistSubscribedScriptsVisibility(subscribedScriptsVisibilityById);

                return {
                    myModules,
                    ownScriptsVisibilityById,
                    subscribedModules,
                    subscribedScriptsVisibilityById,
                    activeModule: refreshedActiveModule,
                    modulesBusy: false,
                    modulesNotice: `"${updatedModule.title}" is now ${nextVisibility}.`,
                    modulesError: null,
                };
            });

            if (this.state.activeModule?.id === updatedModule.id) {
                if (isModuleLinkShareable(updatedModule.visibility)) {
                    this._setModuleQueryParam(updatedModule.id);
                } else {
                    this._setModuleQueryParam(null);
                }
            }

            return true;
        } catch (error: any) {
            this.setState({
                modulesBusy: false,
                modulesError: error?.message || "Could not update module visibility.",
                modulesNotice: null,
            });
            return false;
        }
    }

    private async _handleModuleDelete(module: ModuleRecord): Promise<boolean> {
        const userId = this._getSessionUserId();
        if (!userId || module.owner_id !== userId) {
            this.setState({ modulesError: "Only the owner can delete this module.", modulesNotice: null });
            return false;
        }

        if (!window.confirm(`Delete "${module.title}"? This cannot be undone.`)) {
            return false;
        }

        this.setState({
            modulesBusy: true,
            modulesError: null,
            modulesNotice: null,
        });

        try {
            await deleteModule(module.id, userId);
            const [myModules, subscribedModules] = await Promise.all([
                listOwnModules(userId),
                listSubscribedModules(userId),
            ]);

            this.setState((prev): Pick<AppState,
                "myModules"
                | "ownScriptsVisibilityById"
                | "subscribedModules"
                | "subscribedScriptsVisibilityById"
                | "activeModule"
                | "modulesBusy"
                | "modulesNotice"
                | "modulesError"
            > => {
                const ownScriptsVisibilityById = this._buildOwnScriptVisibility(
                    myModules,
                    prev.ownScriptsVisibilityById
                );
                const subscribedScriptsVisibilityById = this._buildSubscribedScriptVisibility(
                    subscribedModules,
                    prev.subscribedScriptsVisibilityById
                );
                persistOwnScriptsVisibility(ownScriptsVisibilityById);
                persistSubscribedScriptsVisibility(subscribedScriptsVisibilityById);

                return {
                    myModules,
                    ownScriptsVisibilityById,
                    subscribedModules,
                    subscribedScriptsVisibilityById,
                    activeModule: prev.activeModule?.id === module.id ? null : prev.activeModule,
                    modulesBusy: false,
                    modulesNotice: `Deleted "${module.title}".`,
                    modulesError: null,
                };
            });

            if (this.state.activeModule?.id === module.id) {
                this._setModuleQueryParam(null);
            }

            return true;
        } catch (error: any) {
            this.setState({
                modulesBusy: false,
                modulesError: error?.message || "Could not delete the module.",
                modulesNotice: null,
            });
            return false;
        }
    }

    public render(): ReactElement {
        const {
            activeScript,
            activeScriptRevision,
            customScripts,
            activeTheme,
            customTheme,
            customThemeEditorOpen,
            themeSubmenuOpen,
            headerOverflowLevel,
            headerVisible,
            soundEnabled,
            scriptDropdownOpen,
            optionsDropdownOpen,
            profileDropdownOpen,
            mobileMenuOpen,
            creatorOpen,
            creatorInitialScript,
            creatorRemountVersion,
            modulesOpen,
            previewMode,
            uploadError,
            authSession,
            profileRole,
            authLoading,
            modulesBusy,
            modulesError,
            modulesNotice,
            myModules,
            ownScriptsVisibilityById,
            subscribedModules,
            subscribedScriptsVisibilityById,
            activeModule,
            terminalShutdownPhase,
        } = this.state;
        const shutdownActive = this._isTerminalShutdownActive(terminalShutdownPhase);
        const renderHeader = headerVisible && !shutdownActive;
        const sessionEmail = authSession?.user?.email || null;
        const sessionUserId = authSession?.user?.id || null;
        const ownedActiveModule = this._getOwnedActiveModule(sessionUserId);
        const bundledSubscribedModules = this._buildBundledSubscribedModules();
        const subscribedModulesForPanel = [...subscribedModules, ...bundledSubscribedModules];
        const ownScripts: CreatorScriptOption[] = myModules
            .filter((module) => ownScriptsVisibilityById[module.id] !== false)
            .map((module) => ({
                ...this._buildModuleScript(module),
                canSaveModule: true,
            }));
        const subscribedScripts: CreatorScriptOption[] = subscribedModules
            .filter((module) => subscribedScriptsVisibilityById[module.id] !== false)
            .map((module) => ({
                ...this._buildModuleScript(module),
                canSaveModule: false,
            }));
        const bundledScripts: CreatorScriptOption[] = BUNDLED_SCRIPTS
            .filter((script) => {
                const visibilityEntryId = this._toBundledSubscribedEntryId(script.id);
                if (!visibilityEntryId) {
                    return true;
                }

                return subscribedScriptsVisibilityById[visibilityEntryId] !== false;
            })
            .map((script) => ({
                ...script,
                canSaveModule: false,
            }));
        const customScriptsWithFlags: CreatorScriptOption[] = customScripts.map((script) => ({
            ...script,
            canSaveModule: false,
        }));
        const activeScriptWithFlag: CreatorScriptOption | null = activeModule
            ? {
                ...activeScript,
                canSaveModule: !!ownedActiveModule,
            }
            : null;
        const availableScripts = (activeModule
            ? [activeScriptWithFlag, ...ownScripts, ...subscribedScripts, ...bundledScripts, ...customScriptsWithFlags]
            : [...ownScripts, ...subscribedScripts, ...bundledScripts, ...customScriptsWithFlags]
        ).filter((script): script is CreatorScriptOption => !!script).filter((script, index, scripts) => {
            return scripts.findIndex((candidate) => candidate.id === script.id) === index;
        });

        return (
            <>
                {renderHeader && (
                    <header
                        ref={this._headerRef}
                        className={
                            "phosphor-header" +
                            (headerOverflowLevel > 0 ? ` phosphor-header--compact phosphor-header--overflow-${headerOverflowLevel}` : "")
                        }
                    >
                    <a
                        ref={this._titleRef}
                        className="phosphor-header__title"
                        href={getTerminalAppUrl()}
                        title="Return to the PHOSPHOR terminal"
                    >
                        {APP_TITLE} TERMINAL
                    </a>

                    <div
                        ref={this._controlsRef}
                        className={"phosphor-header__controls" + (mobileMenuOpen ? " phosphor-header__controls--open" : "")}
                    >
                        {uploadError && (
                            <span style={{ color: "var(--alert)", fontSize: "inherit" }}>
                                {uploadError}
                            </span>
                        )}

                        {!previewMode && (
                            <div className="phosphor-header__script-wrapper phosphor-header__hide-at-7">
                                <button
                                    className="phosphor-header__btn"
                                    onClick={this._handleDropdownToggle}
                                    aria-haspopup="listbox"
                                    aria-expanded={scriptDropdownOpen}
                                >
                                    [SCRIPT:{activeScript.label} {scriptDropdownOpen ? "▲" : "▼"}]
                                </button>

                        {scriptDropdownOpen && (
                            <div className="phosphor-header__dropdown phosphor-header__dropdown--scripts" role="listbox">
                                        {availableScripts.map((script) => (
                                            <button
                                                key={script.id}
                                                role="option"
                                                aria-selected={script.id === activeScript.id}
                                                className={
                                                    "phosphor-header__dropdown-item" +
                                                    (script.id === activeScript.id ? " phosphor-header__dropdown-item--active" : "")
                                                }
                                                onClick={() => this._handleScriptSelect(script)}
                                            >
                                                {script.id === activeScript.id ? "► " : "  "}{script.label}
                                            </button>
                                        ))}

                                        <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

                                        <label className="phosphor-header__dropdown-item">
                                            &nbsp;&nbsp;[UPLOAD JSON]
                                            <input
                                                type="file"
                                                accept=".json,application/json"
                                                style={{ display: "none" }}
                                                onChange={this._handleFileChange}
                                            />
                                        </label>
                                    </div>
                                )}
                            </div>
                        )}

                        {previewMode && (
                            <>
                                <span>[PREVIEW MODE]</span>
                                <button
                                    className="phosphor-header__btn"
                                    onClick={this._handlePreviewReturn}
                                    title="Return to Script Creator"
                                >
                                    [RETURN TO CREATOR]
                                </button>
                            </>
                        )}

                        {!previewMode && (
                            <button
                                className="phosphor-header__btn phosphor-header__hide-at-5"
                                onClick={this._handleCreatorOpen}
                                title="Open visual JSON script creator (Shift+Click to sync current script/screen)"
                            >
                                [CREATOR]
                            </button>
                        )}

                        {!previewMode && (
                            <button
                                className="phosphor-header__btn phosphor-header__hide-at-4"
                                onClick={this._handleModulesOpen}
                                title="Open your module manager"
                            >
                                [MODULES]
                            </button>
                        )}

                        {!previewMode && (
                            <a
                                className="phosphor-header__btn phosphor-header__hide-at-3"
                                href={getModulesBrowserUrl()}
                                title="Browse library modules"
                            >
                                [LIBRARY]
                            </a>
                        )}


                        <div className="phosphor-header__options-wrapper phosphor-header__hide-at-1">
                            <button
                                className="phosphor-header__btn"
                                onClick={this._handleOptionsDropdownToggle}
                                aria-haspopup="menu"
                                aria-expanded={optionsDropdownOpen}
                                title="Theme, sound, and system options"
                            >
                                [OPTIONS {optionsDropdownOpen ? "▲" : "▼"}]
                            </button>

                            {optionsDropdownOpen && (
                                <div className="phosphor-header__dropdown phosphor-header__dropdown--options" role="menu">
                                    <button
                                        className="phosphor-header__dropdown-item"
                                        role="menuitem"
                                        onClick={this._handleSoundToggle}
                                        title="Toggle sound effects and ambient audio"
                                    >
                                        [SOUND:{soundEnabled ? "ON" : "OFF"}]
                                    </button>

                                    <button
                                        className="phosphor-header__dropdown-item"
                                        role="menuitem"
                                        onClick={this._handleHeaderVisibilityToggle}
                                        title="Toggle the terminal header (Shift+H)"
                                    >
                                        [HEADER:{headerVisible ? "ON" : "OFF"}]
                                    </button>

                                    <button
                                        className="phosphor-header__dropdown-item"
                                        role="menuitem"
                                        onClick={this._openPrintOptions}
                                        title="Print the current screen as a vintage terminal hardcopy"
                                    >
                                        [PRINT]
                                    </button>

                                    {!previewMode && (
                                        <button
                                            className="phosphor-header__dropdown-item"
                                            role="menuitem"
                                            onClick={this._handleReloadCurrentScript}
                                            title="Restart the current script from the beginning"
                                        >
                                            [RELOAD]
                                        </button>
                                    )}

                                    {!previewMode && (
                                        <button
                                            className="phosphor-header__dropdown-item"
                                            role="menuitem"
                                            onClick={this._handleClearLocalModules}
                                            title="Remove local uploaded scripts from this browser only"
                                        >
                                            [CLEAR LOCAL]
                                        </button>
                                    )}

                                    {!previewMode && (
                                        <button
                                            className="phosphor-header__dropdown-item"
                                            role="menuitem"
                                            onClick={this._handleClearData}
                                            title="Clear all saved data, including login, and reload"
                                        >
                                            [RESET]
                                        </button>
                                    )}

                                    <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

                                    <button
                                        className="phosphor-header__dropdown-item"
                                        role="menuitem"
                                        aria-expanded={themeSubmenuOpen}
                                        onClick={() => this.setState((prev) => ({ themeSubmenuOpen: !prev.themeSubmenuOpen }))}
                                    >
                                        [THEME {themeSubmenuOpen ? "▲" : "▼"}]
                                    </button>

                                    {themeSubmenuOpen && (
                                    <>
                                    {THEMES.map((theme) => (
                                        <button
                                            key={theme.id}
                                            role="menuitemradio"
                                            aria-checked={theme.id === activeTheme.id}
                                            className={
                                                "phosphor-header__dropdown-item" +
                                                (theme.id === activeTheme.id ? " phosphor-header__dropdown-item--active" : "")
                                            }
                                            onClick={() => this._handleThemeSelect(theme.id)}
                                        >
                                            {theme.id === activeTheme.id ? "► " : "  "}{theme.name}
                                        </button>
                                    ))}

                                    <button
                                        role="menuitemradio"
                                        aria-checked={activeTheme.id === "custom"}
                                        className={
                                            "phosphor-header__dropdown-item" +
                                            (activeTheme.id === "custom" ? " phosphor-header__dropdown-item--active" : "")
                                        }
                                        title={activeTheme.id === "custom"
                                            ? undefined
                                            : "Shift-click to copy the current theme's colors into CUSTOM"}
                                        onClick={(event) => {
                                            if (activeTheme.id !== "custom") {
                                                this._handleThemeSelect("custom", event.shiftKey);
                                                return;
                                            }
                                            this._handleCustomThemeEditorToggle();
                                        }}
                                    >
                                        {activeTheme.id === "custom" ? "► " : "  "}
                                        CUSTOM {activeTheme.id === "custom" ? (customThemeEditorOpen ? "▲" : "▼") : ""}
                                    </button>

                                    {activeTheme.id === "custom" && customThemeEditorOpen && (
                                        <div className="phosphor-header__theme-custom">
                                            <label className="phosphor-header__theme-color-field">
                                                <span>FG</span>
                                                <input
                                                    type="color"
                                                    aria-label="Custom foreground color"
                                                    value={customTheme.fgHex}
                                                    onChange={(e) => this._handleThemeColorChange("fgHex", e.target.value)}
                                                />
                                            </label>
                                            <label className="phosphor-header__theme-color-field">
                                                <span>TEXT</span>
                                                <input
                                                    type="color"
                                                    aria-label="Custom text color"
                                                    value={customTheme.textHex}
                                                    onChange={(e) => this._handleThemeColorChange("textHex", e.target.value)}
                                                />
                                            </label>
                                            <label className="phosphor-header__theme-color-field">
                                                <span>BG</span>
                                                <input
                                                    type="color"
                                                    aria-label="Custom background color"
                                                    value={customTheme.bgHex}
                                                    onChange={(e) => this._handleThemeColorChange("bgHex", e.target.value)}
                                                />
                                            </label>
                                            <label className="phosphor-header__theme-color-field">
                                                <span>ALERT</span>
                                                <input
                                                    type="color"
                                                    aria-label="Custom alert color"
                                                    value={customTheme.alertHex}
                                                    onChange={(e) => this._handleThemeColorChange("alertHex", e.target.value)}
                                                />
                                            </label>
                                            <label className="phosphor-header__theme-color-field">
                                                <span>EMPHASIS</span>
                                                <input
                                                    type="color"
                                                    aria-label="Custom emphasis color"
                                                    value={customTheme.emphasisHex}
                                                    onChange={(e) => this._handleThemeColorChange("emphasisHex", e.target.value)}
                                                />
                                            </label>
                                            <label className="phosphor-header__theme-color-field">
                                                <span>NOTICE</span>
                                                <input
                                                    type="color"
                                                    aria-label="Custom notice color"
                                                    value={customTheme.noticeHex}
                                                    onChange={(e) => this._handleThemeColorChange("noticeHex", e.target.value)}
                                                />
                                            </label>
                                            <label className="phosphor-header__theme-color-field">
                                                <span>HYPERLINK</span>
                                                <input
                                                    type="color"
                                                    aria-label="Custom hyperlink color"
                                                    value={customTheme.hyperlinkHex}
                                                    onChange={(e) => this._handleThemeColorChange("hyperlinkHex", e.target.value)}
                                                />
                                            </label>
                                            <label className="phosphor-header__theme-color-field">
                                                <span>SYSTEM</span>
                                                <input
                                                    type="color"
                                                    aria-label="Custom system color"
                                                    value={customTheme.systemHex}
                                                    onChange={(e) => this._handleThemeColorChange("systemHex", e.target.value)}
                                                />
                                            </label>
                                        </div>
                                    )}
                                    </>
                                    )}
                                </div>
                            )}
                        </div>

                        {!previewMode && (
                            <a
                                className="phosphor-header__btn phosphor-header__hide-at-2"
                                href="https://ko-fi.com/ethandunning"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                [DONATE]
                            </a>
                        )}

                        {!previewMode && (
                            <a
                                className="phosphor-header__btn phosphor-header__hide-at-2"
                                href="https://github.com/EthanDunning/phosphor"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                [GITHUB]
                            </a>
                        )}

                        {!authLoading && !sessionEmail && (
                            <button
                                className="phosphor-header__btn phosphor-header__hide-at-2"
                                onClick={() => void this._handleGoogleSignIn()}
                            >
                                [SIGN IN]
                            </button>
                        )}

                        {!authLoading && !!sessionEmail && (
                            <div className="phosphor-header__options-wrapper phosphor-header__profile-wrapper phosphor-header__hide-at-6">
                                <button
                                    className="phosphor-header__btn"
                                    onClick={this._handleProfileDropdownToggle}
                                    aria-haspopup="menu"
                                    aria-expanded={profileDropdownOpen}
                                >
                                    [PROFILE {profileDropdownOpen ? "▲" : "▼"}]
                                </button>

                                {profileDropdownOpen && (
                                    <div className="phosphor-header__dropdown phosphor-header__dropdown--options" role="menu">
                                        <div className="phosphor-header__dropdown-label">[ACCOUNT]</div>
                                        <div className="phosphor-header__profile-row">
                                            <span className="phosphor-header__profile-key">[EMAIL]</span>
                                            <span className="phosphor-header__profile-value">{sessionEmail}</span>
                                        </div>
                                        <div className="phosphor-header__profile-row">
                                            <span className="phosphor-header__profile-key">[MODULES CREATED]</span>
                                            <span className="phosphor-header__profile-value">{myModules.length}</span>
                                        </div>
                                        {profileRole === "admin" && (
                                            <div className="phosphor-header__profile-row">
                                                <span className="phosphor-header__profile-key">[ROLE]</span>
                                                <span className="phosphor-header__profile-value">admin</span>
                                            </div>
                                        )}
                                        <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />
                                        <button
                                            className="phosphor-header__dropdown-item"
                                            role="menuitem"
                                            onClick={() => void this._handleSignOut()}
                                        >
                                            [SIGN OUT]
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="phosphor-header__options-wrapper phosphor-header__overflow-wrapper">
                            <button
                                className="phosphor-header__btn phosphor-header__menu-btn"
                                onClick={this._handleMobileMenuToggle}
                                aria-haspopup="menu"
                                aria-expanded={mobileMenuOpen}
                                title="Open menu"
                            >
                                [MENU {mobileMenuOpen ? "▲" : "▼"}]
                            </button>

                            {mobileMenuOpen && (
                                <div className="phosphor-header__dropdown phosphor-header__dropdown--options phosphor-header__overflow-dropdown" role="menu">
                                    {!previewMode && headerOverflowLevel >= 1 && (
                                        <div className="phosphor-header__overflow-section">
                                            <button
                                                className="phosphor-header__dropdown-item"
                                                role="menuitem"
                                                aria-expanded={optionsDropdownOpen}
                                                onClick={this._handleOptionsDropdownToggle}
                                            >
                                                [OPTIONS {optionsDropdownOpen ? "▲" : "▼"}]
                                            </button>

                                            {optionsDropdownOpen && (
                                                <>
                                                    <button
                                                        className="phosphor-header__dropdown-item"
                                                        role="menuitem"
                                                        onClick={this._handleSoundToggle}
                                                        title="Toggle sound effects and ambient audio"
                                                    >
                                                        [SOUND:{soundEnabled ? "ON" : "OFF"}]
                                                    </button>

                                                    <button
                                                        className="phosphor-header__dropdown-item"
                                                        role="menuitem"
                                                        onClick={this._handleHeaderVisibilityToggle}
                                                        title="Toggle the terminal header (Shift+H)"
                                                    >
                                                        [HEADER:{headerVisible ? "ON" : "OFF"}]
                                                    </button>

                                                    <button
                                                        className="phosphor-header__dropdown-item"
                                                        role="menuitem"
                                                        onClick={this._openPrintOptions}
                                                        title="Print the current screen as a vintage terminal hardcopy"
                                                    >
                                                        [PRINT]
                                                    </button>

                                                    {!previewMode && (
                                                        <button
                                                            className="phosphor-header__dropdown-item"
                                                            role="menuitem"
                                                            onClick={this._handleReloadCurrentScript}
                                                            title="Restart the current script from the beginning"
                                                        >
                                                            [RELOAD]
                                                        </button>
                                                    )}

                                                    {!previewMode && (
                                                        <button
                                                            className="phosphor-header__dropdown-item"
                                                            role="menuitem"
                                                            onClick={this._handleClearLocalModules}
                                                            title="Remove local uploaded scripts from this browser only"
                                                        >
                                                            [CLEAR LOCAL]
                                                        </button>
                                                    )}

                                                    {!previewMode && (
                                                        <button
                                                            className="phosphor-header__dropdown-item"
                                                            role="menuitem"
                                                            onClick={this._handleClearData}
                                                            title="Clear all saved data, including login, and reload"
                                                        >
                                                            [RESET]
                                                        </button>
                                                    )}

                                                    <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

                                                    <button
                                                        className="phosphor-header__dropdown-item"
                                                        role="menuitem"
                                                        aria-expanded={themeSubmenuOpen}
                                                        onClick={() => this.setState((prev) => ({ themeSubmenuOpen: !prev.themeSubmenuOpen }))}
                                                    >
                                                        [THEME {themeSubmenuOpen ? "▲" : "▼"}]
                                                    </button>

                                                    {themeSubmenuOpen && (
                                                    <>
                                                    {THEMES.map((theme) => (
                                                        <button
                                                            key={theme.id}
                                                            role="menuitemradio"
                                                            aria-checked={theme.id === activeTheme.id}
                                                            className={
                                                                "phosphor-header__dropdown-item" +
                                                                (theme.id === activeTheme.id ? " phosphor-header__dropdown-item--active" : "")
                                                            }
                                                            onClick={() => this._handleThemeSelect(theme.id)}
                                                        >
                                                            {theme.id === activeTheme.id ? "► " : "  "}{theme.name}
                                                        </button>
                                                    ))}

                                                    <button
                                                        role="menuitemradio"
                                                        aria-checked={activeTheme.id === "custom"}
                                                        className={
                                                            "phosphor-header__dropdown-item" +
                                                            (activeTheme.id === "custom" ? " phosphor-header__dropdown-item--active" : "")
                                                        }
                                                        title={activeTheme.id === "custom"
                                                            ? undefined
                                                            : "Shift-click to copy the current theme's colors into CUSTOM"}
                                                        onClick={(event) => {
                                                            if (activeTheme.id !== "custom") {
                                                                this._handleThemeSelect("custom", event.shiftKey);
                                                                return;
                                                            }
                                                            this._handleCustomThemeEditorToggle();
                                                        }}
                                                    >
                                                        {activeTheme.id === "custom" ? "► " : "  "}
                                                        CUSTOM {activeTheme.id === "custom" ? (customThemeEditorOpen ? "▲" : "▼") : ""}
                                                    </button>

                                                    {activeTheme.id === "custom" && customThemeEditorOpen && (
                                                        <div className="phosphor-header__theme-custom">
                                                            <label className="phosphor-header__theme-color-field">
                                                                <span>FG</span>
                                                                <input
                                                                    type="color"
                                                                    aria-label="Custom foreground color"
                                                                    value={customTheme.fgHex}
                                                                    onChange={(e) => this._handleThemeColorChange("fgHex", e.target.value)}
                                                                />
                                                            </label>
                                                            <label className="phosphor-header__theme-color-field">
                                                                <span>TEXT</span>
                                                                <input
                                                                    type="color"
                                                                    aria-label="Custom text color"
                                                                    value={customTheme.textHex}
                                                                    onChange={(e) => this._handleThemeColorChange("textHex", e.target.value)}
                                                                />
                                                            </label>
                                                            <label className="phosphor-header__theme-color-field">
                                                                <span>BG</span>
                                                                <input
                                                                    type="color"
                                                                    aria-label="Custom background color"
                                                                    value={customTheme.bgHex}
                                                                    onChange={(e) => this._handleThemeColorChange("bgHex", e.target.value)}
                                                                />
                                                            </label>
                                                            <label className="phosphor-header__theme-color-field">
                                                                <span>ALERT</span>
                                                                <input
                                                                    type="color"
                                                                    aria-label="Custom alert color"
                                                                    value={customTheme.alertHex}
                                                                    onChange={(e) => this._handleThemeColorChange("alertHex", e.target.value)}
                                                                />
                                                            </label>
                                                            <label className="phosphor-header__theme-color-field">
                                                                <span>EMPHASIS</span>
                                                                <input
                                                                    type="color"
                                                                    aria-label="Custom emphasis color"
                                                                    value={customTheme.emphasisHex}
                                                                    onChange={(e) => this._handleThemeColorChange("emphasisHex", e.target.value)}
                                                                />
                                                            </label>
                                                            <label className="phosphor-header__theme-color-field">
                                                                <span>NOTICE</span>
                                                                <input
                                                                    type="color"
                                                                    aria-label="Custom notice color"
                                                                    value={customTheme.noticeHex}
                                                                    onChange={(e) => this._handleThemeColorChange("noticeHex", e.target.value)}
                                                                />
                                                            </label>
                                                            <label className="phosphor-header__theme-color-field">
                                                                <span>HYPERLINK</span>
                                                                <input
                                                                    type="color"
                                                                    aria-label="Custom hyperlink color"
                                                                    value={customTheme.hyperlinkHex}
                                                                    onChange={(e) => this._handleThemeColorChange("hyperlinkHex", e.target.value)}
                                                                />
                                                            </label>
                                                            <label className="phosphor-header__theme-color-field">
                                                                <span>SYSTEM</span>
                                                                <input
                                                                    type="color"
                                                                    aria-label="Custom system color"
                                                                    value={customTheme.systemHex}
                                                                    onChange={(e) => this._handleThemeColorChange("systemHex", e.target.value)}
                                                                />
                                                            </label>
                                                        </div>
                                                    )}
                                                    </>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {!previewMode && headerOverflowLevel >= 7 && (
                                        <div className="phosphor-header__overflow-section">
                                            <button
                                                className="phosphor-header__dropdown-item"
                                                role="menuitem"
                                                aria-expanded={scriptDropdownOpen}
                                                onClick={this._handleDropdownToggle}
                                            >
                                                [SCRIPT:{activeScript.label} {scriptDropdownOpen ? "▲" : "▼"}]
                                            </button>

                                            {scriptDropdownOpen && (
                                                <div className="phosphor-header__dropdown phosphor-header__dropdown--scripts phosphor-header__dropdown--scripts-inline" role="listbox">
                                                    {availableScripts.map((script) => (
                                                        <button
                                                            key={script.id}
                                                            role="option"
                                                            aria-selected={script.id === activeScript.id}
                                                            className={
                                                                "phosphor-header__dropdown-item" +
                                                                (script.id === activeScript.id ? " phosphor-header__dropdown-item--active" : "")
                                                            }
                                                            onClick={() => this._handleScriptSelect(script)}
                                                        >
                                                            {script.id === activeScript.id ? "► " : "  "}{script.label}
                                                        </button>
                                                    ))}

                                                    <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

                                                    <label className="phosphor-header__dropdown-item">
                                                        &nbsp;&nbsp;[UPLOAD JSON]
                                                        <input
                                                            type="file"
                                                            accept=".json,application/json"
                                                            style={{ display: "none" }}
                                                            onChange={this._handleFileChange}
                                                        />
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!previewMode && headerOverflowLevel >= 2 && (
                                        <>
                                            <a
                                                className="phosphor-header__dropdown-item"
                                                href="https://ko-fi.com/ethandunning"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                role="menuitem"
                                                onClick={() => this.setState({ mobileMenuOpen: false })}
                                            >
                                                [DONATE]
                                            </a>

                                            <a
                                                className="phosphor-header__dropdown-item"
                                                href="https://github.com/EthanDunning/phosphor"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                role="menuitem"
                                                onClick={() => this.setState({ mobileMenuOpen: false })}
                                            >
                                                [GITHUB]
                                            </a>

                                            {!authLoading && !sessionEmail && (
                                                <button
                                                    className="phosphor-header__dropdown-item"
                                                    role="menuitem"
                                                    onClick={() => {
                                                        this.setState({ mobileMenuOpen: false });
                                                        void this._handleGoogleSignIn();
                                                    }}
                                                >
                                                    [SIGN IN]
                                                </button>
                                            )}
                                        </>
                                    )}

                                    {!previewMode && headerOverflowLevel >= 3 && (
                                        <>
                                            <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

                                            <a
                                                className="phosphor-header__dropdown-item"
                                                href={getModulesBrowserUrl()}
                                                role="menuitem"
                                                onClick={() => this.setState({ mobileMenuOpen: false })}
                                            >
                                                [LIBRARY]
                                            </a>
                                        </>
                                    )}

                                    {!previewMode && headerOverflowLevel >= 4 && (
                                        <>
                                            <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

                                            <button
                                                className="phosphor-header__dropdown-item"
                                                role="menuitem"
                                                onClick={() => {
                                                    this._handleModulesOpen();
                                                    this.setState({ mobileMenuOpen: false });
                                                }}
                                            >
                                                [MODULES]
                                            </button>
                                        </>
                                    )}

                                    {!previewMode && headerOverflowLevel >= 5 && (
                                        <>
                                            <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

                                            <button
                                                className="phosphor-header__dropdown-item"
                                                role="menuitem"
                                                onClick={(event) => {
                                                    this._handleCreatorOpen(event);
                                                    this.setState({ mobileMenuOpen: false });
                                                }}
                                            >
                                                [CREATOR]
                                            </button>
                                        </>
                                    )}

                                    {!authLoading && !!sessionEmail && headerOverflowLevel >= 6 && (
                                        <>
                                            <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

                                            <div className="phosphor-header__dropdown-label">[ACCOUNT]</div>
                                            <div className="phosphor-header__profile-row">
                                                <span className="phosphor-header__profile-key">[EMAIL]</span>
                                                <span className="phosphor-header__profile-value">{sessionEmail}</span>
                                            </div>
                                            <div className="phosphor-header__profile-row">
                                                <span className="phosphor-header__profile-key">[MODULES CREATED]</span>
                                                <span className="phosphor-header__profile-value">{myModules.length}</span>
                                            </div>
                                            {profileRole === "admin" && (
                                                <div className="phosphor-header__profile-row">
                                                    <span className="phosphor-header__profile-key">[ROLE]</span>
                                                    <span className="phosphor-header__profile-value">admin</span>
                                                </div>
                                            )}
                                            <button
                                                className="phosphor-header__dropdown-item"
                                                role="menuitem"
                                                onClick={() => {
                                                    this.setState({ mobileMenuOpen: false });
                                                    void this._handleSignOut();
                                                }}
                                            >
                                                [SIGN OUT]
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    </header>
                )}

                <Phosphor
                    key={`${activeScript.id}:${activeScriptRevision}`}
                    json={activeScript.json}
                    defaultTextSpeed={this._getScriptDefaultTextSpeed(activeScript.json)}
                    soundEnabled={soundEnabled}
                    onScreenChanged={this._handlePhosphorScreenChanged}
                    onMainframePhaseChange={this._handleMainframePhaseChange}
                    shutdownPhase={terminalShutdownPhase}
                />

                <ScriptCreator
                    key={`creator:${creatorRemountVersion}`}
                    open={creatorOpen}
                    initialScript={creatorInitialScript || activeScript.json}
                    initialScriptId={activeScript.id}
                    availableScripts={availableScripts}
                    onApply={this._handleCreatorApply}
                    onPreview={this._handleCreatorPreview}
                    onClose={this._handleCreatorClose}
                    onDeleteLocalScript={this._handleDeleteLocalScript}
                    onSaveModule={ownedActiveModule ? this._handleCreatorSaveModule : undefined}
                />

                <ModulesPanel
                    open={modulesOpen}
                    supabaseReady={isSupabaseConfigured()}
                    busy={modulesBusy}
                    sessionUserId={sessionUserId}
                    currentScript={activeScript.json}
                    currentScriptLabel={activeScript.label}
                    activeModule={activeModule}
                    myModules={myModules}
                    ownScriptsVisibilityById={ownScriptsVisibilityById}
                    subscribedModules={subscribedModulesForPanel}
                    subscribedScriptsVisibilityById={subscribedScriptsVisibilityById}
                    errorMessage={modulesError}
                    noticeMessage={modulesNotice}
                    libraryUrl={getModulesBrowserUrl()}
                    onClose={this._handleModulesClose}
                    onDismissError={this._handleModulesDismissError}
                    onDismissNotice={this._handleModulesDismissNotice}
                    onRefresh={this._handleRefreshModules}
                    onLoadModule={this._handleModuleLoad}
                    onLoadBundledScript={this._handleBundledSubscribedScriptLoad}
                    onCopyBundledLibraryLink={this._handleCopyBundledLibraryLink}
                    onToggleOwnScriptVisibility={this._handleToggleOwnScriptVisibility}
                    onSubscribeToModule={this._handleModuleSubscribe}
                    onUnsubscribeFromModule={this._handleModuleUnsubscribe}
                    onSaveModule={this._handleModuleSave}
                    onCopyShareLink={this._handleModuleCopyLink}
                    onUpdateModuleDetails={this._handleModuleUpdateDetails}
                    onSetModuleVisibility={this._handleModuleSetVisibility}
                    onDeleteModule={this._handleModuleDelete}
                    onToggleSubscribedScriptVisibility={this._handleToggleSubscribedScriptVisibility}
                />

                {this.state.printPayload && createPortal(
                    <div
                        id="phosphor-printout"
                        className={
                            "phosphor-printout"
                            + (this.state.printOptions.zebra ? " phosphor-printout--zebra" : "")
                            + (this.state.printOptions.terminalFont ? "" : " phosphor-printout--printer-font")
                        }
                        aria-hidden="true"
                    >
                        {this.state.printOptions.header && (
                        <div className="phosphor-printout__banner">
                            <span>{this.state.printPayload.scriptName.toUpperCase()}</span>
                            <span>
                                SCREEN: {this.state.printPayload.screenId.toUpperCase()}
                                {"   "}
                                {this.state.printPayload.timestamp}
                            </span>
                        </div>
                        )}
                        <div className="phosphor-printout__body">
                            {(() => {
                                const items = this.state.printPayload!.items;
                                const numbered = this.state.printOptions.lineNumbers;
                                const width = Math.max(3, String(items.length).length);
                                return items.map((item, index) => {
                                    const lineNo = numbered ? (
                                        <span className="phosphor-printout__lineno">
                                            {String(index + 1).padStart(width, "0")}
                                        </span>
                                    ) : null;
                                    return item.type === "image" ? (
                                        <div className="phosphor-printout__image-line" key={index}>
                                            {lineNo}
                                            <img
                                                src={item.src}
                                                alt=""
                                                style={item.width ? { width: `${item.width}px` } : undefined}
                                            />
                                        </div>
                                    ) : (
                                        <div className="phosphor-printout__line" key={index}>
                                            {lineNo}
                                            <span className="phosphor-printout__linetext">
                                                {item.text.length ? item.text : " "}
                                            </span>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                        {this.state.printOptions.footer && (
                        <div className="phosphor-printout__banner phosphor-printout__banner--foot">
                            <span>END OF HARDCOPY</span>
                            <span>
                                {this.state.printPayload.items.filter((item) => item.type === "text").length} LINES
                            </span>
                        </div>
                        )}
                    </div>,
                    document.body
                )}

                {this.state.printOptionsOpen && (
                    <div className="phosphor-print-options" onClick={this._closePrintOptions}>
                        <div className="phosphor-print-options__box" onClick={(e) => e.stopPropagation()}>
                            <div className="phosphor-print-options__title">[PRINT OPTIONS]</div>
                            <label className="phosphor-print-options__row">
                                <input
                                    type="checkbox"
                                    checked={this.state.printOptions.header}
                                    onChange={() => this._togglePrintOption("header")}
                                />
                                <span>Header banner</span>
                            </label>
                            <label className="phosphor-print-options__row">
                                <input
                                    type="checkbox"
                                    checked={this.state.printOptions.footer}
                                    onChange={() => this._togglePrintOption("footer")}
                                />
                                <span>Footer banner</span>
                            </label>
                            <label className="phosphor-print-options__row">
                                <input
                                    type="checkbox"
                                    checked={this.state.printOptions.zebra}
                                    onChange={() => this._togglePrintOption("zebra")}
                                />
                                <span>Alternating greenbar lines</span>
                            </label>
                            <label className="phosphor-print-options__row">
                                <input
                                    type="checkbox"
                                    checked={this.state.printOptions.terminalFont}
                                    onChange={() => this._togglePrintOption("terminalFont")}
                                />
                                <span>Use terminal font (off = printer font)</span>
                            </label>
                            <label className="phosphor-print-options__row">
                                <input
                                    type="checkbox"
                                    checked={this.state.printOptions.lineNumbers}
                                    onChange={() => this._togglePrintOption("lineNumbers")}
                                />
                                <span>Line numbers</span>
                            </label>
                            <div className="phosphor-print-options__actions">
                                <button className="phosphor-header__btn" onClick={this._handlePrint}>
                                    [PRINT]
                                </button>
                                <button className="phosphor-header__btn" onClick={this._closePrintOptions}>
                                    [CANCEL]
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    }
}

export default App;
