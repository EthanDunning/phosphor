import { hasSupabaseEnv, supabase } from "./supabase";

// "Show in Script" choices saved to the account (public.user_preferences), so
// they follow the person across browsers and devices. localStorage is still
// used as a fast local copy; this is the source of truth once signed in.

const isMissingSchema = (error: any): boolean => {
    const code = error?.code;
    return code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205";
};

export type SavedHiddenScripts =
    | { status: "saved"; ids: string[] }     // the account has a saved list
    | { status: "none" }                     // signed in, nothing saved yet
    | { status: "unsupported" };             // the table doesn't exist yet

export const fetchHiddenScriptIds = async (userId: string): Promise<SavedHiddenScripts> => {
    if (!supabase || !hasSupabaseEnv) {
        return { status: "unsupported" };
    }
    const { data, error } = await supabase
        .from("user_preferences")
        .select("hidden_script_ids")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) {
        if (isMissingSchema(error)) {
            return { status: "unsupported" };
        }
        throw error;
    }
    const ids = (data as any)?.hidden_script_ids;
    return Array.isArray(ids) ? { status: "saved", ids: ids.filter((id: unknown) => typeof id === "string") } : { status: "none" };
};

export const saveHiddenScriptIds = async (userId: string, ids: string[]): Promise<void> => {
    if (!supabase || !hasSupabaseEnv) {
        return;
    }
    const { error } = await supabase
        .from("user_preferences")
        .upsert({ user_id: userId, hidden_script_ids: Array.from(new Set(ids)).slice(0, 1000) }, { onConflict: "user_id" });
    if (error && !isMissingSchema(error)) {
        throw error;
    }
};
