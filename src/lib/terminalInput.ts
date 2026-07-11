// Global shortcuts (e.g. Shift+H to toggle the header) must not steal keystrokes
// while the user is typing. Two kinds of "typing" exist in this app:
//
//  1. Real form fields (Script Creator, library search, Report Composer, ...) —
//     these can be detected with document.activeElement.
//  2. Phosphor's Prompt / LoginPrompt — these capture keys with a document-level
//     keydown listener and never focus a real <input>, so activeElement is the
//     <body>. They register themselves here while they are accepting input.

let activeInputCount = 0;

// Called by Prompt/LoginPrompt while they are capturing keystrokes. Returns the
// matching "release" function (safe to call more than once).
export const registerTerminalInput = (): (() => void) => {
    activeInputCount += 1;
    let released = false;

    return () => {
        if (released) {
            return;
        }
        released = true;
        activeInputCount = Math.max(0, activeInputCount - 1);
    };
};

export const isTerminalInputActive = (): boolean => activeInputCount > 0;

export const isEditableElement = (element: Element | null): boolean => {
    if (!(element instanceof HTMLElement)) {
        return false;
    }

    if (element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLSelectElement) {
        return true;
    }

    return element.isContentEditable;
};

// True when a keystroke should be treated as typing rather than a shortcut.
export const isTypingContext = (): boolean => {
    return isTerminalInputActive() || isEditableElement(document.activeElement);
};
