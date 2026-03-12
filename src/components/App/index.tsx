import React, { Component, ReactElement } from "react";
import "./style.scss";

import Phosphor from "../Phosphor";
import ScriptCreator from "../ScriptCreator";
import { BUNDLED_SCRIPTS, BundledScript, DEFAULT_SCRIPT } from "../../data";
import {
    THEMES,
    Theme,
    CustomThemeConfig,
    createCustomTheme,
    loadPersistedCustomTheme,
    loadPersistedTheme,
    persistCustomTheme,
    persistTheme,
    applyTheme,
} from "../../themes";

const CUSTOM_SCRIPTS_STORAGE_KEY = "phosphor:custom-scripts:v1";
const MAX_CUSTOM_SCRIPTS = 50;

interface AppState {
    activeScript: BundledScript;
    customScripts: BundledScript[];
    activeTheme: Theme;
    customTheme: CustomThemeConfig;
    customThemeEditorOpen: boolean;
    headerCompact: boolean;
    soundEnabled: boolean;
    scriptDropdownOpen: boolean;
    optionsDropdownOpen: boolean;
    mobileMenuOpen: boolean;
    creatorOpen: boolean;
    previewMode: boolean;
    uploadError: string | null;
}

class App extends Component<any, AppState> {
    private _headerRef: React.RefObject<HTMLElement>;
    private _controlsRef: React.RefObject<HTMLDivElement>;
    private _headerLayoutRafId: number | null = null;

    constructor(props: any) {
        super(props);

        const persistedTheme = loadPersistedTheme();
        const customTheme = loadPersistedCustomTheme();
        const customScripts = this._loadCustomScripts();
        this._headerRef = React.createRef<HTMLElement>();
        this._controlsRef = React.createRef<HTMLDivElement>();
        this.state = {
            activeScript: DEFAULT_SCRIPT,
            customScripts,
            activeTheme: persistedTheme,
            customTheme,
            customThemeEditorOpen: false,
            headerCompact: false,
            soundEnabled: true,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            mobileMenuOpen: false,
            creatorOpen: false,
            previewMode: false,
            uploadError: null,
        };

        this._handleScriptSelect    = this._handleScriptSelect.bind(this);
        this._handleThemeSelect     = this._handleThemeSelect.bind(this);
        this._handleThemeColorChange = this._handleThemeColorChange.bind(this);
        this._handleCustomThemeEditorToggle = this._handleCustomThemeEditorToggle.bind(this);
        this._handleFileChange      = this._handleFileChange.bind(this);
        this._handleDropdownToggle  = this._handleDropdownToggle.bind(this);
        this._handleOptionsDropdownToggle = this._handleOptionsDropdownToggle.bind(this);
        this._handleMobileMenuToggle = this._handleMobileMenuToggle.bind(this);
        this._handleWindowResize = this._handleWindowResize.bind(this);
        this._scheduleHeaderLayoutUpdate = this._scheduleHeaderLayoutUpdate.bind(this);
        this._updateHeaderLayout = this._updateHeaderLayout.bind(this);
        this._handleClickOutside    = this._handleClickOutside.bind(this);
        this._handleClearData       = this._handleClearData.bind(this);
        this._handleSoundToggle     = this._handleSoundToggle.bind(this);
        this._handleCreatorOpen     = this._handleCreatorOpen.bind(this);
        this._handleCreatorClose    = this._handleCreatorClose.bind(this);
        this._handleCreatorApply    = this._handleCreatorApply.bind(this);
        this._handleCreatorPreview  = this._handleCreatorPreview.bind(this);
        this._handlePreviewReturn   = this._handlePreviewReturn.bind(this);
    }

    public componentDidMount(): void {
        applyTheme(this.state.activeTheme);
        document.addEventListener("click", this._handleClickOutside);
        window.addEventListener("resize", this._handleWindowResize);
        this._scheduleHeaderLayoutUpdate();
    }

    public componentDidUpdate(): void {
        this._scheduleHeaderLayoutUpdate();
    }

