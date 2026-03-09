import React, { Component, ReactElement } from "react";

// css
import "./style.scss";

// modules
import { nanoid } from "nanoid";

// components
import Teletype from "../Teletype";
import Link from "../Link";
import Text from "../Text";
import Bitmap from "../Bitmap";
import Prompt, { PROMPT_DEFAULT } from "../Prompt";
import Toggle from "../Toggle";
import List from "../List";
import ReportComposer from "../ReportComposer";

import Modal from "../Modal";
import Scanlines from "../Scanlines";

import transformerSfx from "../../assets/incr-ss-ark/transformer.wav";
import powerOnSfx from "../../assets/incr-ss-ark/sound effects/poweron.mp3";
import powerOffSfx from "../../assets/incr-ss-ark/sound effects/poweroff.mp3";
import charSingle01Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charsingle_01.wav";
import charSingle02Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charsingle_02.wav";
import charSingle03Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charsingle_03.wav";
import charSingle04Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charsingle_04.wav";
import charSingle05Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charsingle_05.wav";
import charSingle06Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charsingle_06.wav";
import charEnter01Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charenter_01.wav";
import charEnter02Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charenter_02.wav";
import charEnter03Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charenter_03.wav";
import charScrollSfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charscroll.wav";
import charScrollLoopSfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charscroll_lp.wav";
import {
    getTerminalScript,
    TerminalScript,
    TerminalScriptActionMeta,
    TerminalScriptApi,
} from "../../scripts/terminal";

interface AppState {
    screens: Screen[];
    dialogs: any[];
    activeScreenId: string;
    activeElementId: string; // which element, if any, is active
    activeDialogId: string; // which element, if any, is active
    loadingQueue: any[];
    status: AppStatus;

    renderScanlines: boolean; // should scanlines be enabled?
    skipTextAnimation: boolean; // skip teletype animation for the active screen
}

enum DialogType {
    Unknown = 0,
    Alert, // simple message box
    Confirm, // yes/no box; currently unsupported
    Dialog, // has arbitrary content; currently unsupported
}

interface Dialog {
    id: string;
    type: DialogType;

    [key: string]: any; // arbitrary members
}

enum ScreenType {
    Unknown = 0,
    Screen,
    Static,
}

enum ScreenDataType {
    Unknown = 0,
    Text,
    Link,
    Bitmap,
    Prompt,
    Toggle,
    List,
    ReportComposer,
    Href,
}

enum ScreenDataState {
    Unloaded = 0,
    Ready,
    Active,
    Done,
}

interface ScreenData {
    id: string;
    type: ScreenDataType;
    state: ScreenDataState;

    [key: string]: any; // arbitrary members
}

interface ScreenOnDone {
    target: string;
    delayMs?: number;
}

interface Screen {
    id: string;
    type: ScreenType;
    content: ScreenData[];
    onDone?: ScreenOnDone;
}

enum AppStatus {
    Unset = 0,
    Ready,
    Active,
    Done,
}

interface PersistedSession {
    activeScreenId: string;
    screenHistory: string[];
    updatedAt: number;
}

interface ShipLogEntry {
    id: string;
    createdAt: string;
    text: string;
}

interface UserReport {
    id: string;
    title: string;
    lines: string[];
    createdAt: string;
}

const USER_REPORT_SCREEN_PREFIX = "userReport:";

interface PhosphorProps {
    json: any;
}

class Phosphor extends Component<PhosphorProps, AppState> {
    private _containerRef: React.RefObject<HTMLElement>;
    private _lineheight: number = null;
    private _colwidth: number = null;
    private _ambientAudio: HTMLAudioElement = null;
    private _powerOnAudio: HTMLAudioElement = null;
    private _powerOffAudio: HTMLAudioElement = null;
    private _charSinglePool: HTMLAudioElement[] = [];
    private _charEnterPool: HTMLAudioElement[] = [];
    private _charScrollPool: HTMLAudioElement[] = [];
    private _screenHistory: string[] = [];
    private _audioUnlocked = false;
    private _charSingleLastPlayedAt = 0;
    private _scrollLastPlayedAt = 0;
    private _charSingleCooldownMs = 40;
    private _scrollCooldownMs = 120;
    private _screenDoneTimerId: number = null;
    private _script: TerminalScript = null;
    private _scriptState: Record<string, any> = {};
    private _shipLogs: ShipLogEntry[] = [];
    private _userReports: UserReport[] = [];
    private _sessionStorageKey: string;
    private _shipLogStorageKey: string;
    private _userReportStorageKey: string;

    constructor(props: PhosphorProps) {
        super(props);

        const slug = ((props.json?.config?.script || props.json?.config?.name || "default") as string)
            .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        this._sessionStorageKey    = `phosphor:session:${slug}:v1`;
        this._shipLogStorageKey    = `phosphor:ship-logs:${slug}:v1`;
        this._userReportStorageKey = `phosphor:user-reports:${slug}:v1`;

        this._containerRef = React.createRef<HTMLElement>();
        this._script = getTerminalScript(props.json?.config?.script);

        this.state = {
            screens: [],
            dialogs: [],
            activeScreenId: null,
            activeElementId: null,
            activeDialogId: null,
            loadingQueue: [],
            status: AppStatus.Unset,
            renderScanlines: true, // TODO: support option to disable this effect
            skipTextAnimation: false,
        };

        this._changeScreen = this._changeScreen.bind(this);
        this._setElementState = this._setElementState.bind(this);
        this._handlePromptCommand = this._handlePromptCommand.bind(this);
        this._handleTeletypeNewLine = this._handleTeletypeNewLine.bind(this);
        this._handleTeletypeCharDrawn = this._handleTeletypeCharDrawn.bind(this);
        this._handlePromptEnter = this._handlePromptEnter.bind(this);
        this._handleToggleClick = this._handleToggleClick.bind(this);
        this._handleLinkClick = this._handleLinkClick.bind(this);
        this._handleFirstInteraction = this._handleFirstInteraction.bind(this);
        this._handleGlobalKeyDown = this._handleGlobalKeyDown.bind(this);
        this._handleWheel = this._handleWheel.bind(this);
        this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    }

