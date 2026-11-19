import React, { FC, useEffect, useMemo, useState } from "react";
import CreatorSelect, { CreatorSelectOption } from "../CreatorSelect";
import AuthorPicker from "../AuthorPicker";
import { AuthorRef, fetchModuleCoAuthors, sameAuthors } from "../../lib/authors";
import { isModuleLinkShareable, MAX_MODULE_SUMMARY_LENGTH, MAX_MODULE_TITLE_LENGTH } from "../../lib/modules";
import type { ModuleRecord, ModuleVisibility } from "../../lib/modules";
import "./style.scss";

interface ModulesPanelProps {
    open: boolean;
    supabaseReady: boolean;
    busy: boolean;
    sessionUserId: string | null;
    currentScript: any;
    currentScriptLabel: string;
    activeModule: ModuleRecord | null;
    myModules: ModuleRecord[];
    ownScriptsVisibilityById: Record<string, boolean>;
    subscribedModules: ModuleRecord[];
    subscribedScriptsVisibilityById: Record<string, boolean>;
    errorMessage: string | null;
    noticeMessage: string | null;
    libraryUrl: string;
    onClose: () => void;
    onDismissError: () => void;
    onDismissNotice: () => void;
    onRefresh: () => void;
    onLoadModule: (module: ModuleRecord) => void;
    onLoadBundledScript: (entryId: string) => void;
    onCopyBundledLibraryLink: (entryId: string) => void;
    onToggleOwnScriptVisibility: (moduleId: string) => void;
    onSubscribeToModule: (module: ModuleRecord) => void;
    onUnsubscribeFromModule: (module: ModuleRecord) => void;
    onSaveModule: (payload: {
        title: string;
        summary: string;
        visibility: ModuleVisibility;
        coAuthors?: AuthorRef[];
    }) => Promise<boolean> | void;
    onCopyShareLink: (module: ModuleRecord) => void;
    onUpdateModuleDetails: (module: ModuleRecord, payload: {
        title: string;
        summary: string;
        coAuthors?: AuthorRef[];
    }) => Promise<boolean> | void;
    onSetModuleVisibility: (module: ModuleRecord, nextVisibility: ModuleVisibility) => Promise<boolean> | void;
    onDeleteModule: (module: ModuleRecord) => Promise<boolean> | void;
    onToggleSubscribedScriptVisibility: (moduleId: string) => void;
}

const toLocalTimestamp = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
};

const VISIBILITY_OPTIONS: CreatorSelectOption[] = [
    { value: "private", label: "Private" },
    { value: "unlisted", label: "Unlisted" },
    { value: "public", label: "Public" },
];
const BUNDLED_SUBSCRIBED_ENTRY_PREFIX = "bundled:";

