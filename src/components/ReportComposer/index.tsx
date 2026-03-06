import React, { SFC, useEffect, useState } from "react";

import "./style.scss";

export interface ReportComposerProps {
    template?: string;
    className?: string;
    onRendered?: () => void;
    onSave?: (value: string) => void;
    onCancel?: () => void;
}

const ReportComposer: SFC<ReportComposerProps> = (props) => {
    const { template, className, onRendered, onSave, onCancel } = props;
    const css = ["__report_composer__", className ? className : null].join(" ").trim();
    const [value, setValue] = useState(template || "");

    useEffect(() => {
        onRendered && onRendered();
    }, [onRendered]);

    const handleSave = () => {
        onSave && onSave(value);
    };

    const handleCancel = () => {
        onCancel && onCancel();
    };

    return (
        <div className={css}>
            <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                spellCheck={false}
            />
            <div className="actions">
                <button type="button" onClick={handleSave}>SAVE REPORT</button>
                <button type="button" onClick={handleCancel}>CANCEL</button>
            </div>
        </div>
    );
};

export default ReportComposer;
