import React, { FC, useEffect, useId, useRef, useState } from "react";

import "./style.scss";

export interface DropdownState {
    text: string;
    active?: boolean;
    target?: string;
    action?: string;
    dialog?: string;
    requireShift?: boolean;
    className?: string;
}

export interface DropdownProps {
    states: DropdownState[];
    className?: string;
    onRendered?: () => void;
    onClick?: (state: DropdownState | undefined, shiftKey: boolean) => void;
}

const Dropdown: FC<DropdownProps> = (props) => {
    const { className, states, onRendered, onClick } = props;
    const [open, setOpen] = useState<boolean>(false);
    const [active, setActive] = useState<DropdownState | undefined>(() => {
        return states.find((state) => state.active === true) || states[0];
    });
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const listboxId = useId();

    useEffect(() => {
        setActive(states.find((state) => state.active === true) || states[0]);
    }, [states]);

    // close the menu on any click outside the dropdown
    useEffect(() => {
        const onDocumentMouseDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target || !rootRef.current || rootRef.current.contains(target)) {
                return;
            }
            setOpen(false);
        };
        document.addEventListener("mousedown", onDocumentMouseDown);
        return () => document.removeEventListener("mousedown", onDocumentMouseDown);
    }, []);

    const handleRendered = () => (onRendered && onRendered());
    // this should fire on mount/update
    useEffect(() => handleRendered());

    const closeAndFocusTrigger = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    const handleSelect = (state: DropdownState, shiftKey: boolean) => {
        states.forEach((entry) => (entry.active = false));
        state.active = true;
        setActive(state);
        setOpen(false);
        onClick && onClick(state, shiftKey);
    };

    const text = (active && active.text) || "";
    const css = [
        "__dropdown__",
        open ? "__dropdown__--open" : null,
        className ? className : null,
        active?.className ? active.className : null,
    ].join(" ").trim();

    return (
        <div
            ref={rootRef}
            className={css}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    closeAndFocusTrigger();
                }
            }}
        >
            <button
                ref={triggerRef}
                type="button"
                className="__dropdown__trigger"
                aria-haspopup="listbox"
                aria-controls={listboxId}
                aria-expanded={open}
                onClick={() => states.length && setOpen((prev) => !prev)}
                onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " " || e.key === "ArrowDown") && states.length) {
                        e.preventDefault();
                        setOpen((prev) => !prev);
                    }
                }}
            >
                <span className="__dropdown__label">{text}</span>
                {!!states.length && <span className="__dropdown__caret">{open ? "▲" : "▼"}</span>}
            </button>

            {open && (
                <div id={listboxId} role="listbox" className="__dropdown__menu">
                    {states.map((state, index) => {
                        const isActive = state === active;
                        return (
                            <button
                                key={index}
                                type="button"
                                role="option"
                                aria-selected={isActive}
                                className={
                                    "__dropdown__option"
                                    + (isActive ? " __dropdown__option--active" : "")
                                    + (state.className ? ` ${state.className}` : "")
                                }
                                onClick={(e) => handleSelect(state, e.shiftKey)}
                            >
                                {state.text}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default Dropdown;