const ModulesPanel: FC<ModulesPanelProps> = ({
    open,
    supabaseReady,
    busy,
    sessionUserId,
    currentScript,
    currentScriptLabel,
    activeModule,
    myModules,
    ownScriptsVisibilityById,
    subscribedModules,
    subscribedScriptsVisibilityById,
    errorMessage,
    noticeMessage,
    libraryUrl,
    onClose,
    onDismissError,
    onDismissNotice,
    onRefresh,
    onLoadModule,
    onLoadBundledScript,
    onCopyBundledLibraryLink,
    onToggleOwnScriptVisibility,
    onSubscribeToModule,
    onUnsubscribeFromModule,
    onSaveModule,
    onCopyShareLink,
    onUpdateModuleDetails,
    onSetModuleVisibility,
    onDeleteModule,
    onToggleSubscribedScriptVisibility,
}) => {
    const [title, setTitle] = useState<string>("");
    const [summary, setSummary] = useState<string>("");
    const [visibility, setVisibility] = useState<ModuleVisibility>("private");
    const [coAuthors, setCoAuthors] = useState<AuthorRef[]>([]);
    const [composerOpen, setComposerOpen] = useState<boolean>(false);
    const [manageOpenModuleId, setManageOpenModuleId] = useState<string | null>(null);
    const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState<string>("");
    const [editSummary, setEditSummary] = useState<string>("");
    const [editCoAuthors, setEditCoAuthors] = useState<AuthorRef[]>([]);
    const [editCoAuthorsLoaded, setEditCoAuthorsLoaded] = useState<boolean>(false);
    const [editCoAuthorsOriginal, setEditCoAuthorsOriginal] = useState<AuthorRef[]>([]);
    const [coAuthorsOriginal, setCoAuthorsOriginal] = useState<AuthorRef[]>([]);
    const [coAuthorsLoaded, setCoAuthorsLoaded] = useState<boolean>(true);

    const currentScriptName = useMemo(() => {
        const configName = currentScript?.config?.name;
        if (typeof configName === "string" && configName.trim().length) {
            return configName.trim();
        }
        return currentScriptLabel || "Untitled script";
    }, [currentScript, currentScriptLabel]);

    const activeModuleIsOwned = !!activeModule && !!sessionUserId && activeModule.owner_id === sessionUserId;
    const activeModuleIsSubscribed = !!activeModule && subscribedModules.some((module) => module.id === activeModule.id);
    const getLibraryModuleUrl = (moduleId: string): string => {
        try {
            const url = new URL(libraryUrl);
            url.searchParams.set("module", moduleId);
            return url.toString();
        } catch {
            const joiner = libraryUrl.includes("?") ? "&" : "?";
            return `${libraryUrl}${joiner}module=${encodeURIComponent(moduleId)}`;
        }
    };
    const getBundledLibrarySearchUrl = (scriptLabel: string): string => {
        try {
            const url = new URL(libraryUrl);
            url.searchParams.set("q", scriptLabel);
            return url.toString();
        } catch {
            const joiner = libraryUrl.includes("?") ? "&" : "?";
            return `${libraryUrl}${joiner}q=${encodeURIComponent(scriptLabel)}`;
        }
    };
    const visibleSubscribedCount = useMemo(() => {
        return subscribedModules.reduce((count, module) => {
            return count + (subscribedScriptsVisibilityById[module.id] === false ? 0 : 1);
        }, 0);
    }, [subscribedModules, subscribedScriptsVisibilityById]);
    const visibleOwnCount = useMemo(() => {
        return myModules.reduce((count, module) => {
            return count + (ownScriptsVisibilityById[module.id] === false ? 0 : 1);
        }, 0);
    }, [myModules, ownScriptsVisibilityById]);

    useEffect(() => {
        if (activeModule) {
            setTitle(activeModule.title);
            setSummary(activeModule.summary || "");
            setVisibility(activeModule.visibility);
            return;
        }

        setTitle(currentScriptName);
        setSummary("");
        setVisibility("private");
    }, [activeModule, currentScriptName]);

    useEffect(() => {
        if (!open) {
            setComposerOpen(false);
            setManageOpenModuleId(null);
            setEditingModuleId(null);
            setEditTitle("");
            setEditSummary("");
            return;
        }

        if (activeModuleIsOwned) {
            setComposerOpen(true);
        }
    }, [activeModuleIsOwned, open]);

    useEffect(() => {
        if (!open || !activeModuleIsOwned || !activeModule) {
            setCoAuthors([]);
            setCoAuthorsOriginal([]);
            setCoAuthorsLoaded(true);
            return;
        }
        let cancelled = false;
        setCoAuthorsLoaded(false);
        fetchModuleCoAuthors(activeModule.id)
            .then((authors) => {
                if (!cancelled) {
                    setCoAuthors(authors);
                    setCoAuthorsOriginal(authors);
                    setCoAuthorsLoaded(true);
                }
            })
            .catch(() => { if (!cancelled) setCoAuthorsLoaded(false); });
        return () => { cancelled = true; };
    }, [open, activeModuleIsOwned, activeModule?.id]);

    useEffect(() => {
        if (!manageOpenModuleId) {
            return;
        }

        const moduleStillVisible = myModules.some((module) => module.id === manageOpenModuleId);
        if (!moduleStillVisible) {
            setManageOpenModuleId(null);
        }
    }, [manageOpenModuleId, myModules]);

    useEffect(() => {
        if (!editingModuleId) {
            return;
        }

        const editingModule = myModules.find((module) => module.id === editingModuleId);
        if (!editingModule) {
            setEditingModuleId(null);
            setEditTitle("");
            setEditSummary("");
        }
    }, [editingModuleId, myModules]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, onClose]);

    useEffect(() => {
        if (!open || !manageOpenModuleId) {
            return;
        }

        const handleDocumentMouseDown = (event: MouseEvent) => {
            const target = event.target as Element | null;
            if (!target) {
                return;
            }

            if (!target.closest(".modules-panel__manage")) {
                setManageOpenModuleId(null);
            }
        };

        document.addEventListener("mousedown", handleDocumentMouseDown);
        return () => {
            document.removeEventListener("mousedown", handleDocumentMouseDown);
        };
    }, [open, manageOpenModuleId]);

    const handleStartEdit = (module: ModuleRecord): void => {
        setManageOpenModuleId(null);
        setEditingModuleId(module.id);
        setEditTitle(module.title);
        setEditSummary(module.summary || "");
        setEditCoAuthors([]);
        setEditCoAuthorsLoaded(false);
        setEditCoAuthorsOriginal([]);
        fetchModuleCoAuthors(module.id)
            .then((authors) => {
                setEditCoAuthors(authors);
                setEditCoAuthorsOriginal(authors);
                setEditCoAuthorsLoaded(true);
            })
            // couldn't read them: leave co-authors alone on save
            .catch(() => setEditCoAuthorsLoaded(false));
    };

    const handleCancelEdit = (): void => {
        setEditingModuleId(null);
        setEditTitle("");
        setEditSummary("");
    };

    const handleSaveEdit = async (module: ModuleRecord): Promise<void> => {
        const nextTitle = editTitle.trim();
        if (!nextTitle.length) {
            return;
        }

        const updated = await Promise.resolve(onUpdateModuleDetails(module, {
            title: nextTitle,
            summary: editSummary.trim(),
            coAuthors: editCoAuthorsLoaded && !sameAuthors(editCoAuthors, editCoAuthorsOriginal) ? editCoAuthors : undefined,
        }));
        if (updated === false) {
            return;
        }

        setEditingModuleId(null);
        setEditTitle("");
        setEditSummary("");
    };

    const handleSetVisibility = async (
        module: ModuleRecord,
        nextVisibility: ModuleVisibility
    ): Promise<void> => {
        setManageOpenModuleId(null);
        await Promise.resolve(onSetModuleVisibility(module, nextVisibility));
    };

    const handleDeleteModule = async (module: ModuleRecord): Promise<void> => {
        setManageOpenModuleId(null);
        const deleted = await Promise.resolve(onDeleteModule(module));
        if (deleted !== false && editingModuleId === module.id) {
            setEditingModuleId(null);
            setEditTitle("");
            setEditSummary("");
        }
    };

    if (!open) {
        return null;
    }

    return (
        <section className="modules-panel" onClick={onClose}>
            <div
                className="modules-panel__dialog"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="modules-panel__header">
                    <div>
                        <h2>My Modules</h2>
                        <p>Manage your modules and subscribed modules, then control what shows in the script dropdown.</p>
                    </div>
                    <div className="modules-panel__header-actions">
                        {!!sessionUserId && (
                            <button
                                className="modules-panel__button modules-panel__button--ghost"
                                onClick={onRefresh}
                                disabled={busy}
                            >
                                Refresh
                            </button>
                        )}
                        <button
                            className="modules-panel__button"
                            onClick={() => setComposerOpen((prev) => !prev)}
                            disabled={!sessionUserId || busy}
                        >
                            {composerOpen ? "Hide Add Module" : "Add New Module"}
                        </button>
                        <a className="modules-panel__button modules-panel__button--ghost" href={libraryUrl}>
                            Library
                        </a>
                        <button className="modules-panel__button modules-panel__button--ghost" onClick={onClose}>
                            Close
                        </button>
                    </div>
                </div>

                {!supabaseReady && (
                    <div className="modules-panel__notice modules-panel__notice--error">
                        Supabase is not configured in this environment. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` locally.
                    </div>
                )}

                {errorMessage && (
                    <div className="modules-panel__notice modules-panel__notice--error">
                        <span>{errorMessage}</span>
                        <button
                            type="button"
                            className="modules-panel__notice-dismiss"
                            onClick={onDismissError}
                            aria-label="Dismiss error message"
                            title="Dismiss"
                        >
                            X
                        </button>
                    </div>
                )}

                {noticeMessage && (
                    <div className="modules-panel__notice modules-panel__notice--success">
                        <span>{noticeMessage}</span>
                        <button
                            type="button"
                            className="modules-panel__notice-dismiss"
                            onClick={onDismissNotice}
                            aria-label="Dismiss notice"
                            title="Dismiss"
                        >
                            X
                        </button>
                    </div>
                )}

                <div className="modules-panel__body">
                    <div className="modules-panel__grid">
                        <section className="modules-panel__section">
                            <h3>Current Script</h3>
                            <p><strong>{currentScriptName}</strong></p>

                            {activeModule && (
                                <p>
                                    Active module: <strong>{activeModule.title}</strong>{" "}
                                    <span className="modules-panel__muted">
                                        ({activeModule.visibility})
                                    </span>
                                </p>
                            )}

                            {!activeModule && (
                                <p className="modules-panel__muted">
                                    This script is local right now. Saving will create a new module.
                                </p>
                            )}

                            {activeModule && !activeModuleIsOwned && (
                                <p className="modules-panel__muted">
                                    This module is not yours. Saving will create a copy in your account.
                                </p>
                            )}

                            {!!activeModule && !activeModuleIsOwned && (
                                <div className="modules-panel__actions">
                                    <button
                                        className="modules-panel__button"
                                        onClick={() => onSubscribeToModule(activeModule)}
                                        disabled={!sessionUserId || busy || activeModuleIsSubscribed}
                                    >
                                        {activeModuleIsSubscribed ? "Subscribed" : "Subscribe"}
                                    </button>
                                </div>
                            )}
                        </section>

                        {composerOpen && (
                            <section className="modules-panel__section modules-panel__section--wide">
                                <h3>{activeModuleIsOwned ? "Update Active Module" : "Create Module"}</h3>

                                <label className="modules-panel__field">
                                    <span>Title</span>
                                    <input
                                        value={title}
                                        onChange={(event) => setTitle(event.target.value)}
                                        maxLength={MAX_MODULE_TITLE_LENGTH}
                                        placeholder="Module title"
                                    />
                                </label>

                                <label className="modules-panel__field">
                                    <span>Summary</span>
                                    <textarea
                                        value={summary}
                                        onChange={(event) => setSummary(event.target.value)}
                                        maxLength={MAX_MODULE_SUMMARY_LENGTH}
                                        rows={3}
                                        placeholder="Short summary for the module listing"
                                    />
                                </label>

                                <label className="modules-panel__field">
                                    <span>Visibility</span>
                                    <CreatorSelect
                                        value={visibility}
                                        options={VISIBILITY_OPTIONS}
                                        onChange={(nextValue) => setVisibility(nextValue as ModuleVisibility)}
                                        fallbackLabel={visibility}
                                    />
                                </label>

                                <div className="modules-panel__field">
                                    <span>Co-authors</span>
                                    <AuthorPicker
                                        value={coAuthors}
                                        onChange={setCoAuthors}
                                        excludeIds={sessionUserId ? [sessionUserId] : []}
                                        disabled={!sessionUserId || busy || !supabaseReady || !coAuthorsLoaded}
                                    />
                                    <small className="modules-panel__muted">
                                        Credit other creators by their account ID (they can copy it from their account menu). You're always credited first.
                                    </small>
                                </div>

                                <div className="modules-panel__actions">
                                    <button
                                        className="modules-panel__button"
                                        disabled={!sessionUserId || busy || !supabaseReady || !title.trim().length}
                                        onClick={() => void onSaveModule({
                                            title: title.trim(),
                                            summary: summary.trim(),
                                            visibility,
                                            coAuthors: coAuthorsLoaded && !sameAuthors(coAuthors, coAuthorsOriginal) ? coAuthors : undefined,
                                        })}
                                    >
                                        {activeModuleIsOwned ? "Save Changes" : "Create Module"}
                                    </button>

                                    {activeModule && isModuleLinkShareable(activeModule.visibility) && (
                                        <button
                                            className="modules-panel__button modules-panel__button--ghost"
                                            onClick={() => onCopyShareLink(activeModule)}
                                            disabled={busy}
                                        >
                                            Copy Share Link
                                        </button>
                                    )}
                                </div>
                            </section>
                        )}

                        <section className="modules-panel__section modules-panel__section--wide">
                            <h3>My Modules</h3>

                            {!sessionUserId && (
                                <p className="modules-panel__muted">Sign in to see your saved modules.</p>
                            )}

                            {!!sessionUserId && !myModules.length && (
                                <p className="modules-panel__muted">No modules saved yet.</p>
                            )}

                            {!!sessionUserId && !!myModules.length && (
                                <>
                                    <p className="modules-panel__muted">
                                        {visibleOwnCount} of {myModules.length} own modules are shown in the script dropdown.
                                    </p>
                                    <div className="modules-panel__list">
                                        {myModules.map((module) => {
                                            const isActive = activeModule?.id === module.id;
                                            const showInScripts = ownScriptsVisibilityById[module.id] !== false;
                                            const isManageOpen = manageOpenModuleId === module.id;
                                            const isEditing = editingModuleId === module.id;
                                            return (
                                                <article
                                                    key={module.id}
                                                    className={"modules-panel__list-item" + (isActive ? " modules-panel__list-item--active" : "")}
                                                >
                                                    <div className="modules-panel__list-main">
                                                        <strong>{module.title}</strong>
                                                        <span className="modules-panel__pill">{module.visibility}</span>
                                                        <span className="modules-panel__pill">
                                                            {showInScripts ? "Scripts: On" : "Scripts: Off"}
                                                        </span>
                                                        <p>{module.summary || "No summary provided."}</p>
                                                        <small className="modules-panel__muted">
                                                            Updated {toLocalTimestamp(module.updated_at)}
                                                        </small>

                                                        {isEditing && (
                                                            <div className="modules-panel__inline-editor">
                                                                <label className="modules-panel__field">
                                                                    <span>Title</span>
                                                                    <input
                                                                        value={editTitle}
                                                                        onChange={(event) => setEditTitle(event.target.value)}
                                                                        maxLength={MAX_MODULE_TITLE_LENGTH}
                                                                        placeholder="Module title"
                                                                    />
                                                                </label>

                                                                <label className="modules-panel__field">
                                                                    <span>Summary</span>
                                                                    <textarea
                                                                        value={editSummary}
                                                                        onChange={(event) => setEditSummary(event.target.value)}
                                                                        maxLength={MAX_MODULE_SUMMARY_LENGTH}
                                                                        rows={3}
                                                                        placeholder="Short summary for the module listing"
                                                                    />
                                                                </label>

                                                                <div className="modules-panel__field">
                                                                    <span>Co-authors</span>
                                                                    <AuthorPicker
                                                                        value={editCoAuthors}
                                                                        onChange={setEditCoAuthors}
                                                                        excludeIds={[module.owner_id]}
                                                                        disabled={busy || !editCoAuthorsLoaded}
                                                                    />
                                                                    {!editCoAuthorsLoaded && (
                                                                        <small className="modules-panel__muted">Loading co-authors...</small>
                                                                    )}
                                                                    <small className="modules-panel__muted">
                                                                        Credit other creators by their account ID (they can copy it from their account menu). You're always credited first.
                                                                    </small>
                                                                </div>

                                                                <div className="modules-panel__actions">
                                                                    <button
                                                                        className="modules-panel__button"
                                                                        disabled={busy || !editTitle.trim().length}
                                                                        onClick={() => void handleSaveEdit(module)}
                                                                    >
                                                                        Save Details
                                                                    </button>
                                                                    <button
                                                                        className="modules-panel__button modules-panel__button--ghost"
                                                                        disabled={busy}
                                                                        onClick={handleCancelEdit}
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="modules-panel__actions">
                                                        <button
                                                            className="modules-panel__button"
                                                            onClick={() => onLoadModule(module)}
                                                            disabled={busy}
                                                        >
                                                            Load
                                                        </button>
                                                        <a
                                                            className="modules-panel__button modules-panel__button--ghost"
                                                            href={getLibraryModuleUrl(module.id)}
                                                        >
                                                            View In Library
                                                        </a>
                                                        <label className="modules-panel__toggle">
                                                            <input
                                                                type="checkbox"
                                                                checked={showInScripts}
                                                                onChange={() => onToggleOwnScriptVisibility(module.id)}
                                                                disabled={busy}
                                                            />
                                                            <span>Show in SCRIPT</span>
                                                        </label>

                                                        {isModuleLinkShareable(module.visibility) && (
                                                            <button
                                                                className="modules-panel__button modules-panel__button--ghost"
                                                                onClick={() => onCopyShareLink(module)}
                                                                disabled={busy}
                                                            >
                                                                Copy Link
                                                            </button>
                                                        )}

                                                        <div className="modules-panel__manage">
                                                            <button
                                                                className="modules-panel__button modules-panel__button--ghost"
                                                                disabled={busy}
                                                                onClick={() => setManageOpenModuleId((prev) => prev === module.id ? null : module.id)}
                                                                aria-haspopup="menu"
                                                                aria-expanded={isManageOpen}
                                                            >
                                                                {isManageOpen ? "Manage ▲" : "Manage ▼"}
                                                            </button>

                                                            {isManageOpen && (
                                                                <div className="modules-panel__manage-menu" role="menu">
                                                                    <button
                                                                        className="modules-panel__manage-item"
                                                                        role="menuitem"
                                                                        disabled={busy}
                                                                        onClick={() => handleStartEdit(module)}
                                                                    >
                                                                        Edit Details
                                                                    </button>
                                                                    <button
                                                                        className="modules-panel__manage-item"
                                                                        role="menuitem"
                                                                        disabled={busy}
                                                                        onClick={() => void handleSetVisibility(module, "public")}
                                                                    >
                                                                        {module.visibility === "public" ? "Visibility: Public" : "Set Public"}
                                                                    </button>
                                                                    <button
                                                                        className="modules-panel__manage-item"
                                                                        role="menuitem"
                                                                        disabled={busy}
                                                                        onClick={() => void handleSetVisibility(module, "unlisted")}
                                                                    >
                                                                        {module.visibility === "unlisted" ? "Visibility: Unlisted" : "Set Unlisted"}
                                                                    </button>
                                                                    <button
                                                                        className="modules-panel__manage-item"
                                                                        role="menuitem"
                                                                        disabled={busy}
                                                                        onClick={() => void handleSetVisibility(module, "private")}
                                                                    >
                                                                        {module.visibility === "private" ? "Visibility: Private" : "Set Private"}
                                                                    </button>
                                                                    <button
                                                                        className="modules-panel__manage-item modules-panel__manage-item--danger"
                                                                        role="menuitem"
                                                                        disabled={busy}
                                                                        onClick={() => void handleDeleteModule(module)}
                                                                    >
                                                                        Delete Module
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </section>

                        <section className="modules-panel__section modules-panel__section--wide">
                            <h3>Subscribed Modules</h3>

                            {!sessionUserId && !subscribedModules.length && (
                                <p className="modules-panel__muted">Sign in to see your subscribed modules.</p>
                            )}

                            {!!sessionUserId && !subscribedModules.length && (
                                <p className="modules-panel__muted">No subscriptions yet.</p>
                            )}

                            {!!subscribedModules.length && (
                                <>
                                    <p className="modules-panel__muted">
                                        {visibleSubscribedCount} of {subscribedModules.length} subscribed modules are shown in the script dropdown.
                                    </p>
                                    <div className="modules-panel__list">
                                        {subscribedModules.map((module) => {
                                            const isActive = activeModule?.id === module.id;
                                            const showInScripts = subscribedScriptsVisibilityById[module.id] !== false;
                                            const isBundledEntry = module.id.startsWith(BUNDLED_SUBSCRIBED_ENTRY_PREFIX);
                                            return (
                                                <article
                                                    key={module.id}
                                                    className={"modules-panel__list-item" + (isActive ? " modules-panel__list-item--active" : "")}
                                                >
                                                    <div className="modules-panel__list-main">
                                                        <strong>{module.title}</strong>
                                                        <span className="modules-panel__pill">
                                                            {isBundledEntry ? "bundled" : module.visibility}
                                                        </span>
                                                        <span className="modules-panel__pill">
                                                            {showInScripts ? "Scripts: On" : "Scripts: Off"}
                                                        </span>
                                                        <p>{module.summary || "No summary provided."}</p>
                                                        <small className="modules-panel__muted">
                                                            {isBundledEntry
                                                                ? "Bundled script"
                                                                : `Updated ${toLocalTimestamp(module.updated_at)}`}
                                                        </small>
                                                    </div>

                                                    <div className="modules-panel__actions">
                                                        <button
                                                            className="modules-panel__button"
                                                            onClick={() => {
                                                                if (isBundledEntry) {
                                                                    onLoadBundledScript(module.id);
                                                                    return;
                                                                }

                                                                onLoadModule(module);
                                                            }}
                                                            disabled={busy}
                                                        >
                                                            Load
                                                        </button>
                                                        <a
                                                            className="modules-panel__button modules-panel__button--ghost"
                                                            href={isBundledEntry
                                                                ? getBundledLibrarySearchUrl(module.title)
                                                                : getLibraryModuleUrl(module.id)}
                                                        >
                                                            View In Library
                                                        </a>
                                                        <label className="modules-panel__toggle">
                                                            <input
                                                                type="checkbox"
                                                                checked={showInScripts}
                                                                onChange={() => onToggleSubscribedScriptVisibility(module.id)}
                                                                disabled={busy}
                                                            />
                                                            <span>Show in SCRIPT</span>
                                                        </label>
                                                        {!isBundledEntry && (
                                                            <button
                                                                className="modules-panel__button modules-panel__button--ghost"
                                                                onClick={() => onUnsubscribeFromModule(module)}
                                                                disabled={busy}
                                                            >
                                                                Unsubscribe
                                                            </button>
                                                        )}
                                                        {(isBundledEntry || isModuleLinkShareable(module.visibility)) && (
                                                            <button
                                                                className="modules-panel__button modules-panel__button--ghost"
                                                                onClick={() => {
                                                                    if (isBundledEntry) {
                                                                        onCopyBundledLibraryLink(module.id);
                                                                        return;
                                                                    }

                                                                    onCopyShareLink(module);
                                                                }}
                                                                disabled={busy}
                                                            >
                                                                Copy Link
                                                            </button>
                                                        )}
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </section>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ModulesPanel;
