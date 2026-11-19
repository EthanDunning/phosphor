import React, { FC, useCallback, useEffect, useId, useRef, useState } from "react";
import CreatorSelect from "../CreatorSelect";
import {
    fetchMyFeedback,
    FEEDBACK_KINDS,
    FeedbackKind,
    FeedbackRecord,
    getFeedbackStatusLabel,
    getUnreadResponseIds,
    markResponsesSeen,
    MAX_FEEDBACK_LENGTH,
} from "../../lib/feedback";

import "../ModulesPanel/style.scss";
import "./style.scss";

// The header's [FEEDBACK] popup. NEW MESSAGE: a type dropdown, a message box,
// and CANCEL / SUBMIT (the draft survives closing the popup until it's sent).
// MY FEEDBACK: everything the user has sent, its status, and any response.

export type FeedbackTab = "new" | "history";

export interface FeedbackDialogProps {
    open: boolean;
    supabaseReady: boolean;
    signedIn: boolean;
    sessionUserId: string | null;
    sessionEmail: string | null;
    startTab?: FeedbackTab;
    onClose: () => void;
    onSubmit: (kind: FeedbackKind, message: string) => Promise<void>;
    onSignIn: () => void;
    onResponsesSeen?: () => void;
}

const KIND_OPTIONS = FEEDBACK_KINDS.map((kind) => ({ value: kind.value, label: kind.label }));
const KIND_TAGS: Record<string, string> = { bug: "BUG", feature: "FEATURE", general: "GENERAL" };
const SENT_SWITCH_DELAY_MS = 1400;