    public render(): ReactElement {
        const {
            activeScreenId,
            activeDialogId,
            renderScanlines,
        } = this.state;

        return (
            <div className="phosphor">
                <section className={"__main__"} ref={this._containerRef}>
                    {activeScreenId && this._renderScreen()}
                </section>

                {activeDialogId && this._renderDialog()}

                {/* scanlines should be the last child */}
                {renderScanlines && <Scanlines />}
            </div>

        );
    }

    // public react events
    public componentDidMount(): void {
        this._initializeAudio();
        document.addEventListener("click", this._handleFirstInteraction);
        document.addEventListener("keydown", this._handleFirstInteraction);
        document.addEventListener("keydown", this._handleGlobalKeyDown);
        document.addEventListener("visibilitychange", this._handleVisibilityChange);
        window.addEventListener("wheel", this._handleWheel, { passive: true });

        this._shipLogs = this._readShipLogs();
        this._userReports = this._readUserReports();

        if (this._script && this._script.onMount) {
            this._script.onMount(this._getScriptApi());
        }

        // parse the data & prep the screens
        this._parseScreens();
        this._parseDialogs();
    }

    public componentWillUnmount(): void {
        document.removeEventListener("click", this._handleFirstInteraction);
        document.removeEventListener("keydown", this._handleFirstInteraction);
        document.removeEventListener("keydown", this._handleGlobalKeyDown);
        document.removeEventListener("visibilitychange", this._handleVisibilityChange);
        window.removeEventListener("wheel", this._handleWheel);
        this._clearScreenDoneTimer();
        this._teardownAudio();
    }

    // private methods
    private _buildAudio(src: string, volume: number, loop = false): HTMLAudioElement {
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.volume = volume;
        audio.loop = loop;
        return audio;
    }

    private _buildFxPool(srcList: string[], volume: number, voices = 2): HTMLAudioElement[] {
        const pool: HTMLAudioElement[] = [];
        srcList.forEach((src) => {
            for (let i = 0; i < voices; i++) {
                pool.push(this._buildAudio(src, volume));
            }
        });
        return pool;
    }

    private _initializeAudio(): void {
        this._ambientAudio = this._buildAudio(transformerSfx, 0.1, true);
        this._powerOnAudio = this._buildAudio(powerOnSfx, 0.4);
        this._powerOffAudio = this._buildAudio(powerOffSfx, 0.4);
        this._charSinglePool = this._buildFxPool([
            charSingle01Sfx,
            charSingle02Sfx,
            charSingle03Sfx,
            charSingle04Sfx,
            charSingle05Sfx,
            charSingle06Sfx,
        ], 0.1, 2);
        this._charEnterPool = this._buildFxPool([
            charEnter01Sfx,
            charEnter02Sfx,
            charEnter03Sfx,
        ], 0.1, 2);
        this._charScrollPool = this._buildFxPool([
            charScrollSfx,
            charScrollLoopSfx,
        ], 0.1, 2);

        // Try autoplay on load; if blocked, first user interaction will unlock it.
        this._playPowerOn();
        this._playAmbient();
    }

    private _teardownAudio(): void {
        if (this._ambientAudio) {
            this._ambientAudio.pause();
            this._ambientAudio.currentTime = 0;
        }

        if (this._powerOnAudio) {
            this._powerOnAudio.pause();
            this._powerOnAudio.currentTime = 0;
        }

        if (this._powerOffAudio) {
            this._powerOffAudio.pause();
            this._powerOffAudio.currentTime = 0;
        }
    }

    private _playAudio(audio: HTMLAudioElement): void {
        if (!audio) {
            return;
        }

        audio.currentTime = 0;
        audio.play().then(() => {
            this._audioUnlocked = true;
        }).catch((): void => void 0);
    }

    private _playAudioFromPool(pool: HTMLAudioElement[]): void {
        if (!pool.length) {
            return;
        }

        const available = pool.find((item) => item.paused || item.ended);
        const audio = available || pool[Math.floor(Math.random() * pool.length)];
        this._playAudio(audio);
    }

    private _playAmbient(): void {
        if (!this._ambientAudio || document.hidden) {
            return;
        }

        this._ambientAudio.play().then(() => {
            this._audioUnlocked = true;
        }).catch((): void => void 0);
    }

    private _playPowerOn(): void {
        this._playAudio(this._powerOnAudio);
    }

    private _playPowerOff(): void {
        this._playAudio(this._powerOffAudio);
    }

    private _playCharEnter(): void {
        this._playAudioFromPool(this._charEnterPool);
    }

    private _playCharScroll(): void {
        const now = Date.now();
        if (now - this._scrollLastPlayedAt < this._scrollCooldownMs) {
            return;
        }

        this._scrollLastPlayedAt = now;
        this._playAudioFromPool(this._charScrollPool);
    }

    private _handleFirstInteraction(): void {
        if (this._audioUnlocked) {
            return;
        }

        this._playPowerOn();
        this._playAmbient();
    }

    private _handleGlobalKeyDown(e: KeyboardEvent): void {
        const isShiftSpace = e.shiftKey && (e.code === "Space" || e.key === " ");
        if (!isShiftSpace) {
            return;
        }

        if (e.repeat) {
            return;
        }

        e.preventDefault();

        if (this.state.status !== AppStatus.Active || this.state.skipTextAnimation) {
            return;
        }

        this.setState({
            skipTextAnimation: true,
        });
    }

    private _handleWheel(e: WheelEvent): void {
        if (!e.deltaY) {
            return;
        }

        this._playCharScroll();
    }

    private _handleVisibilityChange(): void {
        if (!this._ambientAudio) {
            return;
        }

        if (document.hidden) {
            this._ambientAudio.pause();
            return;
        }

        this._playAmbient();
    }

    private _handleTeletypeCharDrawn(char: string, index: number): void {
        void index;
        if (!char || !char.trim().length) {
            return;
        }

        const now = Date.now();
        if (now - this._charSingleLastPlayedAt < this._charSingleCooldownMs) {
            return;
        }

        this._charSingleLastPlayedAt = now;
        if (Math.random() < 0.55) {
            this._playAudioFromPool(this._charSinglePool);
        }
    }

    private _handlePromptEnter(): void {
        this._playCharEnter();
    }

