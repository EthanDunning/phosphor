import React, { SFC, useCallback, useEffect, useState } from "react";

import "./style.scss";

export interface ToggleState {
    text: string;
    active?: boolean;
    target?: string;
    action?: string;
}

export interface ToggleProps {
    states: ToggleState[];
    className?: string;
    onRendered?: () => void;
    onClick?: (state?: ToggleState) => void;
}

const Toggle: SFC<ToggleProps> = (props) => {
    const { className, states, onRendered, onClick } = props;
    const css = [
        "__toggle__",
        className ? className : null,
    ].join(" ").trim();

    // find the active state
    const state = states.find(element => element.active === true);
    const text = (state && state.text) || "";

    // set the new active one
    const [active, setActive] = useState(state);

    // events
    const handleRendered = () => (onRendered && onRendered());
    const handleClick = useCallback(() => {
        if (!states || !states.length) {
            onClick && onClick();
            return;
        }

        const current = active || states.find((element) => element.active === true) || states[0];
        const index = states.findIndex((element) => element === current);
        const safeIndex = index > -1 ? index : 0;

        states.forEach((element) => element.active = false);
        const next = states[(safeIndex + 1) % states.length];
        next.active = true;
        setActive(next);
        onClick && onClick(next);
    }, [states, active, setActive, onClick]);

    // this should fire on mount/update
    useEffect(() => handleRendered());

    return <div className={css} onClick={handleClick}>{text}</div>;
};

export default Toggle;
