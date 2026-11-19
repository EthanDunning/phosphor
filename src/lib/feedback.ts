import { hasSupabaseEnv, supabase } from "./supabase";

// Bug reports, feature requests and general feedback (public.feedback in
// supabase/schema.sql). Signed-in users can send feedback and read their own
// (status + the admins' response); only admins can read everyone's, set the
// status, respond, or delete. All enforced by RLS, not the client.

export type FeedbackKind = "bug" | "feature" | "general";
export type FeedbackStatus = "new" | "in_progress" | "resolved" | "closed";

export const FEEDBACK_KINDS: { value: FeedbackKind; label: string; placeholder: string }[] = [
    { value: "bug", label: "Bug Report", placeholder: "What happened? What did you expect instead? Steps to reproduce help a lot." },
    { value: "feature", label: "Feature Request", placeholder: "What would you like Phosphor to do?" },
    { value: "general", label: "General Feedback", placeholder: "Questions, ideas, or just say hello." },
];

export const FEEDBACK_STATUSES: { value: FeedbackStatus; label: string }[] = [
    { value: "new", label: "New" },
    { value: "in_progress", label: "In Progress" },
    { value: "resolved", label: "Resolved" },
    { value: "closed", label: "Closed" },
];

export const MAX_FEEDBACK_LENGTH = 4000;

export interface FeedbackRecord {
    id: string;
    user_id: string | null;
    contact_email: string | null;
    kind: FeedbackKind;
    message: string;
    context: Record<string, any>;
    status: FeedbackStatus;
    response: string | null;
    responded_at: string | null;
    responded_by: string | null;
    created_at: string;
    updated_at: string;
    sender_name?: string | null; // profiles.display_name, looked up separately
    responder_name?: string | null;
}

const FEEDBACK_SELECT = "id, user_id, contact_email, kind, message, context, status, response, responded_at, responded_by, created_at, updated_at";
export const MAX_RESPONSE_LENGTH = 4000;
const MAX_CONTEXT_VALUE_LENGTH = 300;

const requireSupabase = () => {
    if (!supabase || !hasSupabaseEnv) {
        throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
    }
    return supabase;
};

// Readable errors for the cases people will actually hit.
const toFeedbackError = (error: any): Error => {
    const code = error?.code;
    if (code === "42P01" || code === "PGRST205") {
        return new Error("The feedback table doesn't exist yet. Run supabase/schema.sql in the Supabase SQL editor.");
    }
    if (code === "42703" || code === "PGRST204") {
        return new Error("The feedback table needs updating for responses. Re-run supabase/schema.sql in the Supabase SQL editor.");
    }
    if (code === "P0001" && typeof error?.message === "string") {
        return new Error(error.message);
    }
    if (code === "42501") {
        return new Error("You don't have permission to do that.");
    }
    return new Error(error?.message || "Something went wrong talking to the server.");
};

export const getFeedbackKindLabel = (kind: string): string => {
    return FEEDBACK_KINDS.find((entry) => entry.value === kind)?.label || kind;
};

export const getFeedbackStatusLabel = (status: string): string => {
    return FEEDBACK_STATUSES.find((entry) => entry.value === status)?.label || status;
};

// Short, plain strings only, so a context object can't grow without bound.
const cleanContext = (context: Record<string, unknown>): Record<string, string> => {
    const clean: Record<string, string> = {};
    Object.entries(context).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
            return;
        }
        clean[key] = String(value).slice(0, MAX_CONTEXT_VALUE_LENGTH);
    });
    return clean;
};

export const submitFeedback = async (
    kind: FeedbackKind,
    message: string,
    context: Record<string, unknown> = {},
): Promise<void> => {
    const client = requireSupabase();
    const trimmed = message.trim();
    if (!trimmed.length) {
        throw new Error("Write a message first.");
    }
    if (trimmed.length > MAX_FEEDBACK_LENGTH) {
        throw new Error(`Keep it under ${MAX_FEEDBACK_LENGTH} characters.`);
    }

    const { error } = await client
        .from("feedback")
        .insert({ kind, message: trimmed, context: cleanContext(context) });
    if (error) {
        throw toFeedbackError(error);
    }
};