    private _handleToggleClick(state?: any): void {
        this._playCharEnter();

        if (!state) {
            return;
        }

        if (this._script && this._script.onToggleState) {
            const handled = this._script.onToggleState(state, this._getScriptApi());
            if (handled) {
                return;
            }
        }

        if (state.action) {
            this._handleLinkAction(state.action, state.target, {
                source: "toggle",
                state,
            });
            return;
        }

        if (state.target) {
            this._changeScreen(state.target);
        }
    }

    private _parseScreens(): void {
        const screens = this.props.json.screens.map((element: any) => {
            return this._buildScreen(element);
        });

        if (!screens.length) {
            return;
        }

        this._hydrateShipLogEntries(screens);
        this._hydrateUserReportEntries(screens);
        this._upsertUserReportScreens(screens);

        this.setState({
            screens,
        }, () => {
            const previewStartScreenId = this.props.json?.config?.previewStartScreen;
            if (typeof previewStartScreenId === "string" && previewStartScreenId.length) {
                const previewIndex = screens.findIndex((screen) => screen.id === previewStartScreenId);
                if (previewIndex >= 0) {
                    this._setActiveScreen(previewIndex);
                    return;
                }
            }

            const persisted = this._readPersistedSession();
            if (persisted && persisted.activeScreenId) {
                this._restoreSessionScreen(persisted);
                return;
            }

            // todo: support config option to set starting screen
            this._setActiveScreen(0);
        });
    }

    private _parseDialogs(): void {
        const dialogs = (this.props.json.dialogs || []).map((element: any) => {
            return this._buildDialog(element);
        });

        if (!dialogs.length) {
            return;
        }

        this.setState({
            dialogs,
        });
    }

    private _buildDialog(src: any): Dialog {
        const id = src.id || null;
        const type = this._getDialogType(src.type);

        // TODO: support other dialog types
        let content: any [] = null;
        if (type === DialogType.Alert) {
            content = src.content;
        }

        return {
            id,
            type,
            content,
        };
    }

    private _getDialogType(type: string): DialogType {
        switch (type.toLowerCase()) {
            case "alert":
                return DialogType.Alert;

            case "confirm":
                return DialogType.Confirm;

            case "dialog":
                return DialogType.Dialog;

            default:
                return DialogType.Unknown;
        }
    }

    private _setActiveScreen(index: number): void {
        const { screens, } = this.state;
        const activeScreen = screens[index].id
        this.setState({
            activeScreenId: activeScreen,
        }, () => {
            this._activateScreen();
            this._notifyScriptScreenChanged(activeScreen);
        });
    }

    private _restoreSessionScreen(session: PersistedSession): void {
        const { screens } = this.state;
        const restoredScreen = screens.find((screen) => screen.id === session.activeScreenId);

        if (!restoredScreen) {
            this._setActiveScreen(0);
            return;
        }

        const validHistory = (session.screenHistory || []).filter((screenId) => {
            return screens.some((screen) => screen.id === screenId);
        });

        this._screenHistory = validHistory;
        restoredScreen.content.forEach((element) => {
            element.state = ScreenDataState.Done;
        });

        this.setState({
            activeScreenId: restoredScreen.id,
            activeElementId: null,
            status: AppStatus.Done,
            skipTextAnimation: false,
        }, () => {
            this._notifyScriptScreenChanged(restoredScreen.id);

            if (restoredScreen.onDone && restoredScreen.onDone.target) {
                this._handleScreenDone(restoredScreen.id);
                return;
            }

            this._persistSession();
        });
    }

