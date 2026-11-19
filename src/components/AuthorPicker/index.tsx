import React, { FC, useState } from "react";
import { AuthorRef, findAccountById, MAX_CO_AUTHORS, normalizeAccountId } from "../../lib/authors";

import "./style.scss";

// Co-author tagging: chips for the people credited (× removes one) and a box
// to add someone by their FULL account id. There's deliberately no username
// search, so the site never reveals who has an account; people share their
// id from their own account menu.

export interface AuthorPickerProps {
    value: AuthorRef[];
    onChange: (next: AuthorRef[]) => void;
    excludeIds?: string[];     // e.g. the module owner (always credited first)
    disabled?: boolean;
    plainLabels?: boolean;     // "Add" instead of "[ADD]"
}

const AuthorPicker: FC<AuthorPickerProps> = ({ value, onChange, excludeIds = [], disabled = false, plainLabels = false }) => {
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const full = value.length >= MAX_CO_AUTHORS;

    const add = async () => {
        const id = normalizeAccountId(draft);
        if (!id) {
            setError("Paste their full account ID (it looks like 7c1b0e4a-1111-4222-8333-944455556666).");
            return;
        }
        if (excludeIds.includes(id)) {
            setError("The uploader is already credited.");
            return;
        }
        if (value.some((author) => author.id === id)) {
            setError("They're already on the list.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const account = await findAccountById(id);
            if (!account) {
                setError("No account with that ID.");
                return;
            }
            onChange([...value, account]);
            setDraft("");
        } catch (lookupError: any) {
            setError(lookupError?.message || "Couldn't look that ID up.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="author-picker">
            {value.length > 0 && (
                <div className="author-picker__chips">
                    {value.map((author) => (
                        <span key={author.id} className="author-picker__chip">
                            {author.username}
                            <button
                                type="button"
                                className="author-picker__remove"
                                aria-label={`Remove ${author.username}`}
                                title={`Remove ${author.username}`}
                                disabled={disabled}
                                onClick={() => onChange(value.filter((entry) => entry.id !== author.id))}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className="author-picker__row">
                <input
                    className="author-picker__input"
                    value={draft}
                    disabled={disabled || full || busy}
                    placeholder={full ? `Up to ${MAX_CO_AUTHORS} co-authors` : "Paste a co-author's account ID"}
                    aria-label="Co-author account ID"
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
                            void add();
                        }
                    }}
                />
                <button
                    type="button"
                    className="author-picker__add"
                    disabled={disabled || full || busy || !draft.trim().length}
                    onClick={() => void add()}
                >
                    {busy ? (plainLabels ? "Adding..." : "[...]") : (plainLabels ? "Add" : "[ADD]")}
                </button>
            </div>
            {error && <div className="author-picker__error" role="alert">{error}</div>}
        </div>
    );
};

export default AuthorPicker;
