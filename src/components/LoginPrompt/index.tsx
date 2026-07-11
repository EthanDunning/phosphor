import React, { FC, useEffect, useState } from "react";

// css
import "./style.scss";

import { registerTerminalInput } from "../../lib/terminalInput";

export interface LoginPromptProps {
    usernamePrompt?: string;
    passwordPrompt?: string;
    className?: string;
    disabled?: boolean;
    usernameCaseSensitive?: boolean;
    hideUsername?: boolean;
    passwordCaseSensitive?: boolean;
    hidePassword?: boolean;

    onSubmit?: (username: string, password: string) => void;
    onEnter?: () => void;
    onRendered?: () => void;
}

const USERNAME_PROMPT_DEFAULT = "username> ";
const PASSWORD_PROMPT_DEFAULT = "password> ";

const LoginPrompt: FC<LoginPromptProps> = (props) => {
    const {
        disabled,
        usernamePrompt,
        passwordPrompt,
        className,
        usernameCaseSensitive,
        hideUsername,
        passwordCaseSensitive,
        hidePassword,
        onSubmit,
        onEnter,
        onRendered,
    } = props;
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [activeField, setActiveField] = useState<"username" | "password">("username");
    const css = [
        "__login__",
        disabled ? "disabled" : null,
        usernameCaseSensitive === false ? "username-case-insensitive" : null,
        passwordCaseSensitive === false ? "case-insensitive" : null,
        className ? className : null,
    ].join(" ").trim();

    const isEditableTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        if (
            target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || target instanceof HTMLSelectElement
        ) {
            return true;
        }

        return target.isContentEditable;
    };

    const reset = () => {
        setUsername("");
        setPassword("");
        setActiveField("username");
    };

    const handleSubmit = () => {
        if (!onSubmit) {
            return;
        }

        if (!username.length || !password.length) {
            return;
        }

        onSubmit(username, password);
        reset();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (isEditableTarget(e.target)) {
            return;
        }

        if (e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }

        if (disabled) {
            return;
        }

        const normalized = e.key.toLowerCase();
        switch (normalized) {
            case "backspace":
                e.preventDefault();
                if (activeField === "username") {
                    setUsername((prev) => prev.slice(0, -1));
                    return;
                }
                setPassword((prev) => prev.slice(0, -1));
                break;

            case "enter":
                e.preventDefault();
                onEnter && onEnter();
                if (activeField === "username") {
                    if (!username.length) {
                        return;
                    }

                    setActiveField("password");
                    return;
                }

                handleSubmit();
                break;

            default:
                // support alphanumeric, space, and limited punctuation only
                const re = /[a-zA-Z0-9 ,.<>/?[\]{}'"`;:*&^%$#@!~_|\\\-+=()]/;
                if (e.key.length === 1 && e.key.match(re)) {
                    e.preventDefault();
                    if (activeField === "username") {
                        setUsername((prev) => prev + e.key);
                        return;
                    }
                    setPassword((prev) => prev + e.key);
                }
                break;
        }
    };

    useEffect(() => {
        onRendered && onRendered();
    }, [onRendered]);

    // While this login is accepting keystrokes, global letter shortcuts (like
    // Shift+H) must not steal the key — otherwise you can't type "H" in a login.
    useEffect(() => {
        if (disabled) {
            return;
        }

        return registerTerminalInput();
    }, [disabled]);

    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    });

    const renderedUsername = hideUsername === true ? "*".repeat(username.length) : username;
    const renderedPassword = hidePassword !== false ? "*".repeat(password.length) : password;

    return (
        <div className={css}>
            <div className="line">
                <span className="prompt">{usernamePrompt || USERNAME_PROMPT_DEFAULT}</span>
                <span className={`input ${activeField === "username" ? "active" : ""}`}>
                    {renderedUsername}
                </span>
            </div>

            {activeField === "password" && (
                <div className="line">
                    <span className="prompt">{passwordPrompt || PASSWORD_PROMPT_DEFAULT}</span>
                    <span className={`input ${activeField === "password" ? "active" : ""}`}>
                        {renderedPassword}
                    </span>
                </div>
            )}
        </div>
    );
};

export default LoginPrompt;
