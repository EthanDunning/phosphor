import React, { Component, createRef, ReactElement } from "react";
import "./style.scss";

import Phosphor from "../Phosphor";
import { BUNDLED_SCRIPTS, BundledScript, DEFAULT_SCRIPT } from "../../data";
import { THEMES, Theme, loadPersistedTheme, persistTheme, applyTheme } from "../../themes";

interface AppState {
    activeScript: BundledScript;
    activeTheme: Theme;
    scriptDropdownOpen: boolean;
    uploadError: string | null;
}

class App extends Component<any, AppState> {
    private _fileInputRef = createRef<HTMLInputElement>();

    constructor(props: any) {
        super(props);

        const persistedTheme = loadPersistedTheme();
        this.state = {
            activeScript: DEFAULT_SCRIPT,
            activeTheme: persistedTheme,
            scriptDropdownOpen: false,
            uploadError: null,
        };

        this._handleScriptSelect    = this._handleScriptSelect.bind(this);
        this._handleThemeCycle      = this._handleThemeCycle.bind(this);
        this._handleFileChange      = this._handleFileChange.bind(this);
        this._handleDropdownToggle  = this._handleDropdownToggle.bind(this);
        this._handleClickOutside    = this._handleClickOutside.bind(this);
    }

    public componentDidMount(): void {
        applyTheme(this.state.activeTheme);
        document.addEventListener("click", this._handleClickOutside);
    }

    public componentWillUnmount(): void {
        document.removeEventListener("click", this._handleClickOutside);
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
        this.setState({ activeScript: script, scriptDropdownOpen: false, uploadError: null });
    }

    private _handleThemeCycle(): void {
        const currentIndex = THEMES.findIndex((t) => t.id === this.state.activeTheme.id);
        const nextTheme = THEMES[(currentIndex + 1) % THEMES.length];
        applyTheme(nextTheme);
        persistTheme(nextTheme);
        this.setState({ activeTheme: nextTheme });
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
                this.setState({ activeScript: customScript, scriptDropdownOpen: false, uploadError: null });
            } catch {
                this.setState({ uploadError: "Could not parse JSON file." });
            }
        };
        reader.readAsText(file);

        // reset so re-uploading the same file still triggers onChange
        e.target.value = "";
    }

    public render(): ReactElement {
        const { activeScript, activeTheme, scriptDropdownOpen, uploadError } = this.state;

        return (
            <>
                <header className="phosphor-header">
                    <span className="phosphor-header__title">PHOSPHOR</span>

                    <div className="phosphor-header__controls">
                        {uploadError && (
                            <span style={{ color: "rgb(255,60,0)", fontSize: "inherit" }}>
                                {uploadError}
                            </span>
                        )}

                        <div className="phosphor-header__script-wrapper">
                            <button
                                className="phosphor-header__btn"
                                onClick={this._handleDropdownToggle}
                                aria-haspopup="listbox"
                                aria-expanded={scriptDropdownOpen}
                            >
                                [ SCRIPT: {activeScript.label} {scriptDropdownOpen ? "▲" : "▼"} ]
                            </button>

                            {scriptDropdownOpen && (
                                <div className="phosphor-header__dropdown" role="listbox">
                                    {BUNDLED_SCRIPTS.map((script) => (
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
                                        &nbsp;&nbsp;[ UPLOAD JSON ]
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

                        <button
                            className="phosphor-header__btn"
                            onClick={this._handleThemeCycle}
                            title="Cycle color theme"
                        >
                            [ THEME: {activeTheme.name} → ]
                        </button>

                        <a
                            className="phosphor-header__btn"
                            href="https://github.com/EthanDunning/phosphor"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            [ GITHUB ]
                        </a>
                    </div>
                </header>

                <Phosphor
                    key={activeScript.id}
                    json={activeScript.json}
                />
            </>
        );
    }
}

export default App;