    public componentWillUnmount(): void {
        document.removeEventListener("click", this._handleClickOutside);
        window.removeEventListener("resize", this._handleWindowResize);
        if (this._headerLayoutRafId !== null) {
            window.cancelAnimationFrame(this._headerLayoutRafId);
            this._headerLayoutRafId = null;
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

    private _handleWindowResize(): void {
        this._scheduleHeaderLayoutUpdate();
    }

    private _scheduleHeaderLayoutUpdate(): void {
        if (this._headerLayoutRafId !== null) {
            return;
        }

        this._headerLayoutRafId = window.requestAnimationFrame(this._updateHeaderLayout);
    }

    private _updateHeaderLayout(): void {
        this._headerLayoutRafId = null;

        const header = this._headerRef.current;
        const controls = this._controlsRef.current;
        if (!header || !controls) {
            return;
        }

        // Measure in desktop mode even if currently compact.
        const hadCompactClass = header.classList.contains("phosphor-header--compact");
        if (hadCompactClass) {
            header.classList.remove("phosphor-header--compact");
        }

        const shouldCompact = header.scrollWidth > header.clientWidth + 1
            || controls.scrollWidth > controls.clientWidth + 1;

        if (hadCompactClass) {
            header.classList.add("phosphor-header--compact");
        }

        if (shouldCompact === this.state.headerCompact) {
            return;
        }

        this.setState({
            headerCompact: shouldCompact,
            mobileMenuOpen: false,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
        });
    }

    private _handleClickOutside(e: MouseEvent): void {
        if (!this.state.scriptDropdownOpen && !this.state.optionsDropdownOpen && !this.state.mobileMenuOpen) {
            return;
        }

        const target = e.target;
        if (!(target instanceof Element)) {
            return;
        }
        const nextState: Partial<AppState> = {};

        if (this.state.scriptDropdownOpen && !target.closest(".phosphor-header__script-wrapper")) {
            nextState.scriptDropdownOpen = false;
        }

        if (this.state.optionsDropdownOpen && !target.closest(".phosphor-header__options-wrapper")) {
            nextState.optionsDropdownOpen = false;
            nextState.customThemeEditorOpen = false;
        }

        if (this.state.mobileMenuOpen && !target.closest(".phosphor-header")) {
            nextState.mobileMenuOpen = false;
            nextState.scriptDropdownOpen = false;
            nextState.optionsDropdownOpen = false;
            nextState.customThemeEditorOpen = false;
        }

        if (Object.keys(nextState).length) {
            this.setState(nextState as Pick<AppState, "scriptDropdownOpen" | "optionsDropdownOpen" | "mobileMenuOpen" | "customThemeEditorOpen">);
        }
    }

    private _handleDropdownToggle(): void {
        this.setState((prev) => ({
            scriptDropdownOpen: !prev.scriptDropdownOpen,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
        }));
    }

    private _handleOptionsDropdownToggle(): void {
        this.setState((prev) => ({
            optionsDropdownOpen: !prev.optionsDropdownOpen,
            scriptDropdownOpen: false,
            customThemeEditorOpen: prev.optionsDropdownOpen ? false : prev.customThemeEditorOpen,
        }));
    }

    private _handleMobileMenuToggle(): void {
        if (!this.state.headerCompact) {
            return;
        }

        this.setState((prev) => ({
            mobileMenuOpen: !prev.mobileMenuOpen,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
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
                customThemeEditorOpen: false,
                mobileMenuOpen: false,
            });
            return;
        }
        this.setState({
            activeScript: script,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            previewMode: false,
            uploadError: null,
        });
    }

    private _handleThemeSelect(themeId: string): void {
        if (themeId === "custom") {
            this.setState((prev) => {
                const baseThemeId = prev.activeTheme.id === "custom"
                    ? prev.customTheme.baseThemeId
                    : prev.activeTheme.id;
                const customTheme: CustomThemeConfig = {
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
        key: "fgHex" | "alertHex" | "emphasisHex" | "noticeHex" | "systemHex",
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

    private _handleSoundToggle(): void {
        this.setState((prev) => ({
            soundEnabled: !prev.soundEnabled,
        }));
    }

    private _handleCreatorOpen(): void {
        this.setState({
            creatorOpen: true,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            previewMode: false,
            uploadError: null,
        });
    }

    private _handleCreatorClose(): void {
        this.setState({ creatorOpen: false });
    }

    private _handleCreatorApply(scriptJson: any): void {
        if (!Array.isArray(scriptJson?.screens) || !scriptJson.screens.length) {
            this.setState({ uploadError: "Invalid JSON: missing 'screens' array." });
            return;
        }

        const cleanedJson = JSON.parse(JSON.stringify(scriptJson));
        if (cleanedJson?.config && typeof cleanedJson.config === "object") {
            delete cleanedJson.config.previewStartScreen;
            delete cleanedJson.config.previewSelectedElementIndex;
        }

        const label = (cleanedJson?.config?.name || "CUSTOM").toString();
        const keepExistingId = this.state.activeScript.id.startsWith("custom:")
            && !this.state.activeScript.id.startsWith("custom:preview:");
        const customScript: BundledScript = {
            id: keepExistingId ? this.state.activeScript.id : `custom:creator:${Date.now()}`,
            label: label.toUpperCase().slice(0, 24),
            json: cleanedJson,
        };

        this.setState((prev) => {
            const customScripts = this._upsertCustomScripts(prev.customScripts, customScript);
            this._persistCustomScripts(customScripts);
            return {
                activeScript: customScript,
                customScripts,
                creatorOpen: false,
                scriptDropdownOpen: false,
                optionsDropdownOpen: false,
                customThemeEditorOpen: false,
                mobileMenuOpen: false,
                previewMode: false,
                uploadError: null as string | null,
            };
        });
    }

    private _handleCreatorPreview(scriptJson: any, screenId: string, elementIndex: number): void {
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
        };

        const label = (previewJson?.config?.name || "PREVIEW").toString();
        const previewScript: BundledScript = {
            id: `custom:preview:${Date.now()}`,
            label: label.toUpperCase().slice(0, 24),
            json: previewJson,
        };

        this.setState({
            activeScript: previewScript,
            creatorOpen: false,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            previewMode: true,
            uploadError: null,
        });
    }

    private _handlePreviewReturn(): void {
        this.setState({
            creatorOpen: true,
            scriptDropdownOpen: false,
            optionsDropdownOpen: false,
            customThemeEditorOpen: false,
            mobileMenuOpen: false,
            previewMode: false,
            uploadError: null,
        });
    }

    private _handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
        const file = e.target.files?.[0];
        if (!file) {
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
                    label: label.toUpperCase().slice(0, 24),
                    json: parsed,
                };
                this.setState((prev) => {
                    const customScripts = this._upsertCustomScripts(prev.customScripts, customScript);
                    this._persistCustomScripts(customScripts);
                    return {
                        activeScript: customScript,
                        customScripts,
                        scriptDropdownOpen: false,
                        optionsDropdownOpen: false,
                        customThemeEditorOpen: false,
                        mobileMenuOpen: false,
                        previewMode: false,
                        uploadError: null as string | null,
                    };
                });
            } catch {
                this.setState({ uploadError: "Could not parse JSON file." });
            }
        };
        reader.readAsText(file);

        // reset so re-uploading the same file still triggers onChange
        e.target.value = "";
    }

    public render(): ReactElement {
        const {
            activeScript,
            customScripts,
            activeTheme,
            customTheme,
            customThemeEditorOpen,
            headerCompact,
            soundEnabled,
            scriptDropdownOpen,
            optionsDropdownOpen,
            mobileMenuOpen,
            creatorOpen,
            previewMode,
            uploadError,
        } = this.state;
        const availableScripts = [...BUNDLED_SCRIPTS, ...customScripts];

        return (
            <>
                <header
                    ref={this._headerRef}
                    className={"phosphor-header" + (headerCompact ? " phosphor-header--compact" : "")}
                >
                    <span className="phosphor-header__title">PHOSPHOR v5.5</span>

                    <button
                        className="phosphor-header__btn phosphor-header__menu-btn"
                        onClick={this._handleMobileMenuToggle}
                        aria-haspopup="menu"
                        aria-expanded={mobileMenuOpen}
                        title="Toggle header controls"
                    >
                        [MENU {mobileMenuOpen ? "▲" : "▼"}]
                    </button>

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
                            <div className="phosphor-header__script-wrapper">
                                <button
                                    className="phosphor-header__btn"
                                    onClick={this._handleDropdownToggle}
                                    aria-haspopup="listbox"
                                    aria-expanded={scriptDropdownOpen}
                                >
                                    [SCRIPT: {activeScript.label} {scriptDropdownOpen ? "▲" : "▼"}]
                                </button>

                                {scriptDropdownOpen && (
                                    <div className="phosphor-header__dropdown" role="listbox">
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
                                className="phosphor-header__btn"
                                onClick={this._handleCreatorOpen}
                                title="Open visual JSON script creator"
                            >
                                [CREATOR]
                            </button>
                        )}

                        <div className="phosphor-header__options-wrapper">
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

                                    {!previewMode && (
                                        <button
                                            className="phosphor-header__dropdown-item"
                                            role="menuitem"
                                            onClick={this._handleClearData}
                                            title="Clear all saved data and reload"
                                        >
                                            [RESET]
                                        </button>
                                    )}

                                    <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

                                    <div className="phosphor-header__dropdown-label">[THEME]</div>
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
                                        onClick={() => {
                                            if (activeTheme.id !== "custom") {
                                                this._handleThemeSelect("custom");
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
                                </div>
                            )}
                        </div>

                        {!previewMode && (
                            <a
                                className="phosphor-header__btn"
                                href="https://ko-fi.com/ethandunning"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                [DONATE]
                            </a>
                        )}

                        {!previewMode && (
                            <a
                                className="phosphor-header__btn"
                                href="https://github.com/EthanDunning/phosphor"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                [GITHUB]
                            </a>
                        )}
                    </div>
                </header>

                <Phosphor
                    key={activeScript.id}
                    json={activeScript.json}
                    soundEnabled={soundEnabled}
                />

                {creatorOpen && (
                    <ScriptCreator
                        initialScript={activeScript.json}
                        onApply={this._handleCreatorApply}
                        onPreview={this._handleCreatorPreview}
                        onClose={this._handleCreatorClose}
                    />
                )}
            </>
        );
    }
}

export default App;
