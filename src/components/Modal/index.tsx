import React, { FC, useEffect, useCallback } from "react";
import { renderMarkdown } from "../../utils/markdown";
import Prompt from "../Prompt";

import "./style.scss";

interface ModalTextEntry {
    text?: string;
    className?: string;
}

interface ModalBitmapEntry {
    type: "bitmap";
    src: string;
    alt?: string;
    className?: string;
    fillWidth?: boolean;
    scale?: number;
}

interface ModalPromptEntry {
    type: "prompt";
    prompt: string;
    commands?: any[];
    className?: string;
    caseSensitive?: boolean;
    cursor?: boolean;
    allowFreeInput?: boolean;
    inputAction?: any;
}

type ModalContentEntry = string | ModalTextEntry | ModalBitmapEntry | ModalPromptEntry;

export interface ModalAction {
    label: string;
}

export interface ModalProps {
    text: string | ModalContentEntry[];
    className?: string;
    onClose: () => void;
    actions?: ModalAction[];
    onAction?: (actionIndex: number) => void;
    onCommand?: (command: string, action: any) => void;
    onPromptEnter?: () => void;
}

const Modal: FC<ModalProps> = (props) => {
    const { text, className, onClose, actions, onAction, onCommand, onPromptEnter } = props;
    const css = [
        "__modal__",
        className ? className : null,
    ].join(" ").trim();
    const content = (typeof text === "string") ? [text] : text;
    const hasInteractiveContent = content.some((element) => {
        return !!element && typeof element === "object" && (element as ModalPromptEntry).type === "prompt";
    }) || !!(actions && actions.length);

    const renderContent = () => {
        return content.map((element, index) => {
            if (typeof element === "string") {
                return (
                    <div key={index} className="__text__">
                        {renderMarkdown(element)}
                    </div>
                );
            }

            if (element && typeof element === "object") {
                if ((element as ModalPromptEntry).type === "prompt") {
                    const promptEntry = element as ModalPromptEntry;
                    return (
                        <Prompt
                            key={index}
                            className={promptEntry.className || ""}
                            prompt={promptEntry.prompt}
                            commands={promptEntry.commands}
                            caseSensitive={promptEntry.caseSensitive}
                            cursor={promptEntry.cursor}
                            allowFreeInput={promptEntry.allowFreeInput}
                            inputAction={promptEntry.inputAction}
                            onCommand={onCommand}
                            onEnter={onPromptEnter}
                        />
                    );
                }

                if ((element as ModalBitmapEntry).type === "bitmap" && (element as ModalBitmapEntry).src) {
                    const bitmap = element as ModalBitmapEntry;
                    const style: React.CSSProperties = {};
                    if (bitmap.fillWidth) {
                        style.width = "100%";
                    } else if (typeof bitmap.scale === "number" && Number.isFinite(bitmap.scale) && bitmap.scale > 0) {
                        style.width = `${Math.max(1, Math.round(bitmap.scale * 100))}%`;
                    }

                    return (
                        <img
                            key={index}
                            className={bitmap.className || ""}
                            src={bitmap.src}
                            alt={bitmap.alt || ""}
                            style={style}
                        />
                    );
                }

                const textEntry = element as ModalTextEntry;
                const textValue = typeof textEntry.text === "string" ? textEntry.text : "";
                const textCss = [
                    "__text__",
                    textEntry.className ? textEntry.className : null,
                ].join(" ").trim();

                return (
                    <div key={index} className={textCss}>
                        {renderMarkdown(textValue)}
                    </div>
                );
            }

            return null;
        });
    }

    // add a keyhandler
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        e.preventDefault();

        const key = e.key.toLowerCase();

        switch (key) {
            case "escape":
                onClose && onClose();
                break;

            case "enter":
                if (!hasInteractiveContent) {
                    onClose && onClose();
                }
                break;

            default:
                break;
        }
    }, [onClose, hasInteractiveContent]);

    useEffect(() => {
        // mount
        document.body.classList.add("static");
        document.addEventListener("keydown", handleKeyDown);

        // unmount
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.classList.remove("static");
        };
    }, [handleKeyDown]);

    return (
        <section className={css} onClick={onClose}>
            <div className="content" onClick={(e) => e.stopPropagation()}>
                {renderContent()}
                {actions && actions.length > 0 && (
                    <div className="actions">
                        {actions.map((action, index) => (
                            <button
                                key={`${action.label}-${index}`}
                                type="button"
                                className="action"
                                onClick={() => {
                                    onAction && onAction(index);
                                }}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
};

export default Modal;
