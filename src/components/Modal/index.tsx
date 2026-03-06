import React, { SFC, useEffect, useCallback } from "react";

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

type ModalContentEntry = string | ModalTextEntry | ModalBitmapEntry;

export interface ModalProps {
    text: string | ModalContentEntry[];
    className?: string;
    onClose: () => void;
}

const Modal: SFC<ModalProps> = (props) => {
    const { text, className, onClose } = props;
    const css = [
        "__modal__",
        className ? className : null,
    ].join(" ").trim();

    const renderContent = () => {
        const content = (typeof text === "string") ? [text] : text;
        return content.map((element, index) => {
            if (typeof element === "string") {
                return <p key={index}>{element}</p>;
            }

            if (element && typeof element === "object") {
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

                return (
                    <p key={index} className={element.className || ""}>
                        {(element as ModalTextEntry).text || ""}
                    </p>
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
            case "enter":
            case "escape":
                onClose && onClose();
                break;

            default:
                break;
        }
    }, [onClose]);

    useEffect(() => {
        // mount
        document.body.classList.add("static");
        document.addEventListener("keydown", handleKeyDown);

        // unmount
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.classList.remove("static");
        };
    });

    return (
        <section className={css} onClick={onClose}>
            <div className="content">
                {renderContent()}
            </div>
        </section>
    );
};

export default Modal;
