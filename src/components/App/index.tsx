import React, { Component, ReactElement } from "react";
import "./style.scss";

import Phosphor from "../Phosphor";
import ScriptCreator from "../ScriptCreator";
import { BUNDLED_SCRIPTS, BundledScript, DEFAULT_SCRIPT } from "../../data";
import { THEMES, Theme, loadPersistedTheme, persistTheme, applyTheme } from "../../themes";

const CUSTOM_SCRIPTS_STORAGE_KEY = "phosphor:custom-scripts:v1";
const MAX_CUSTOM_SCRIPTS = 50;

interface AppState {
    activeScript: BundledScript;
    customScripts: BundledScript[];
    activeTheme: Theme;
    scriptDropdownOpen: boolean;
    creatorOpen: boolean;
    previewMode: boolean;
    uploadError: string | null;
}

class App extends Component<any, AppState> {
    constructor(props: any) {
        super(props);

        const persistedTheme = loadPersistedTheme();
        const customScripts = this._loadCustomScripts();
        this.state = {
            activeScript: DEFAULT_SCRIPT,
            customScripts,
            activeTheme: persistedTheme,
            scriptDropdownOpen: false,
            creatorOpen: false,
            previewMode: false,
            uploadError: null,
        };

        this._handleScriptSelect    = this._handleScriptSelect.bind(this);
        this._handleThemeCycle      = this._handleThemeCycle.bind(this);
        this._handleFileChange      = this._handleFileChange.bind(this);
        this._handleDropdownToggle  = this._handleDropdownToggle.bind(this);
        this._handleClickOutside    = this._handleClickOutside.bind(this);
        this._handleClearData       = this._handleClearData.bind(this);
        this._handleCreatorOpen     = this._handleCreatorOpen.bind(this);
        this._handleCreatorClose    = this._handleCreatorClose.bind(this);
        this._handleCreatorApply    = this._handleCreatorApply.bind(this);
        this._handleCreatorPreview  = this._handleCreatorPreview.bind(this);
        this._handlePreviewReturn   = this._handlePreviewReturn.bind(this);
    }

    public componentDidMount(): void {
        applyTheme(this.state.activeTheme);
        document.addEventListener("click", this._handleClickOutside);
    }

    public componentWillUnmount(): void {
        document.removeEventListener("click", this._handleClickOutside);
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

    private _handleClickOutside(e: MouseEvent): void {
        if (!this.state.scriptDropdownOpen) {
            return;
        }
        const target = e.target as Element;
        if (!target.closest(".phosphor-header__script-wrapper")) {
            this.setState({ scriptDropdownOpen: false });
        }
    }

    private _handleDropdownToggle(): void {
        this.setState((prev) => ({ scriptDropdownOpen: !prev.scriptDropdownOpen }));
    }

    private _handleScriptSelect(script: BundledScript): void {
        if (script.id === this.state.activeScript.id) {
            this.setState({ scriptDropdownOpen: false });
            return;
        }
        this.setState({ activeScript: script, scriptDropdownOpen: false, previewMode: false, uploadError: null });
    }

    private _handleThemeCycle(): void {
        const currentIndex = THEMES.findIndex((t) => t.id === this.state.activeTheme.id);
        const nextTheme = THEMES[(currentIndex + 1) % THEMES.length];
        applyTheme(nextTheme);
        persistTheme(nextTheme);
        this.setState({ activeTheme: nextTheme });
    }

    private _handleClearData(): void {
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
    }

    private _handleCreatorOpen(): void {
        this.setState({
            creatorOpen: true,
            scriptDropdownOpen: false,
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
            previewMode: true,
            uploadError: null,
        });
    }

    private _handlePreviewReturn(): void {
        this.setState({
            creatorOpen: true,
            scriptDropdownOpen: false,
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
        const { activeScript, customScripts, activeTheme, scriptDropdownOpen, creatorOpen, previewMode, uploadError } = this.state;
        const availableScripts = [...BUNDLED_SCRIPTS, ...customScripts];

        return (
            <>
                <header className="phosphor-header">
                    <span className="phosphor-header__title">PHOSPHOR v1.4.1</span>

                    <div className="phosphor-header__controls">
                        {uploadError && (
                            <span style={{ color: "rgb(255,60,0)", fontSize: "inherit" }}>
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

                        <button
                            className="phosphor-header__btn"
                            onClick={this._handleThemeCycle}
                            title="Cycle color theme"
                        >
                            [THEME:{activeTheme.name}→]
                        </button>

                        {!previewMode && (
                            <button
                                className="phosphor-header__btn"
                                onClick={this._handleClearData}
                                title="Clear all saved data and reload"
                            >
                                [RESET]
                            </button>
                        )}

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
