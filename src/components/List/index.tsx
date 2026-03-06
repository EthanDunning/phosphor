import React, { SFC, useCallback, useEffect, useMemo, useState } from "react";

import "./style.scss";

export interface ListState {
    text: string;
    active?: boolean;
}

export interface ListProps {
    states: Array<ListState | string>;
    className?: string;
    onRendered?: () => void;
    onClick?: () => void;
}

const List: SFC<ListProps> = (props) => {
    const { className, states, onRendered, onClick } = props;
    const css = [
        "__list__",
        className ? className : null,
    ].join(" ").trim();

    const normalized = useMemo(() => {
        return (states || []).map((state) => {
            if (typeof state === "string") {
                return { text: state, active: false };
            }

            return {
                text: state.text || "",
                active: !!state.active,
            };
        }).filter((state) => state.text.length > 0);
    }, [states]);

    const initialIndex = useMemo(() => {
        const activeIndex = normalized.findIndex((state) => state.active);
        return activeIndex > -1 ? activeIndex : 0;
    }, [normalized]);

    const [index, setIndex] = useState(initialIndex);

    useEffect(() => {
        setIndex(initialIndex);
    }, [initialIndex]);

    const handleRendered = () => (onRendered && onRendered());
    const handleClick = useCallback(() => {
        onClick && onClick();
        if (!normalized.length) {
            return;
        }

        setIndex((current) => ((current + 1) % normalized.length));
    }, [normalized, onClick]);

    useEffect(() => handleRendered());

    const active = normalized.length ? normalized[index] : { text: "" };

    return <div className={css} onClick={handleClick}>{active.text}</div>;
};

export default List;
