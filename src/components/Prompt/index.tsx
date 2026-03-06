import React, { SFC, useEffect, useRef, RefObject, useState, } from "react";

// css
import "./style.scss";

export interface PromptProps {
    prompt?: string;
    commands?: any[];
    className?: string;
    disabled?: boolean;
    allowFreeInput?: boolean;
    inputAction?: any;

    onCommand?: (command: string, action: any) => void;
    onEnter?: () => void;
    onEscape?: () => void;
    onRendered?: () => void;
}

export const PROMPT_DEFAULT = "$> ";

const Prompt: SFC<PromptProps> = (props) => {
    const {
        disabled,
        prompt,
        className,
        commands,
        allowFreeInput,
        inputAction,
        onCommand,
        onEnter,
        onRendered,
    } = props;
    const ref: RefObject<HTMLSpanElement> = useRef();
    const css = [
        "__prompt__",
        disabled ? "disabled" : null,
        className ? className : null,
    ].join(" ").trim();

    const [value, setValue] = useState("");

    // events
    const handleFocus = () => ref.current.focus();

    const handleCommand = () => {
        if (!onCommand) {
            return;
        }

        const submitted = value.trim();
        if (!submitted.length) {
            setValue("");
            return;
        }

        const command = commands && commands.find(element => element.command === submitted);
        setValue("");

        if (command) {
            onCommand(submitted, command.action);
            return;
        }

        if (allowFreeInput) {
            onCommand(submitted, inputAction || { type: "input" });
        }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (disabled) {
            setValue("");
            return;
        }

        e.preventDefault();

        const normalized = e.key.toLowerCase();
        switch (normalized) {
            case "backspace":
                value.length && setValue(value.slice(0, -1));
                break;

            case "enter":
                onEnter && onEnter();
                handleCommand();
                break;

            default:
                // support alphanumeric, space, and limited punctuation only
                const re = /[a-zA-Z0-9 ,.<>/?[\]{}'"`;:*&^%$#@!~_|\\\-+=()]/;
                if (e.key.length === 1 && e.key.match(re)) {
                    setValue(value + e.key);
                }
                break;
        }
    };

    // render effects
    useEffect(() => {
        // mount
        onRendered && onRendered();
        document.addEventListener("keydown", handleKeyDown);

        // unmount
        return () => document.removeEventListener("keydown", handleKeyDown);
    });

    return (
        <div className={css} onClick={handleFocus}>
            {prompt && <span className={"prompt"}>{prompt}</span>}
            <span className={"input"} ref={ref}>{value}</span>
        </div>
    );
};

export default Prompt;
