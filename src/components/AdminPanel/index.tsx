import React, { FC, useCallback, useEffect, useId, useMemo, useState } from "react";
import CreatorSelect from "../CreatorSelect";
import {
    deleteFeedback,
    fetchFeedback,
    FEEDBACK_KINDS,
    FEEDBACK_STATUSES,
    FeedbackRecord,
    FeedbackStatus,
    getFeedbackKindLabel,
    getFeedbackStatusLabel,
    MAX_RESPONSE_LENGTH,
    respondToFeedback,
    updateFeedbackStatus,
} from "../../lib/feedback";

import "../ModulesPanel/style.scss";
import "./style.scss";

// Admin-only inbox for feedback sent with the header's [FEEDBACK] button.
// The App only renders this for admins, and the database's RLS refuses
// everyone else anyway, so a non-admin who forced it open would see nothing.

export interface AdminPanelProps {
    open: boolean;
    onClose: () => void;
}

const KIND_FILTERS = [
    { value: "all", label: "All types" },
    ...FEEDBACK_KINDS.map((kind) => ({ value: kind.value, label: kind.label })),
];

const STATUS_FILTERS = [
    { value: "open", label: "Open (new + in progress)" },
    ...FEEDBACK_STATUSES.map((status) => ({ value: status.value, label: status.label })),
    { value: "all", label: "All statuses" },
];

const KIND_TAGS: Record<string, string> = { bug: "BUG", feature: "FEATURE", general: "GENERAL" };

const CONTEXT_LABELS: Record<string, string> = {
    script: "Script",
    screen: "Screen",
    page: "Page",
    viewport: "Viewport",
    browser: "Browser",
};