    private _readPersistedSession(): PersistedSession | null {
        if (!this._isStorageAvailable()) {
            return null;
        }

        try {
            const raw = window.localStorage.getItem(this._sessionStorageKey);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw) as PersistedSession;
            if (!parsed || typeof parsed.activeScreenId !== "string") {
                return null;
            }

            return {
                activeScreenId: parsed.activeScreenId,
                screenHistory: Array.isArray(parsed.screenHistory) ? parsed.screenHistory : [],
                updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
            };
        } catch (e) {
            void e;
            return null;
        }
    }

    private _persistSession(): void {
        if (!this._isStorageAvailable()) {
            return;
        }

        try {
            const session: PersistedSession = {
                activeScreenId: this.state.activeScreenId || "",
                screenHistory: this._screenHistory,
                updatedAt: Date.now(),
            };

            window.localStorage.setItem(this._sessionStorageKey, JSON.stringify(session));
        } catch (e) {
            void e;
        }
    }

    private _isStorageAvailable(): boolean {
        try {
            return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
        } catch (e) {
            void e;
            return false;
        }
    }

    private _getScriptApi(): TerminalScriptApi {
        return {
            getActiveScreenId: () => this.state.activeScreenId,
            getScreenIds: () => this._getScreenIds(),
            hasVisitedScreen: (screenId: string) => this._hasVisitedScreen(screenId),
            changeScreen: (screenId: string) => this._changeScreen(screenId),
            toggleDialog: (dialogId?: string) => this._toggleDialog(dialogId),
            patchScreenElement: (screenId: string, scriptId: string, patch: Record<string, any>) => {
                return this._patchScreenElement(screenId, scriptId, patch);
            },
            ensureScreenElement: (screenId: string, scriptId: string, element: Record<string, any>) => {
                return this._ensureScreenElement(screenId, scriptId, element);
            },
            removeScreenElement: (screenId: string, scriptId: string) => {
                return this._removeScreenElement(screenId, scriptId);
            },
            getVar: (key: string) => this._scriptState[key],
            setVar: (key: string, value: any) => {
                this._scriptState[key] = value;
            },
            deleteVar: (key: string) => {
                delete this._scriptState[key];
            },
        } as TerminalScriptApi;
    }

    private _getScreenIds(): string[] {
        return this.state.screens.map((screen) => screen.id);
    }

    private _patchScreenElement(screenId: string, scriptId: string, patch: Record<string, any>): boolean {
        if (!screenId || !scriptId || !patch || typeof patch !== "object") {
            return false;
        }

        const screen = this._getScreen(screenId);
        if (!screen || !Array.isArray(screen.content)) {
            return false;
        }

        const element = screen.content.find((contentElement) => {
            return contentElement && contentElement.scriptId === scriptId;
        });
        if (!element) {
            return false;
        }

        Object.assign(element, patch);

        if (this.state.activeScreenId === screenId) {
            this.setState((prevState) => ({
                screens: [...prevState.screens],
            }));
        }

        return true;
    }

    private _ensureScreenElement(screenId: string, scriptId: string, element: Record<string, any>): boolean {
        if (!screenId || !scriptId || !element || typeof element !== "object") {
            return false;
        }

        const screen = this._getScreen(screenId);
        if (!screen || !Array.isArray(screen.content)) {
            return false;
        }

        const existing = screen.content.find((contentElement) => {
            return contentElement && contentElement.scriptId === scriptId;
        });
        if (existing) {
            return true;
        }

        const generated = this._generateScreenData({
            ...element,
            scriptId,
        });
        if (!generated) {
            return false;
        }

        screen.content.push(generated);

        if (this.state.activeScreenId === screenId) {
            this.setState((prevState) => ({
                screens: [...prevState.screens],
            }));
        }

        return true;
    }

    private _removeScreenElement(screenId: string, scriptId: string): boolean {
        if (!screenId || !scriptId) {
            return false;
        }

        const screen = this._getScreen(screenId);
        if (!screen || !Array.isArray(screen.content)) {
            return false;
        }

        const index = screen.content.findIndex((contentElement) => {
            return contentElement && contentElement.scriptId === scriptId;
        });
        if (index < 0) {
            return false;
        }

        screen.content.splice(index, 1);

        if (this.state.activeScreenId === screenId) {
            this.setState((prevState) => ({
                screens: [...prevState.screens],
            }));
        }

        return true;
    }

    private _notifyScriptScreenChanged(screenId: string): void {
        if (!this._script || !this._script.onScreenChanged) {
            return;
        }

        this._script.onScreenChanged(screenId, this._getScriptApi());
    }

    private _clearScreenDoneTimer(): void {
        if (this._screenDoneTimerId !== null) {
            window.clearTimeout(this._screenDoneTimerId);
            this._screenDoneTimerId = null;
        }
    }

    private _handleScreenDone(screenId: string): void {
        const screen = this._getScreen(screenId);
        if (!screen || !screen.onDone || !screen.onDone.target) {
            return;
        }

        const delayMsRaw = screen.onDone.delayMs;
        const delayMs = typeof delayMsRaw === "number" && Number.isFinite(delayMsRaw)
            ? Math.max(0, Math.floor(delayMsRaw))
            : 0;

        this._clearScreenDoneTimer();
        this._screenDoneTimerId = window.setTimeout(() => {
            this._screenDoneTimerId = null;
            if (this.state.activeScreenId !== screenId) {
                return;
            }

            this._changeScreen(screen.onDone.target);
        }, delayMs);
    }

    // we're off to the races!
    private _activateScreen(): void {
        const screen = this._getScreen(this.state.activeScreenId);

        // update the app status
        const status = AppStatus.Active;

        // depending on the screen type, we perform different actions here
        switch (screen.type) {
            case ScreenType.Static:
                this.setState({
                    status,
                }, () => this._persistSession());
                break;

            case ScreenType.Screen:
                screen.content[0].state = ScreenDataState.Active;

                this.setState({
                    status,
                    activeElementId: screen.content[0].id,
                }, () => this._persistSession());
                break;

            default: // do nothing
                break;
        }
    }

    private _buildScreen(src: any): Screen {
        // try to parse & build the screen
        const id = src.id || null;
        const type = this._getScreenType(src.type);
        const content = this._parseScreenContent(src.content).flat(); // flatten to one dimension
        const onDone = src.onDone
            && typeof src.onDone === "object"
            && typeof src.onDone.target === "string"
            ? {
                target: src.onDone.target,
                delayMs: typeof src.onDone.delayMs === "number"
                    ? Math.max(0, Math.floor(src.onDone.delayMs))
                    : undefined,
            } as ScreenOnDone
            : undefined;

        // if this screen is invalid for any reason, skip it
        if (!id || !type) {
            return;
        }

        return {
            id,
            type,
            content,
            onDone,
        };
    }

    private _getScreenType(type: string): ScreenType {
        switch (type.toLowerCase()) {
            case "screen":
                return ScreenType.Screen;

            case "static":
                return ScreenType.Static;

            default:
                return ScreenType.Unknown;
        }
    }

    private _renderScreen(): (ReactElement | null)[] | null {
        // get the active screen
        const screen = this._getScreen(this.state.activeScreenId);
        if (!screen) {
            return null;
        }

        // loop through the screen contents & render each element
        return screen.content.map((element, index) => {
            // wrap a div around the element based on its state

            // if it's ready, do nothing
            if (element.state === ScreenDataState.Ready) {
                return null;
            }

            // if it's active, render it animated
            if (element.state === ScreenDataState.Active) {
                return (
                    <div className="active" key={index}>
                        {this._renderActiveElement(element, index)}
                    </div>
                );
            }

            // if it's done, render it static
            if (element.state === ScreenDataState.Done) {
                return (
                    <div className="rendered" key={index}>
                        {this._renderStaticElement(element, index)}
                    </div>
                );
            }

            // unknown
            return null;
        });
    }

    private _getScreen(id: string): Screen {
        return this.state.screens.find(element => element.id === id);
    }

    private _hasVisitedScreen(screenId: string): boolean {
        if (!screenId) {
            return false;
        }

        if (this.state.activeScreenId === screenId) {
            return true;
        }

        return this._screenHistory.includes(screenId);
    }

    private _parseScreenContent(content: any[]): ScreenData[] {
        if (!content) {
            return [];
        }

        const parsed = content.map(element => this._parseScreenContentElement(element)).flat();
        return parsed.map(element => this._generateScreenData(element));
    }

    private _generateScreenData(element: any): ScreenData {
        // TODO: build the data object based on the element type
        // e.g. typeof element === "string" --> create a new ScreenData Text object
        const id = nanoid();

        // if an element has "load" property, its requires more work
        // to prepare so it's can't yet be considered "ready".
        const onLoad = element.onLoad || null;
        // if an element requires more loading, we'll shove its id in the queue
        if (onLoad) {
            const loadingQueue = [...this.state.loadingQueue];
            loadingQueue.push(element.id);
            this.setState({
                loadingQueue
            });
        }
        const state = onLoad ? ScreenDataState.Unloaded : ScreenDataState.Ready;

        // text-only elements can be added as strings in the JSON data; they don't need any object wrappers
        if (typeof element === "string") {
            return {
                id,
                type: ScreenDataType.Text,
                text: element,
                state,
                onLoad,
            }
        }

        // everything else requires a wrapper containing a "type" attribute, so we'll need to parse those here
        if (!element.type) {
            return;
        }

        switch (element.type.toLowerCase()) {
            case "text":
                return {
                    id,
                    type: ScreenDataType.Text,
                    scriptId: element.scriptId,
                    text: element.text,
                    className: element.className,
                    state,
                    speed: element.speed,
                    onLoad,
                }

            case "href":
            case "link":
                return {
                    id,
                    type: ScreenDataType.Link,
                    scriptId: element.scriptId,
                    target: element.target,
                    className: element.className,
                    text: element.text,
                    state,
                    speed: element.speed,
                    onLoad,
                };
            

            case "image":
            case "bitmap":
                const scale = typeof element.scale === "number"
                    ? element.scale
                    : (typeof element.size === "number" ? element.size : undefined);
                return {
                    id,
                    type: ScreenDataType.Bitmap,
                    scriptId: element.scriptId,
                    src: element.src,
                    alt: element.alt,
                    animated: !!element.animated,
                    scale,
                    fillWidth: !!element.fillWidth,
                    className: element.className,
                    state,
                    speed: element.speed,
                    onLoad,
                };

            case "prompt":
                return {
                    id,
                    type: ScreenDataType.Prompt,
                    scriptId: element.scriptId,
                    prompt: element.prompt || PROMPT_DEFAULT,
                    className: element.className,
                    commands: element.commands,
                    allowFreeInput: !!element.allowFreeInput,
                    inputAction: element.inputAction,
                    state,
                    speed: element.speed,
                    onLoad,
                };

            case "toggle":
                return {
                    id,
                    type: ScreenDataType.Toggle,
                    scriptId: element.scriptId,
                    states: element.states,
                    speed: element.speed,
                    state,
                };

            case "list":
                return {
                    id,
                    type: ScreenDataType.List,
                    scriptId: element.scriptId,
                    states: element.states,
                    speed: element.speed,
                    state,
                };

            case "reportcomposer":
                return {
                    id,
                    type: ScreenDataType.ReportComposer,
                    scriptId: element.scriptId,
                    template: element.template,
                    saveTarget: element.saveTarget,
                    cancelTarget: element.cancelTarget,
                    state,
                };

            default:
                return;
        }
    }

    private _getCyclerText(states: any[]): string {
        if (!states || !states.length) {
            return "";
        }

        const active = states.find((item: any) => item && item.active === true);
        const candidate = active || states[0];

        if (typeof candidate === "string") {
            return candidate;
        }

        return candidate && candidate.text ? candidate.text : "";
    }

    private _parseScreenContentElement(element: any): any {
        // if the element is a string, we'll want to
        // split it into chunks based on the new line character
        if (typeof element === "string") {
            return element.split("\n");
        }

        // object elements can be repeated with "loop": <count>
        if (element && typeof element === "object" && !Array.isArray(element)) {
            const loopCountRaw = element.loop;
            if (typeof loopCountRaw === "number" && Number.isFinite(loopCountRaw)) {
                const loopCount = Math.max(0, Math.floor(loopCountRaw));
                if (!loopCount) {
                    return [];
                }

                const { loop, ...template } = element;
                return Array.from({ length: loopCount }, () => {
                    return JSON.parse(JSON.stringify(template));
                });
            }
        }

        // otherwise, just return the element
        return element;
    }

    // based on the current active ScreenData, render the corresponding active element
    private _renderActiveElement(element: any, key: number): ReactElement | null {
        const type = element.type;

        // if the element is text-based, like text or Link, render instead a
        // teletype component
        if (type === ScreenDataType.Text || type === ScreenDataType.Link || type === ScreenDataType.Prompt
        ) {
            const text = type === ScreenDataType.Prompt ? element.prompt : element.text;
            const handleRendered = () => this._activateNextScreenData();
            return (
                <Teletype
                    key={key}
                    text={text}
                    onComplete={handleRendered}
                    onNewLine={this._handleTeletypeNewLine}
                    onCharDrawn={this._handleTeletypeCharDrawn}
                    autocomplete={this.state.skipTextAnimation}
                    className={element.className}
                    speed={element.speed}
                />
            );
        }

        // the toggle gets its text from the states array
        if (type === ScreenDataType.Toggle) {
            const text = this._getCyclerText(element.states);
            const handleRendered = () => this._activateNextScreenData();
            return (
                <Teletype
                    key={key}
                    text={text}
                    onComplete={handleRendered}
                    onNewLine={this._handleTeletypeNewLine}
                    onCharDrawn={this._handleTeletypeCharDrawn}
                    autocomplete={this.state.skipTextAnimation}
                    className={element.className}
                />
            );
        }

        if (type === ScreenDataType.List) {
            const text = this._getCyclerText(element.states);
            const handleRendered = () => this._activateNextScreenData();
            return (
                <Teletype
                    key={key}
                    text={text}
                    onComplete={handleRendered}
                    onNewLine={this._handleTeletypeNewLine}
                    onCharDrawn={this._handleTeletypeCharDrawn}
                    autocomplete={this.state.skipTextAnimation}
                    className={element.className}
                />
            );
        }

        if (type === ScreenDataType.Bitmap) {
            const handleRendered = () => this._activateNextScreenData();
            return (
                <Bitmap
                    key={key}
                    className={element.className}
                    src={element.src}
                    alt={element.alt}
                    animated={element.animated}
                    scale={element.scale}
                    fillWidth={element.fillWidth}
                    onComplete={handleRendered}
                />
            );
        }

        // otherwise, just activate the next element
        this._activateNextScreenData();
        return null;
    }

    // renders the final, interactive element to the screen
    private _renderStaticElement(element: any, key: number): ReactElement | null {
        const className = element.className || "";
        const handleRendered = () => {
            this._setElementState(element.id, ScreenDataState.Done);
        };

        if (element.type === ScreenDataType.Text) {
            // \0 is the ASCII null character to ensure empty lines aren't collapsed
            // https://en.wikipedia.org/wiki/Null_character
            const text = element.text.length ? element.text : "\0";
            return (
                <Text
                    key={key}
                    className={className}
                    text={text}
                    onRendered={handleRendered}
                />
            );
        }

        // link
        if (element.type === ScreenDataType.Link) {
            return (
                <Link
                    key={key}
                    text={element.text}
                    target={element.target}
                    className={className}
                    onClick={this._handleLinkClick}
                    onRendered={handleRendered}
                />
            );
        }

        // bitmap
        if (element.type === ScreenDataType.Bitmap) {
            const onComplete = () => {
                // this._activateNextScreenData();
                this._setElementState(element.id, ScreenDataState.Done);
            };
            return (
                <Bitmap
                    key={key}
                    className={className}
                    src={element.src}
                    alt={element.alt}
                    animated={element.animated}
                    scale={element.scale}
                    fillWidth={element.fillWidth}
                    onComplete={onComplete}
                    autocomplete={true}
                />
            );
        }

        // prompt
        if (element.type === ScreenDataType.Prompt) {
            return (
                <Prompt
                    key={key}
                    className={className}
                    disabled={!!this.state.activeDialogId}
                    prompt={element.prompt}
                    commands={element.commands}
                    allowFreeInput={element.allowFreeInput}
                    inputAction={element.inputAction}
                    onCommand={this._handlePromptCommand}
                    onEnter={this._handlePromptEnter}
                />
            );
        }

        // prompt
        if (element.type === ScreenDataType.Toggle) {
            return (
                <Toggle
                    key={key}
                    className={className}
                    states={element.states}
                    onClick={this._handleToggleClick}
                />
            );
        }

        if (element.type === ScreenDataType.List) {
            return (
                <List
                    key={key}
                    className={className}
                    states={element.states}
                    onClick={this._handleToggleClick}
                />
            );
        }

        if (element.type === ScreenDataType.ReportComposer) {
            const handleSave = (value: string) => {
                this._handleReportSave(value, element.saveTarget);
            };
            const handleCancel = () => {
                element.cancelTarget && this._changeScreen(element.cancelTarget);
            };

            return (
                <ReportComposer
                    key={key}
                    className={className}
                    template={element.template}
                    onSave={handleSave}
                    onCancel={handleCancel}
                />
            );
        }

        return null;
    }

    private _changeScreen(targetScreen: string): void {
        const currentScreenId = this.state.activeScreenId;
        const isSameScreen = targetScreen === currentScreenId;

        // ignore invalid transitions
        if (!targetScreen) {
            return;
        }

        this._clearScreenDoneTimer();

        const screen = this._getScreen(targetScreen);
        if (!screen || !screen.content || !screen.content.length) {
            return;
        }

        let isBackNavigation = false;
        if (currentScreenId && !isSameScreen) {
            const previousScreenId = this._screenHistory.length
                ? this._screenHistory[this._screenHistory.length - 1]
                : null;

            if (previousScreenId && previousScreenId === targetScreen) {
                isBackNavigation = true;
                this._screenHistory.pop();
            } else {
                this._screenHistory.push(currentScreenId);
            }
        }

        if (isBackNavigation) {
            this._playPowerOff();
        } else {
            this._playPowerOn();
        }

        // todo: handle missing screen
        // unload the current screen first
        if (currentScreenId) {
            this._unloadScreen();
        }

        // active the first element in the screen's content collection
        const activeElement = screen.content[0];
        activeElement.state = ScreenDataState.Active;

        this.setState({
            activeScreenId: targetScreen,
            activeElementId: activeElement.id,
            status: AppStatus.Active,
            skipTextAnimation: false,
        }, () => {
            this._persistSession();
            this._notifyScriptScreenChanged(targetScreen);
        });
    }

    private _setElementState(id: string, state: ScreenDataState): void {
        const screen = this._getScreen(this.state.activeScreenId);
        const content = screen.content.find(element => element.id === id);

        // only change the state if we need to
        if (content && (content.state !== state)) {
            content.state = state;
        }
;   }

    private _unloadScreen(): void {
        // go through the current screen elements, setting
        // their states to ScreenDataState.Ready
        const screen = this._getScreen(this.state.activeScreenId);
        screen.content.forEach(element => {
            element.state = ScreenDataState.Unloaded;
        });
    }

    private _getScreenDataById(id: string): any {
        const screen = this._getScreen(this.state.activeScreenId);
        return screen.content.find(element => element.id === id);
    }

    // find the currently active element and, if possible, activate it
    private _activateNextScreenData(): void {
        const screen = this._getScreen(this.state.activeScreenId);
        const activeIndex = screen.content.findIndex(element => element.state === ScreenDataState.Active);

        // nothing is active
        if (activeIndex === -1) {
            return;
        }

        // we're done with this element now
        screen.content[activeIndex].state = ScreenDataState.Done;

        // we're at the end of the array so there is no next
        if (activeIndex === screen.content.length - 1) {
            const completedScreenId = this.state.activeScreenId;
            // todo: indicate everything's done
            this.setState({
                activeElementId: null,
                status: AppStatus.Done,
            }, () => this._handleScreenDone(completedScreenId));

            return;
        }

        // otherwise, activate the next one
        screen.content[activeIndex + 1].state = ScreenDataState.Active;

        // todo: indicate everything's done
        this.setState({
            activeElementId: screen.content[activeIndex + 1].id,
        });
    }

    private _getActiveScreenData(): ScreenData {
        const screen = this._getScreen(this.state.activeScreenId);
        const activeIndex = screen.content.findIndex(element => element.state === ScreenDataState.Active);

        // is something active?
        if (activeIndex > -1) {
            return screen.content[activeIndex];
        }

        // otherwise set & return the first element
        const firstData = screen.content[0];

        // unless that element is already done or not yet loaded
        if (firstData.state === ScreenDataState.Done || firstData.state === ScreenDataState.Unloaded) {
            return null;
        }


        firstData.state = ScreenDataState.Active;
        return firstData;
    }

    private _setActiveScreenDataByIndex(index: number): void {
        const screen = this._getScreen(this.state.activeScreenId);
        screen.content[index].state = ScreenDataState.Active;
    }

    private _toggleDialog(dialogId?: string): void {
        // TODO: check if targetDialog is a valid dialog
        this.setState({
            activeDialogId: dialogId || null,
        }, () => this._persistSession());
    }

    private _readShipLogs(): ShipLogEntry[] {
        if (!this._isStorageAvailable()) {
            return [];
        }

        try {
            const raw = window.localStorage.getItem(this._shipLogStorageKey);
            if (!raw) {
                return [];
            }

            const parsed = JSON.parse(raw) as ShipLogEntry[];
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed.filter((entry) => {
                return entry
                    && typeof entry.id === "string"
                    && typeof entry.createdAt === "string"
                    && typeof entry.text === "string";
            });
        } catch (e) {
            void e;
            return [];
        }
    }

    private _persistShipLogs(): void {
        if (!this._isStorageAvailable()) {
            return;
        }

        try {
            window.localStorage.setItem(this._shipLogStorageKey, JSON.stringify(this._shipLogs));
        } catch (e) {
            void e;
        }
    }

    private _formatShipLogTimestamp(): string {
        const iso = new Date().toISOString();
        return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
    }

    private _buildShipLogLines(): string[] {
        if (!this._shipLogs.length) {
            return ["[NO USER LOG ENTRIES RECORDED]"];
        }

        const ordered = this._shipLogs.slice().reverse();
        return ordered.map((entry, index) => {
            const seq = String(this._shipLogs.length - index).padStart(3, "0");
            return `[USER LOG ${seq}] ${entry.createdAt} :: ${entry.text}`;
        });
    }

    private _hydrateShipLogEntries(screens: Screen[]): void {
        const screen = screens.find((element) => element.id === "shipLogEntries");
        if (!screen || !screen.content || !screen.content.length) {
            return;
        }

        const beginIndex = screen.content.findIndex((element) => {
            return element.type === ScreenDataType.Text && element.text === "--- BEGIN USER LOGS ---";
        });
        const endIndex = screen.content.findIndex((element) => {
            return element.type === ScreenDataType.Text && element.text === "--- END USER LOGS ---";
        });

        if (beginIndex < 0 || endIndex < 0 || beginIndex >= endIndex) {
            return;
        }

        const logLines = this._buildShipLogLines();
        const logContent = logLines.map((line) => this._generateScreenData(line));

        screen.content = [
            ...screen.content.slice(0, beginIndex + 1),
            ...logContent,
            ...screen.content.slice(endIndex),
        ];
    }

    private _appendShipLog(command: string, args?: any): void {
        const text = command.trim();
        if (!text.length) {
            return;
        }

        const entry: ShipLogEntry = {
            id: nanoid(),
            createdAt: this._formatShipLogTimestamp(),
            text,
        };

        this._shipLogs = [...this._shipLogs, entry];
        this._persistShipLogs();

        this.setState((prevState) => {
            const screens = [...prevState.screens];
            this._hydrateShipLogEntries(screens);
            return { screens };
        }, () => {
            if (args && args.target) {
                this._changeScreen(args.target);
            }
        });
    }

    private _readUserReports(): UserReport[] {
        if (!this._isStorageAvailable()) {
            return [];
        }

        try {
            const raw = window.localStorage.getItem(this._userReportStorageKey);
            if (!raw) {
                return [];
            }

            const parsed = JSON.parse(raw) as UserReport[];
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed.filter((report) => {
                return report
                    && typeof report.id === "string"
                    && typeof report.title === "string"
                    && Array.isArray(report.lines)
                    && typeof report.createdAt === "string";
            });
        } catch (e) {
            void e;
            return [];
        }
    }

    private _persistUserReports(): void {
        if (!this._isStorageAvailable()) {
            return;
        }

        try {
            window.localStorage.setItem(this._userReportStorageKey, JSON.stringify(this._userReports));
        } catch (e) {
            void e;
        }
    }

    private _resetPersistentState(onDone?: () => void): void {
        this._screenHistory = [];
        this._scriptState = {};
        this._shipLogs = [];
        this._userReports = [];

        if (this._isStorageAvailable()) {
            try {
                window.localStorage.removeItem(this._sessionStorageKey);
                window.localStorage.removeItem(this._shipLogStorageKey);
                window.localStorage.removeItem(this._userReportStorageKey);
            } catch (e) {
                void e;
            }
        }

        this.setState((prevState) => {
            const screens = [...prevState.screens];
            this._hydrateShipLogEntries(screens);
            this._hydrateUserReportEntries(screens);
            this._upsertUserReportScreens(screens);
            return { screens };
        }, () => {
            onDone && onDone();
        });
    }

    private _handleLinkAction(action: string, target?: string, meta?: TerminalScriptActionMeta): void {
        if (this._script && this._script.onAction) {
            const handled = this._script.onAction(action, target, meta || {
                source: "internal",
            }, this._getScriptApi());
            if (handled) {
                return;
            }
        }

        if (action === "resetState") {
            this._resetPersistentState(() => {
                target && this._changeScreen(target);
            });
            return;
        }

        if (action === "dialog") {
            target && this._toggleDialog(target);
            return;
        }

        target && this._changeScreen(target);
    }

    private _buildUserReportScreen(report: UserReport): Screen {
        const id = `${USER_REPORT_SCREEN_PREFIX}${report.id}`;
        const header = report.title || `USER REPORT ${report.id.slice(0, 6).toUpperCase()}`;
        const body = report.lines.length ? report.lines : ["[NO CONTENT]"];
        const contentRaw = [
            header,
            "============================================================",
            ...body,
            "",
            "======",
            "",
            {
                text: "< BACK",
                target: "comms",
                type: "link",
            },
        ];

        return {
            id,
            type: ScreenType.Screen,
            content: this._parseScreenContent(contentRaw),
        };
    }

    private _upsertUserReportScreens(screens: Screen[]): void {
        const retained = screens.filter((screen) => !screen.id.startsWith(USER_REPORT_SCREEN_PREFIX));
        const reportScreens = this._userReports.map((report) => this._buildUserReportScreen(report));
        screens.length = 0;
        screens.push(...retained, ...reportScreens);
    }

    private _hydrateUserReportEntries(screens: Screen[]): void {
        const comms = screens.find((screen) => screen.id === "comms");
        if (!comms || !comms.content || !comms.content.length) {
            return;
        }

        const composerIndex = comms.content.findIndex((element) => {
            return element.type === ScreenDataType.Link && element.target === "reportComposer";
        });
        const anchorIndex = comms.content.findIndex((element) => {
            return element.type === ScreenDataType.Link && element.target === "report7749c";
        });

        if (composerIndex < 0 || anchorIndex < 0 || composerIndex >= anchorIndex) {
            return;
        }

        const userLinks = this._userReports.slice().reverse().map((report) => {
            return this._generateScreenData({
                type: "link",
                text: `> ${report.title}`,
                target: `${USER_REPORT_SCREEN_PREFIX}${report.id}`,
            });
        });

        const isCorruptionMarker = (element: ScreenData): boolean => {
            return element.type === ScreenDataType.Text
                && (
                    element.text === "--- BEGIN USER REPORTS ---"
                    || element.text === "__USER_REPORTS__"
                    || element.text === "--- END USER REPORTS ---"
                    || element.text === "[NO USER REPORTS FILED]"
                );
        };

        const isUserReportLink = (element: ScreenData): boolean => {
            return element.type === ScreenDataType.Link
                && typeof element.target === "string"
                && element.target.startsWith(USER_REPORT_SCREEN_PREFIX);
        };

        const between = comms.content.slice(composerIndex + 1, anchorIndex);
        const staticReports = between.filter((element) => !isUserReportLink(element) && !isCorruptionMarker(element));

        while (staticReports.length
            && staticReports[0].type === ScreenDataType.Text
            && staticReports[0].text.trim().length === 0) {
            staticReports.shift();
        }

        while (staticReports.length
            && staticReports[staticReports.length - 1].type === ScreenDataType.Text
            && staticReports[staticReports.length - 1].text.trim().length === 0) {
            staticReports.pop();
        }

        comms.content = [
            ...comms.content.slice(0, composerIndex + 1),
            this._generateScreenData(""),
            ...userLinks,
            ...staticReports,
            ...comms.content.slice(anchorIndex),
        ];
    }

    private _handleReportSave(value: string, target?: string): void {
        const lines = value
            .split(/\r?\n/)
            .map((line) => line.replace(/\s+$/g, ""));

        while (lines.length && !lines[0].trim().length) {
            lines.shift();
        }
        while (lines.length && !lines[lines.length - 1].trim().length) {
            lines.pop();
        }

        if (!lines.length) {
            return;
        }

        const title = lines[0].trim().length
            ? lines[0].trim()
            : `USER REPORT ${String(this._userReports.length + 1).padStart(3, "0")}`;

        const report: UserReport = {
            id: nanoid(),
            title,
            lines,
            createdAt: this._formatShipLogTimestamp(),
        };

        this._userReports = [...this._userReports, report];
        this._persistUserReports();

        this.setState((prevState) => {
            const screens = [...prevState.screens];
            this._hydrateUserReportEntries(screens);
            this._upsertUserReportScreens(screens);
            return { screens };
        }, () => {
            this._changeScreen(target || "comms");
        });
    }

    private _handlePromptCommand(command: string, args?: any) {
        if (this._script && this._script.onPromptCommand) {
            const handled = this._script.onPromptCommand(command, args, this._getScriptApi());
            if (handled) {
                return;
            }
        }

        // handle the various commands
        if (!args || !args.type) {
            // display an error message
            return;
        }

        switch (args.type) {
            case "link":
                // fire the change screen event
                args.target && this._changeScreen(args.target);
                break;

            case "dialog":
                args.target && this._toggleDialog(args.target);
                break;

            case "action":
                args.action && this._handleLinkAction(args.action, args.target, {
                    source: "prompt",
                    command,
                    args,
                });
                break;

            case "console":
                console.log(command, args);
                break;

            case "logEntry":
                this._appendShipLog(command, args);
                break;

            default:
                // throw an error message
                break;
        }
    }

    private _renderDialog(): ReactElement {
        const { activeDialogId, dialogs, } = this.state;

        if (!activeDialogId) {
            return null;
        }

        const dialog = dialogs.find(element => element.id === activeDialogId);
        if (!dialog) {
            return null;
        }

        const handleClose = () => this._toggleDialog();

        return (
            <Modal
                text={dialog.content}
                onClose={handleClose}
            />
        );
    }

    private _handleTeletypeNewLine(): void {
        // TODO: handle lineheight/scrolling
        // const ref = this._containerRef;
        this._playCharScroll();
        void 0;
        // console.log("scrolling!", ref);
        // const lineheight = this.props.measurements.lineHeight;
        // if (ref) {
        //     ref.current.scrollTop += lineheight;
        // }
    }

    private _handleLinkClick(target: string | any[], shiftKey: boolean): void {
        this._playCharEnter();

        // if it's a string, it's a screen
        if (typeof target === "string") {
            this._changeScreen(target);
            return;
        }

        // otherwise, it's a LinkTarget array.
        // Prefer an explicit shiftKey match, then fall back to entries without shiftKey.
        const linkTargets = target as any[];
        const linkTarget = linkTargets.find((element) => {
            return typeof element.shiftKey === "boolean" && element.shiftKey === shiftKey;
        }) || linkTargets.find((element) => typeof element.shiftKey !== "boolean") || null;
        if (linkTarget) {
            // perform the appropriate action based on type
            // TODO: type-check the object
            if (linkTarget.type === "dialog") {
                this._toggleDialog(linkTarget.target);
                return;
            }

            if (linkTarget.type === "link") {
                this._changeScreen(linkTarget.target);
                return;
            }

            if (linkTarget.type === "action") {
                this._handleLinkAction(linkTarget.action, linkTarget.target, {
                    source: "link",
                    linkTarget,
                    shiftKey,
                });
                return;
            }

            if (linkTarget.type === "href"){
                window.open(linkTarget.target)
                return;
            }
        }
    }
}

export default Phosphor;
