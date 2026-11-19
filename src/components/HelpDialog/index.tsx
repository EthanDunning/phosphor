import React, { FC, useEffect, useId, useRef } from "react";

import "../ModulesPanel/style.scss";
import "../FeedbackDialog/style.scss";
import "./style.scss";

// SUPPORT > [HELP]: every keyboard shortcut Phosphor listens for, in one window.

interface ShortcutGroup {
    title: string;
    rows: Array<[string, string]>;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        title: "Anywhere",
        rows: [
            ["Shift + H", "Show / hide the header"],
        ],
    },
    {
        title: "Terminal",
        rows: [
            ["Shift + Space", "Skip the typing animation on the current screen"],
            ["Ctrl + Shift + L", "Bypass a login (submits its first credential)"],
            ["Shift + click", "Alternate action on a link, toggle or list, where the module defines one"],
            ["Press and hold", "Same as Shift + click, on touch screens"],
        ],
    },
    {
        title: "Prompts and logins",
        rows: [
            ["Letters / numbers", "Type"],
            ["Backspace", "Delete the last character"],
            ["Enter", "Submit the command (or the username, then the password)"],
            ["Tap the prompt", "Open the phone keyboard (tap elsewhere to close it)"],
        ],
    },
    {
        title: "Dialogs",
        rows: [
            ["Esc", "Close the dialog"],
            ["Enter", "Close the dialog (when it has no buttons)"],
        ],
    },
    {
        title: "File-system screens",
        rows: [
            ["Up / Down", "Move within the focused list"],
            ["Left / Right", "Switch between the folder list and the file list"],
            ["Enter", "Open a folder's files, or activate a button"],
            ["Home / End", "Jump to the first / last entry"],
            ["Backspace / Esc", "Return from the file list to the folder list"],
        ],
    },
    {
        title: "Data tables",
        rows: [
            ["Up / Down", "Move the row cursor"],
            ["Enter", "Open the selected row"],
            ["1 – 9", "Sort by that column (again to reverse)"],
            ["/", "Search (or click / tap the QUERY line)"],
            ["Esc", "Clear the search"],
            ["Left / Right", "Previous / next page (PgUp / PgDn too)"],
        ],
    },
    {
        title: "Module Creator text fields",
        rows: [
            ["Ctrl + B", "**Bold**"],
            ["Ctrl + I", "*Italic*"],
            ["Ctrl + U", "__Underline__"],
            ["Ctrl + Shift + X", "~~Strikethrough~~"],
        ],
    },
    {
        title: "Feedback",
        rows: [
            ["Ctrl + Enter", "Send the message"],
        ],
    },
];

export interface HelpDialogProps {
    open: boolean;
    onClose: () => void;
}

const HelpDialog: FC<HelpDialogProps> = ({ open, onClose }) => {
    const titleId = useId();
    const closeRef = useRef<HTMLButtonElement>(null);

    // Esc closes; capture phase so the terminal underneath doesn't also react
    useEffect(() => {
        if (!open) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };
        document.addEventListener("keydown", handleKeyDown, true);
        closeRef.current?.focus();
        return () => document.removeEventListener("keydown", handleKeyDown, true);
    }, [open, onClose]);

    if (!open) {
        return null;
    }

    return (
        <div
            className="modules-panel feedback-dialog help-dialog"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div className="feedback-dialog__box help-dialog__box" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <div className="modules-panel__header">
                    <h2 id={titleId}>Keyboard Shortcuts</h2>
                </div>
                <div className="help-dialog__body">
                    <p className="help-dialog__note">
                        Shortcuts are ignored while you're typing in a prompt, login or text field.
                    </p>
                    {SHORTCUT_GROUPS.map((group) => (
                        <section key={group.title} className="help-dialog__group">
                            <h3>{group.title}</h3>
                            <dl>
                                {group.rows.map(([keys, action]) => (
                                    <div key={keys + action} className="help-dialog__row">
                                        <dt>{keys}</dt>
                                        <dd>{action}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>
                <div className="feedback-dialog__actions">
                    <button ref={closeRef} type="button" className="modules-panel__button" onClick={onClose}>[CLOSE]</button>
                </div>
            </div>
        </div>
    );
};

export default HelpDialog;