const formatDate = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const excerpt = (text: string, length = 90): string => {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

const isOpenStatus = (status: FeedbackStatus) => status === "new" || status === "in_progress";

const AdminPanel: FC<AdminPanelProps> = ({ open, onClose }) => {
    const [records, setRecords] = useState<FeedbackRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [kindFilter, setKindFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("open");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [responseDraft, setResponseDraft] = useState("");
    const [responseNotice, setResponseNotice] = useState<string | null>(null);
    const titleId = useId();

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setRecords(await fetchFeedback());
        } catch (loadError: any) {
            setError(loadError?.message || "Couldn't load feedback.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) {
            void load();
        } else {
            setConfirmDelete(false);
        }
    }, [open, load]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, onClose]);

    const visible = useMemo(() => records.filter((record) => {
        if (kindFilter !== "all" && record.kind !== kindFilter) {
            return false;
        }
        if (statusFilter === "open") {
            return isOpenStatus(record.status);
        }
        return statusFilter === "all" || record.status === statusFilter;
    }), [records, kindFilter, statusFilter]);

    const selected = visible.find((record) => record.id === selectedId) || visible[0] || null;
    const newCount = records.filter((record) => record.status === "new").length;
    const openCount = records.filter((record) => isOpenStatus(record.status)).length;

    // the response box starts from the saved response of the selected message
    useEffect(() => {
        setResponseDraft(selected?.response || "");
    }, [selected?.id, selected?.response]);

    // switching messages clears the per-message prompts
    useEffect(() => {
        setConfirmDelete(false);
        setResponseNotice(null);
    }, [selected?.id]);

    const saveResponse = async (record: FeedbackRecord, text: string) => {
        setBusy(true);
        setError(null);
        setResponseNotice(null);
        try {
            const saved = await respondToFeedback(record.id, text);
            setRecords((prev) => prev.map((entry) => (entry.id === record.id ? { ...entry, ...saved, sender_name: entry.sender_name } : entry)));
            setSelectedId(record.id);
            setResponseNotice(saved.response ? "Response sent. They'll see it under MY FEEDBACK." : "Response removed.");
        } catch (saveError: any) {
            setError(saveError?.message || "Couldn't save the response.");
        } finally {
            setBusy(false);
        }
    };

    const setStatus = async (record: FeedbackRecord, status: FeedbackStatus) => {
        if (record.status === status || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await updateFeedbackStatus(record.id, status);
            setRecords((prev) => prev.map((entry) => (entry.id === record.id ? { ...entry, status } : entry)));
            setSelectedId(record.id);
        } catch (statusError: any) {
            setError(statusError?.message || "Couldn't update the status.");
        } finally {
            setBusy(false);
        }
    };

    const remove = async (record: FeedbackRecord) => {
        setBusy(true);
        setError(null);
        try {
            await deleteFeedback(record.id);
            setRecords((prev) => prev.filter((entry) => entry.id !== record.id));
            setSelectedId(null);
        } catch (deleteError: any) {
            setError(deleteError?.message || "Couldn't delete it.");
        } finally {
            setBusy(false);
            setConfirmDelete(false);
        }
    };

    if (!open) {
        return null;
    }

    const senderLabel = (record: FeedbackRecord) => record.sender_name || record.contact_email || "Deleted account";
    const contextEntries = selected ? Object.entries(selected.context || {}) : [];

    return (
        <div className="modules-panel admin-panel">
            <div className="modules-panel__dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <div className="modules-panel__header">
                    <div>
                        <h2 id={titleId}>[ ADMIN // FEEDBACK INBOX ]</h2>
                        <p>{newCount} new · {openCount} open · {records.length} total</p>
                    </div>
                    <div className="modules-panel__header-actions">
                        <button type="button" className="modules-panel__button" onClick={() => void load()} disabled={loading}>
                            {loading ? "[LOADING...]" : "[REFRESH]"}
                        </button>
                        <button type="button" className="modules-panel__button" onClick={onClose}>[CLOSE]</button>
                    </div>
                </div>

                {error && (
                    <div className="modules-panel__notice modules-panel__notice--error" role="alert">
                        <span>{error}</span>
                        <button type="button" className="modules-panel__notice-dismiss" aria-label="Dismiss" onClick={() => setError(null)}>×</button>
                    </div>
                )}

                <div className="admin-panel__toolbar">
                    <div className="modules-panel__field">
                        <span>Type</span>
                        <CreatorSelect value={kindFilter} options={KIND_FILTERS} onChange={setKindFilter} />
                    </div>
                    <div className="modules-panel__field">
                        <span>Status</span>
                        <CreatorSelect value={statusFilter} options={STATUS_FILTERS} onChange={setStatusFilter} />
                    </div>
                </div>

                <div className="admin-panel__body">
                    <div className="admin-panel__list" role="listbox" aria-label="Feedback">
                        {!visible.length && (
                            <p className="admin-panel__empty">
                                {loading ? "Loading..." : (records.length ? "Nothing matches these filters." : "No feedback yet.")}
                            </p>
                        )}
                        {visible.map((record) => (
                            <button
                                key={record.id}
                                type="button"
                                role="option"
                                aria-selected={selected?.id === record.id}
                                className={
                                    "admin-panel__item"
                                    + (selected?.id === record.id ? " admin-panel__item--active" : "")
                                    + ` admin-panel__item--${record.kind}`
                                }
                                onClick={() => setSelectedId(record.id)}
                            >
                                <span className="admin-panel__item-head">
                                    <span className="admin-panel__tag">[{KIND_TAGS[record.kind] || record.kind}]</span>
                                    <span className={`admin-panel__status admin-panel__status--${record.status}`}>
                                        {getFeedbackStatusLabel(record.status).toUpperCase()}
                                    </span>
                                    {record.response && <span className="admin-panel__replied">REPLIED</span>}
                                    <span className="admin-panel__date">{formatDate(record.created_at)}</span>
                                </span>
                                <span className="admin-panel__item-from">{senderLabel(record)}</span>
                                <span className="admin-panel__item-text">{excerpt(record.message)}</span>
                            </button>
                        ))}
                    </div>

                    <div className="admin-panel__detail">
                        {!selected && <p className="admin-panel__empty">Select a message to read it.</p>}
                        {selected && (
                            <>
                                <h3>
                                    {getFeedbackKindLabel(selected.kind).toUpperCase()}
                                    <span className={`admin-panel__status admin-panel__status--${selected.status}`}>
                                        {getFeedbackStatusLabel(selected.status).toUpperCase()}
                                    </span>
                                </h3>

                                <dl className="admin-panel__facts">
                                    <dt>From</dt>
                                    <dd>
                                        {selected.sender_name || "(no display name)"}
                                        {selected.contact_email && (
                                            <>
                                                {" · "}
                                                <a href={`mailto:${encodeURIComponent(selected.contact_email)}?subject=${encodeURIComponent(`Re: your Phosphor ${getFeedbackKindLabel(selected.kind).toLowerCase()}`)}`}>
                                                    {selected.contact_email}
                                                </a>
                                            </>
                                        )}
                                    </dd>
                                    <dt>Sent</dt>
                                    <dd>{formatDate(selected.created_at)}</dd>
                                    {contextEntries.map(([key, value]) => (
                                        <React.Fragment key={key}>
                                            <dt>{CONTEXT_LABELS[key] || key}</dt>
                                            <dd>{String(value)}</dd>
                                        </React.Fragment>
                                    ))}
                                    <dt>ID</dt>
                                    <dd className="admin-panel__id">{selected.id}</dd>
                                </dl>

                                <div className="admin-panel__message">{selected.message}</div>

                                <div className="modules-panel__field admin-panel__response">
                                    <span>
                                        Response
                                        {selected.responded_at && (
                                            <em className="admin-panel__response-meta">
                                                {" "}· sent {formatDate(selected.responded_at)}
                                                {selected.responder_name ? ` by ${selected.responder_name}` : ""}
                                            </em>
                                        )}
                                    </span>
                                    <textarea
                                        value={responseDraft}
                                        maxLength={MAX_RESPONSE_LENGTH}
                                        placeholder="Write a reply. The sender sees it under MY FEEDBACK in the feedback window."
                                        disabled={busy}
                                        onChange={(event) => {
                                            setResponseDraft(event.target.value);
                                            setResponseNotice(null);
                                        }}
                                    />
                                    <div className="admin-panel__actions">
                                        <button
                                            type="button"
                                            className="modules-panel__button"
                                            disabled={busy || !responseDraft.trim().length || responseDraft.trim() === (selected.response || "")}
                                            onClick={() => void saveResponse(selected, responseDraft)}
                                        >
                                            {selected.response ? "[UPDATE RESPONSE]" : "[SEND RESPONSE]"}
                                        </button>
                                        {selected.response && (
                                            <button
                                                type="button"
                                                className="modules-panel__button"
                                                disabled={busy}
                                                onClick={() => void saveResponse(selected, "")}
                                            >
                                                [REMOVE RESPONSE]
                                            </button>
                                        )}
                                        <span className="admin-panel__response-count">{responseDraft.length} / {MAX_RESPONSE_LENGTH}</span>
                                    </div>
                                    {responseNotice && <div className="admin-panel__response-notice" role="status">{responseNotice}</div>}
                                </div>

                                <div className="modules-panel__field">
                                    <span>Set Status</span>
                                    <div className="admin-panel__actions">
                                        {FEEDBACK_STATUSES.map((status) => (
                                            <button
                                                key={status.value}
                                                type="button"
                                                className={"modules-panel__button" + (selected.status === status.value ? " admin-panel__button--active" : "")}
                                                aria-pressed={selected.status === status.value}
                                                disabled={busy}
                                                onClick={() => void setStatus(selected, status.value)}
                                            >
                                                [{status.label.toUpperCase()}]
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="admin-panel__actions admin-panel__actions--danger">
                                    {!confirmDelete ? (
                                        <button type="button" className="modules-panel__button" disabled={busy} onClick={() => setConfirmDelete(true)}>
                                            [DELETE]
                                        </button>
                                    ) : (
                                        <>
                                            <span>Delete this message for good?</span>
                                            <button type="button" className="modules-panel__button admin-panel__button--danger" disabled={busy} onClick={() => void remove(selected)}>
                                                [CONFIRM DELETE]
                                            </button>
                                            <button type="button" className="modules-panel__button" disabled={busy} onClick={() => setConfirmDelete(false)}>
                                                [KEEP]
                                            </button>
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminPanel;
