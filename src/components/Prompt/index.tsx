import React, { FC, useEffect, useRef, useState, } from "react";

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

const Prompt: FC<PromptProps> = (props) => {
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
    const ref = useRef<HTMLSpanElement>(null);
    const css = [
        "__prompt__",
        disabled ? "disabled" : null,
        className ? className : null,
    ].join(" ").trim();

    const [value, setValue] = useState("");

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
                setValue((prevValue) => prevValue.slice(0, -1));
                break;

            case "enter":
                e.preventDefault();
                onEnter && onEnter();
                handleCommand();
                break;

            default:
                // support alphanumeric, space, and limited punctuation only
                const re = /[a-zA-Z0-9 ,.<>/?[\]{}'"`;:*&^%$#@!~_|\\\-+=()]/;
                if (e.key.length === 1 && e.key.match(re)) {
                    e.preventDefault();
                    setValue((prevValue) => prevValue + e.key);
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