export const fetchFeedback = async (limit = 200): Promise<FeedbackRecord[]> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("feedback")
        .select(FEEDBACK_SELECT)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) {
        throw toFeedbackError(error);
    }

    return withDisplayNames((data || []) as FeedbackRecord[]);
};

// Sender and responder display names (profiles are publicly readable).
const withDisplayNames = async (records: FeedbackRecord[]): Promise<FeedbackRecord[]> => {
    const ids = Array.from(new Set(records.flatMap((record) => [record.user_id, record.responded_by]).filter(Boolean))) as string[];
    if (!ids.length) {
        return records;
    }
    const { data: profiles } = await requireSupabase()
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
    const names = new Map((profiles || []).map((profile: any) => [profile.id, profile.display_name as string | null]));
    return records.map((record) => ({
        ...record,
        sender_name: record.user_id ? names.get(record.user_id) ?? null : null,
        responder_name: record.responded_by ? names.get(record.responded_by) ?? null : null,
    }));
};

// The signed-in user's own feedback, newest first. (The user_id filter matters
// for admins, who can read everyone's.)
export const fetchMyFeedback = async (userId: string, limit = 50): Promise<FeedbackRecord[]> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("feedback")
        .select(FEEDBACK_SELECT)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) {
        throw toFeedbackError(error);
    }
    return withDisplayNames((data || []) as FeedbackRecord[]);
};

// Admins: save (or, with an empty string, clear) the response. The database
// stamps responded_at / responded_by; the saved row comes back.
export const respondToFeedback = async (id: string, response: string): Promise<FeedbackRecord> => {
    const client = requireSupabase();
    const trimmed = response.trim();
    if (trimmed.length > MAX_RESPONSE_LENGTH) {
        throw new Error(`Keep the response under ${MAX_RESPONSE_LENGTH} characters.`);
    }
    const { data, error } = await client
        .from("feedback")
        .update({ response: trimmed.length ? trimmed : null })
        .eq("id", id)
        .select(FEEDBACK_SELECT)
        .single();
    if (error) {
        throw toFeedbackError(error);
    }
    const [record] = await withDisplayNames([data as FeedbackRecord]);
    return record;
};

// ---- unread responses ------------------------------------------------------------
// Which responses a user has already seen is remembered per browser
// (feedback id -> responded_at they saw), so the header can flag new replies.

const seenKey = (userId: string) => `phosphor:feedback-responses-seen:${userId}:v1`;

const readSeen = (userId: string): Record<string, string> => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(seenKey(userId)) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
};

export const getUnreadResponseIds = (records: FeedbackRecord[], userId: string): string[] => {
    const seen = readSeen(userId);
    return records
        .filter((record) => record.response && record.responded_at && seen[record.id] !== record.responded_at)
        .map((record) => record.id);
};

export const markResponsesSeen = (records: FeedbackRecord[], userId: string): void => {
    const seen = readSeen(userId);
    records.forEach((record) => {
        if (record.response && record.responded_at) {
            seen[record.id] = record.responded_at;
        }
    });
    try {
        window.localStorage.setItem(seenKey(userId), JSON.stringify(seen));
    } catch {
        // storage blocked: replies just stay flagged
    }
};

export const updateFeedbackStatus = async (id: string, status: FeedbackStatus): Promise<void> => {
    const client = requireSupabase();
    const { error } = await client.from("feedback").update({ status }).eq("id", id);
    if (error) {
        throw toFeedbackError(error);
    }
};

export const deleteFeedback = async (id: string): Promise<void> => {
    const client = requireSupabase();
    const { error } = await client.from("feedback").delete().eq("id", id);
    if (error) {
        throw toFeedbackError(error);
    }
};
