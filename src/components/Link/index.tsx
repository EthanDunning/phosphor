import React, { FC, useEffect, useRef } from "react";

import "./style.scss";

// enum LinkTargetType {
//     Unknown = 0,
//     Screen,
//     Dialog,
// }

interface LinkTarget {
    target: string;
    type: any;
    shiftKey?: boolean;
}

export interface LinkProps {
    text: string;
    target: string | LinkTarget[];
    className?: string;

    onClick?: (target: string | LinkTarget[], shiftKey: boolean) => void;
    onRendered?: () => void;
    onHover?: () => void; // pointer entered/focused; used by menu-driven skins to sync selection
}

const Link: FC<LinkProps> = (props) => {
    const { text, target, className, onClick, onRendered, onHover } = props;
    const css = ["__link__", className ? className : null].join(" ").trim();
    const longPressTimerRef = useRef<number | null>(null);
    const lastLongPressAtRef = useRef<number>(0);
    const hasShiftTarget = Array.isArray(target) && target.some((entry) => {
        return !!entry && typeof entry === "object" && entry.shiftKey === true;
    });

    const clearLongPressTimer = () => {
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const startLongPress = () => {
        if (!hasShiftTarget) {
            return;
        }

        clearLongPressTimer();
        longPressTimerRef.current = window.setTimeout(() => {
            lastLongPressAtRef.current = Date.now();
            onClick && onClick(target, true);
            clearLongPressTimer();
        }, 500);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
        if (e.button !== 0) {
            return;
        }

        startLongPress();
    };

    const handlePointerUp = () => {
        clearLongPressTimer();
    };

    const handlePointerCancel = () => {
        clearLongPressTimer();
    };

    const handleClick = (e: React.MouseEvent<HTMLSpanElement>) => {
        e.preventDefault();

        clearLongPressTimer();
        if (Date.now() - lastLongPressAtRef.current < 750) {
            return;
        }

        onClick && onClick(target, e.shiftKey);
    };
    const handleRendered = () => (onRendered && onRendered());

    // this should fire on mount/update
    useEffect(() => handleRendered());
    useEffect(() => {
        return () => clearLongPressTimer();
    }, []);

    return (
        <span
            className={css}
            title={hasShiftTarget ? "Shift-click or press and hold for alternate action" : undefined}
            onClick={handleClick}
            onMouseEnter={onHover}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerCancel}
            onPointerCancel={handlePointerCancel}
        >
            {text}
        </span>
    );
};

export default Link;
