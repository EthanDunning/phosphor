import React, { FC, useEffect, useId, useRef, useState } from "react";
import { keepUsername, updateUsername, USERNAME_MAX_LENGTH, validateUsername } from "../../lib/authors";

import "./style.scss";

// Shown once after signing in while the account hasn't chosen a username yet
// (profiles.username_confirmed = false): pick one, or keep the generated one.
// Esc closes it for now; it asks again next visit.

export interface UsernamePromptProps {
    userId: string;
    defaultUsername: string;
    variant?: "terminal" | "web";
    onDone: (username: string | null) => void;   // null = closed without choosing
}

const UsernamePrompt: FC<UsernamePromptProps> = ({ userId, defaultUsername, variant = "terminal", onDone }) => {
    const [draft, setDraft] = useState(defaultUsername);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const titleId = useId();
    const web = variant === "web";
    const label = (text: string) => (web ? text : `[${text.toUpperCase()}]`);
    const changed = draft.trim() !== defaultUsername;

    useEffect(() => {
        window.setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 0);
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !busy) {
                event.preventDefault();
                onDone(null);
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [busy, onDone]);

    const keep = async () => {
        setBusy(true);
        setError(null);
        try {
            await keepUsername(userId);
            onDone(defaultUsername);
        } catch (keepError: any) {
            setError(keepError?.message || "Couldn't save that. Please try again.");
            setBusy(false);
        }
    };

    const save = async () => {
        if (!changed) {
            void keep();
            return;
        }
        const problem = validateUsername(draft);
        if (problem) {
            setError(problem);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const saved = await updateUsername(userId, draft);
            onDone(saved);
        } catch (saveError: any) {
            setError(saveError?.message || "Couldn't save your username.");
            setBusy(false);
        }
    };

    return (
        <div className={`username-prompt username-prompt--${variant}`}>
            <div className="username-prompt__box" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <h2 id={titleId} className="username-prompt__title">{web ? "Choose your username" : "[ CHOOSE YOUR USERNAME ]"}</h2>
                <p className="username-prompt__text">
                    This is the name shown as the author of modules you publish. We picked one at random;
                    keep it or choose your own. You can change it any time from your account menu.
                </p>

                <label className="username-prompt__field">
                    <span className="username-prompt__label">{web ? "Username" : "USERNAME"}</span>
                    <input
                        ref={inputRef}
                        className="username-prompt__input"
                        value={draft}
                        maxLength={USERNAME_MAX_LENGTH}
                        disabled={busy}
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
                            } else if (event.key === "Escape" && !busy) {
                                event.preventDefault();
                                onDone(null);
                            }
                        }}
                    />
                </label>
                <p className="username-prompt__hint">
                    2-32 characters: letters, numbers, spaces, _ . - (an optional @ at the start). Must be unique.
                </p>
                {error && <p className="username-prompt__error" role="alert">{error}</p>}

                <div className="username-prompt__actions">
                    <button type="button" className="username-prompt__btn" disabled={busy} onClick={() => void keep()}>
                        {web ? `Keep ${defaultUsername}` : `[KEEP ${defaultUsername}]`}
                    </button>
                    <button
                        type="button"
                        className="username-prompt__btn username-prompt__btn--primary"
                        disabled={busy || !changed || !draft.trim().length}
                        onClick={() => void save()}
                    >
                        {busy ? label("Saving...") : label("Save username")}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UsernamePrompt;
