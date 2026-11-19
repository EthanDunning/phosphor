import React, { FC, useEffect, useRef, useState } from "react";
import { getUsername, updateUsername, USERNAME_MAX_LENGTH, validateUsername } from "../../lib/authors";

import "./style.scss";

// "USERNAME  AmberRelay4821  [EDIT]" row for the account dropdowns (terminal
// header and Library). The username is the public name shown as "By ..." on
// modules. Class names / labels come from the host so it matches each menu.

export interface UsernameEditorProps {
    userId: string;
    label: string;               // e.g. "[USERNAME]" or "USERNAME"
    idLabel: string;             // e.g. "[ACCOUNT ID]": shared to be tagged as a co-author
    rowClassName: string;
    keyClassName: string;
    valueClassName: string;
    plainLabels?: boolean;       // Edit/Save/Cancel instead of [EDIT]/[SAVE]/[CANCEL]
    onChanged?: (username: string) => void;
}

const UsernameEditor: FC<UsernameEditorProps> = ({
    userId,
    label,
    idLabel,
    rowClassName,
    keyClassName,
    valueClassName,
    plainLabels = false,
    onChanged,
}) => {
    const [username, setUsername] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const word = (text: string) => (plainLabels ? text.charAt(0) + text.slice(1).toLowerCase() : `[${text}]`);

    useEffect(() => {
        let cancelled = false;
        setLoaded(false);
        getUsername(userId)
            .then((name) => { if (!cancelled) setUsername(name); })
            .catch(() => { if (!cancelled) setUsername(null); })
            .finally(() => { if (!cancelled) setLoaded(true); });
        return () => { cancelled = true; };
    }, [userId]);

    useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [editing]);

    const startEditing = () => {
        setDraft(username || "");
        setError(null);
        setEditing(true);
    };

    const save = async () => {
        const name = draft.trim();
        if (name === username) {
            setEditing(false);
            return;
        }
        const problem = validateUsername(name);
        if (problem) {
            setError(problem);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const saved = await updateUsername(userId, name);
            setUsername(saved);
            setEditing(false);
            onChanged?.(saved);
        } catch (saveError: any) {
            setError(saveError?.message || "Couldn't save your username.");
        } finally {
            setBusy(false);
        }
    };

    // usernames aren't set up in the database yet: show nothing
    if (loaded && username === null && !editing) {
        return null;
    }

    const copyId = async () => {
        try {
            await navigator.clipboard.writeText(userId);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <>
        <div className={`${rowClassName} username-editor`}>
            <span className={keyClassName}>{label}</span>
            {!editing ? (
                <span className={`${valueClassName} username-editor__value`}>
                    <span className="username-editor__name">{loaded ? username : "..."}</span>
                    <button
                        type="button"
                        className="username-editor__btn"
                        disabled={!loaded}
                        title="Change the name shown as the author of your modules"
                        onClick={(event) => {
                            event.stopPropagation();
                            startEditing();
                        }}
                    >
                        {word("EDIT")}
                    </button>
                </span>
            ) : (
                <span className="username-editor__form" onClick={(event) => event.stopPropagation()}>
                    <input
                        ref={inputRef}
                        className="username-editor__input"
                        value={draft}
                        maxLength={USERNAME_MAX_LENGTH}
                        disabled={busy}
                        aria-label="New username"
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(event) => {
                            setDraft(event.target.value);
                            setError(null);
                        }}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter") {
                                event.preventDefault();
                                void save();
                            } else if (event.key === "Escape") {
                                event.preventDefault();
                                setEditing(false);
                            }
                        }}
                    />
                    <span className="username-editor__actions">
                        <button type="button" className="username-editor__btn" disabled={busy} onClick={() => void save()}>
                            {busy ? word("SAVING") : word("SAVE")}
                        </button>
                        <button type="button" className="username-editor__btn" disabled={busy} onClick={() => setEditing(false)}>
                            {word("CANCEL")}
                        </button>
                    </span>
                    {error && <span className="username-editor__error" role="alert">{error}</span>}
                    <span className="username-editor__hint">Shown as the author of your modules.</span>
                </span>
            )}
        </div>
        {loaded && username !== null && (
            <div className={`${rowClassName} username-editor`}>
                <span className={keyClassName}>{idLabel}</span>
                <span className={`${valueClassName} username-editor__value`}>
                    <span className="username-editor__id" title="Share this so others can credit you as a co-author">{userId}</span>
                    <button
                        type="button"
                        className="username-editor__btn"
                        title="Copy your account ID"
                        onClick={(event) => {
                            event.stopPropagation();
                            void copyId();
                        }}
                    >
                        {copied ? word("COPIED") : word("COPY")}
                    </button>
                </span>
            </div>
        )}
        </>
    );
};

export default UsernameEditor;
