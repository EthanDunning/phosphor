import React, { FC, useEffect, useRef } from "react";

import "./style.scss";

// Terminal text boxes (Prompt, LoginPrompt, the table QUERY line) read keys from
// document-level listeners and never focus a real <input>, so phones have no
// way to open their on-screen keyboard. KeyboardProxy is an invisible real
// input laid over the text box: tapping the box focuses it (opening the
// keyboard), whatever is typed is mirrored into the box, and tapping anywhere
// outside the box closes the keyboard again. It works the same with a mouse.

// The characters terminal prompts accept (same set as the desktop key handlers).
const ALLOWED_CHAR = /[a-zA-Z0-9 ,.<>/?[\]{}'"`;:*&^%$#@!~_|\\\-+=()]/;

export const filterTerminalText = (value: string): string => {
    return Array.from(value).filter((char) => ALLOWED_CHAR.test(char)).join("");
};

export interface KeyboardProxyProps {
    value: string;
    label: string;
    disabled?: boolean;
    maxLength?: number;
    onChange: (value: string) => void;
    onEnter: () => void;
    onEscape?: () => void;
    onFocus?: () => void;
}

const KeyboardProxy: FC<KeyboardProxyProps> = ({
    value,
    label,
    disabled,
    maxLength,
    onChange,
    onEnter,
    onEscape,
    onFocus,
}) => {
    const ref = useRef<HTMLInputElement>(null);

    // a tap outside the owning text box closes the keyboard (iOS keeps it open otherwise)
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            const input = ref.current;
            if (!input || document.activeElement !== input) {
                return;
            }
            const owner = input.parentElement;
            if (owner && event.target instanceof Node && owner.contains(event.target)) {
                return;
            }
            input.blur();
        };

        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, []);

    useEffect(() => {
        if (disabled && ref.current && document.activeElement === ref.current) {
            ref.current.blur();
        }
    }, [disabled]);

    return (
        <input
            ref={ref}
            className="__keyboard-proxy__"
            type="text"
            value={value}
            disabled={disabled}
            aria-label={label}
            maxLength={maxLength}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            onFocus={onFocus}
            onChange={(event) => onChange(filterTerminalText(event.target.value))}
            onKeyDown={(event) => {
                // Enter/Escape are fully handled here. Stop them reaching document
                // listeners: a dialog opened by this Enter would otherwise see the
                // same keypress and close itself straight away.
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    onEnter();
                } else if (event.key === "Escape" || event.key === "Esc") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (onEscape) {
                        onEscape();
                    } else {
                        event.currentTarget.blur();
                    }
                }
            }}
        />
    );
};

export default KeyboardProxy;