const formatDate = (value: string | null): string => {
    if (!value) {
        return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const FeedbackDialog: FC<FeedbackDialogProps> = ({
    open,
    supabaseReady,
    signedIn,
    sessionUserId,
    sessionEmail,
    startTab = "new",
    onClose,
    onSubmit,
    onSignIn,
    onResponsesSeen,
}) => {
    const [tab, setTab] = useState<FeedbackTab>("new");
    const [kind, setKind] = useState<FeedbackKind>("bug");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const [history, setHistory] = useState<FeedbackRecord[] | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [unreadIds, setUnreadIds] = useState<string[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const switchTimerRef = useRef<number | null>(null);
    const titleId = useId();

    const canUseAccount = supabaseReady && signedIn && !!sessionUserId;
    const canWrite = canUseAccount && !sent;
    const canSubmit = canWrite && !busy && message.trim().length > 0 && message.length <= MAX_FEEDBACK_LENGTH;
    const placeholder = FEEDBACK_KINDS.find((entry) => entry.value === kind)?.placeholder || "";

    const loadHistory = useCallback(async () => {
        if (!canUseAccount || !sessionUserId) {
            return;
        }
        setHistoryLoading(true);
        setHistoryError(null);
        try {
            const records = await fetchMyFeedback(sessionUserId);
            setHistory(records);
            setUnreadIds(getUnreadResponseIds(records, sessionUserId));
        } catch (loadError: any) {
            setHistoryError(loadError?.message || "Couldn't load your feedback.");
        } finally {
            setHistoryLoading(false);
        }
    }, [canUseAccount, sessionUserId]);

    const close = () => {
        if (busy) {
            return;
        }
        setError(null);
        onClose();
    };

    const submit = async () => {
        if (!canSubmit) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await onSubmit(kind, message);
            setSent(true);
            setMessage("");
            // show it landing in MY FEEDBACK
            switchTimerRef.current = window.setTimeout(() => {
                switchTimerRef.current = null;
                setSent(false);
                setTab("history");
                void loadHistory();
            }, SENT_SWITCH_DELAY_MS);
        } catch (submitError: any) {
            setError(submitError?.message || "Couldn't send your feedback. Please try again.");
        } finally {
            setBusy(false);
        }
    };

    // on open: pick the starting tab, refresh the history
    useEffect(() => {
        if (!open) {
            return;
        }
        setTab(canUseAccount ? startTab : "new");
        setExpandedId(null);
        void loadHistory();
    }, [open]);

    // reading the history marks its responses as seen (the "NEW" labels stay
    // until the popup is reopened, so the user can tell which ones they were)
    useEffect(() => {
        if (open && tab === "history" && history && sessionUserId) {
            markResponsesSeen(history, sessionUserId);
            onResponsesSeen?.();
        }
    }, [open, tab, history, sessionUserId]);

    useEffect(() => {
        if (open && tab === "new" && canWrite) {
            window.setTimeout(() => textareaRef.current?.focus(), 0);
        }
    }, [open, tab]);

    useEffect(() => () => {
        if (switchTimerRef.current !== null) {
            window.clearTimeout(switchTimerRef.current);
        }
    }, []);

    // Esc closes; Ctrl/Cmd+Enter sends
    useEffect(() => {
        if (!open) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                close();
            } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && tab === "new") {
                event.preventDefault();
                void submit();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    });

    if (!open) {
        return null;
    }

    let note: string;
    if (!supabaseReady) {
        note = "Feedback needs the online service, which isn't configured for this build.";
    } else if (!signedIn) {
        note = "Sign in to send feedback, so we can follow up on it. This window reopens once you're signed in.";
    } else {
        note = `Sending as ${sessionEmail || "your account"}. Admins will see this address so they can reply.`;
    }

    const historyCount = history ? history.length : 0;
    const unreadCount = unreadIds.length;

    const renderNewMessage = () => (
        <>
            <div className="modules-panel__field">
                <span>Type</span>
                <CreatorSelect
                    value={kind}
                    options={KIND_OPTIONS}
                    disabled={!canWrite || busy}
                    onChange={(nextKind) => setKind(nextKind as FeedbackKind)}
                />
            </div>

            <label className="modules-panel__field feedback-dialog__message">
                <span>Message</span>
                <textarea
                    ref={textareaRef}
                    value={message}
                    placeholder={canWrite ? placeholder : ""}
                    maxLength={MAX_FEEDBACK_LENGTH}
                    disabled={!canWrite || busy}
                    onChange={(event) => setMessage(event.target.value)}
                />
            </label>

            <div className="feedback-dialog__meta">
                <span>{note}</span>
                <span className="feedback-dialog__count">{message.length} / {MAX_FEEDBACK_LENGTH}</span>
            </div>

            {error && (
                <div className="modules-panel__notice modules-panel__notice--error" role="alert">{error}</div>
            )}
            {sent && (
                <div className="modules-panel__notice modules-panel__notice--success" role="status">
                    TRANSMISSION RECEIVED. Thank you! You can follow it under MY FEEDBACK.
                </div>
            )}
        </>
    );

    const renderHistory = () => {
        if (historyError) {
            return <div className="modules-panel__notice modules-panel__notice--error" role="alert">{historyError}</div>;
        }
        if (!history) {
            return <p className="feedback-dialog__empty">{historyLoading ? "Loading..." : ""}</p>;
        }
        if (!history.length) {
            return <p className="feedback-dialog__empty">You haven't sent any feedback yet.</p>;
        }
        return (
            <ul className="feedback-dialog__history">
                {history.map((record) => {
                    const expanded = expandedId === record.id;
                    const isUnread = unreadIds.includes(record.id);
                    return (
                        <li key={record.id} className={"feedback-dialog__entry" + (isUnread ? " feedback-dialog__entry--unread" : "")}>
                            <div className="feedback-dialog__entry-head">
                                <span>[{KIND_TAGS[record.kind] || record.kind}]</span>
                                <span className={`feedback-dialog__status feedback-dialog__status--${record.status}`}>
                                    {getFeedbackStatusLabel(record.status).toUpperCase()}
                                </span>
                                <span className="feedback-dialog__date">{formatDate(record.created_at)}</span>
                            </div>
                            <button
                                type="button"
                                className={"feedback-dialog__entry-text" + (expanded ? " is-expanded" : "")}
                                title={expanded ? "Show less" : "Show the whole message"}
                                aria-expanded={expanded}
                                onClick={() => setExpandedId(expanded ? null : record.id)}
                            >
                                {record.message}
                            </button>
                            {record.response ? (
                                <div className="feedback-dialog__response">
                                    <div className="feedback-dialog__response-head">
                                        <span>RESPONSE{record.responder_name ? ` FROM ${record.responder_name.toUpperCase()}` : ""}</span>
                                        {isUnread && <span className="feedback-dialog__new">NEW</span>}
                                        <span className="feedback-dialog__date">{formatDate(record.responded_at)}</span>
                                    </div>
                                    <div className="feedback-dialog__response-text">{record.response}</div>
                                </div>
                            ) : (
                                <div className="feedback-dialog__no-response">No response yet.</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        );
    };

    return (
        <div className="modules-panel feedback-dialog">
            <div className="feedback-dialog__box" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <div className="modules-panel__header">
                    <div>
                        <h2 id={titleId}>[ FEEDBACK ]</h2>
                        <p>Report a bug, request a feature, or tell us what you think.</p>
                    </div>
                </div>

                {canUseAccount && (
                    <div className="feedback-dialog__tabs" role="tablist">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={tab === "new"}
                            className={"modules-panel__button" + (tab === "new" ? " feedback-dialog__tab--active" : "")}
                            onClick={() => setTab("new")}
                        >
                            [NEW MESSAGE]
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={tab === "history"}
                            className={"modules-panel__button" + (tab === "history" ? " feedback-dialog__tab--active" : "")}
                            onClick={() => setTab("history")}
                        >
                            [MY FEEDBACK{historyCount ? ` (${historyCount})` : ""}]
                            {unreadCount > 0 && <span className="feedback-dialog__badge">{unreadCount} NEW</span>}
                        </button>
                    </div>
                )}

                <div className={"feedback-dialog__body" + (tab === "history" ? " feedback-dialog__body--history" : "")}>
                    {tab === "new" ? renderNewMessage() : renderHistory()}
                </div>

                <div className="feedback-dialog__actions">
                    {tab === "history" ? (
                        <>
                            <button type="button" className="modules-panel__button" onClick={() => void loadHistory()} disabled={historyLoading}>
                                {historyLoading ? "[LOADING...]" : "[REFRESH]"}
                            </button>
                            <button type="button" className="modules-panel__button" onClick={close}>[CLOSE]</button>
                        </>
                    ) : (
                        <>
                            <button type="button" className="modules-panel__button" onClick={close} disabled={busy}>
                                [CANCEL]
                            </button>
                            {supabaseReady && !signedIn ? (
                                <button type="button" className="modules-panel__button" onClick={onSignIn}>
                                    [SIGN IN]
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="modules-panel__button"
                                    onClick={() => void submit()}
                                    disabled={!canSubmit}
                                    title="Send (Ctrl+Enter)"
                                >
                                    {busy ? "[SENDING...]" : "[SUBMIT]"}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FeedbackDialog;
