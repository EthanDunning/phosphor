import { hasSupabaseEnv, supabase } from "./supabase";

// Usernames (profiles.username) and module credits (owner + tagged co-authors
// in public.module_authors). See supabase/schema.sql for the rules the
// database enforces; the checks here only give friendlier messages first.

export interface AuthorRef {
    id: string;
    username: string;
}

export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 32;
export const MAX_CO_AUTHORS = 8;

const USERNAME_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9 _.\-]*$/;
const RESERVED_USERNAMES = ["admin", "administrator", "phosphor", "support", "moderator", "system", "staff"];

const requireSupabase = () => {
    if (!supabase || !hasSupabaseEnv) {
        throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
    }
    return supabase;
};

const isMissingSchema = (error: any): boolean => {
    const code = error?.code;
    return code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205";
};

const toAuthorError = (error: any): Error => {
    if (isMissingSchema(error)) {
        return new Error("Usernames aren't set up yet. Run supabase/schema.sql in the Supabase SQL editor.");
    }
    if (error?.code === "23505") {
        return new Error("That username is taken.");
    }
    if (error?.code === "23514") {
        return new Error("That username isn't allowed.");
    }
    if (error?.code === "42501") {
        return new Error("You don't have permission to do that.");
    }
    if (error?.code === "P0001" && typeof error?.message === "string") {
        return new Error(error.message);
    }
    return new Error(error?.message || "Something went wrong talking to the server.");
};

// null when the name is fine, otherwise a message for the user
export const validateUsername = (raw: string): string | null => {
    const name = raw.trim();
    if (name.length < USERNAME_MIN_LENGTH || name.length > USERNAME_MAX_LENGTH) {
        return `Usernames are ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`;
    }
    if (!USERNAME_PATTERN.test(name)) {
        return "Use letters, numbers, spaces, _ . or - (an optional @ at the start).";
    }
    if (/\s{2,}/.test(name)) {
        return "Only single spaces, please.";
    }
    if (RESERVED_USERNAMES.includes(name.replace(/^@/, "").toLowerCase())) {
        return "That username is reserved.";
    }
    return null;
};

export const getUsername = async (userId: string): Promise<string | null> => {
    const client = requireSupabase();
    const { data, error } = await client.from("profiles").select("username").eq("id", userId).maybeSingle();
    if (error) {
        if (isMissingSchema(error)) {
            return null;
        }
        throw toAuthorError(error);
    }
    return (data as any)?.username ?? null;
};

export const updateUsername = async (userId: string, raw: string): Promise<string> => {
    const name = raw.trim();
    const problem = validateUsername(name);
    if (problem) {
        throw new Error(problem);
    }
    const client = requireSupabase();
    const { data, error } = await client
        .from("profiles")
        .update({ username: name })
        .eq("id", userId)
        .select("username")
        .single();
    if (error) {
        throw toAuthorError(error);
    }
    return (data as any).username;
};

// Co-authors are added by their FULL account id (shown in their own account
// menu) - there is deliberately no way to search or list usernames, so the
// site doesn't reveal who has an account.
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const normalizeAccountId = (raw: string): string | null => {
    const id = raw.trim().replace(/^#/, "").toLowerCase();
    return ACCOUNT_ID_PATTERN.test(id) ? id : null;
};

export const findAccountById = async (accountId: string): Promise<AuthorRef | null> => {
    const id = normalizeAccountId(accountId);
    if (!id) {
        return null;
    }
    const { data, error } = await requireSupabase().rpc("find_account_by_id", { account_id: id });
    if (error) {
        throw toAuthorError(error);
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row && row.username ? { id: row.id, username: row.username } : null;
};

const fetchUsernames = async (ids: string[]): Promise<Map<string, string>> => {
    const names = new Map<string, string>();
    if (!ids.length) {
        return names;
    }
    const { data, error } = await requireSupabase().from("profiles").select("id, username").in("id", ids);
    if (error) {
        throw error;
    }
    (data || []).forEach((profile: any) => {
        if (profile.username) {
            names.set(profile.id, profile.username);
        }
    });
    return names;
};

// Credits for many modules at once: owner first, then co-authors in order.
// Returns null (so callers fall back to the script's own "author" field) when
// usernames aren't set up in the database yet.
export const fetchModuleCredits = async (
    modules: { id: string; owner_id: string }[],
): Promise<Record<string, AuthorRef[]> | null> => {
    if (!modules.length) {
        return {};
    }
    const client = requireSupabase();
    const moduleIds = modules.map((module) => module.id);
    const { data: rows, error } = await client
        .from("module_authors")
        .select("module_id, user_id, position")
        .in("module_id", moduleIds)
        .order("position");
    if (error) {
        if (isMissingSchema(error)) {
            return null;
        }
        throw error;
    }

    const coAuthors = (rows || []) as { module_id: string; user_id: string; position: number }[];
    let names: Map<string, string>;
    try {
        names = await fetchUsernames(Array.from(new Set([...modules.map((m) => m.owner_id), ...coAuthors.map((row) => row.user_id)])));
    } catch (namesError: any) {
        if (isMissingSchema(namesError)) {
            return null;
        }
        throw namesError;
    }

    const credits: Record<string, AuthorRef[]> = {};
    modules.forEach((module) => {
        const list: AuthorRef[] = [];
        const ownerName = names.get(module.owner_id);
        if (ownerName) {
            list.push({ id: module.owner_id, username: ownerName });
        }
        coAuthors
            .filter((row) => row.module_id === module.id && row.user_id !== module.owner_id)
            .forEach((row) => {
                const name = names.get(row.user_id);
                if (name) {
                    list.push({ id: row.user_id, username: name });
                }
            });
        credits[module.id] = list;
    });
    return credits;
};

export const fetchModuleCoAuthors = async (moduleId: string): Promise<AuthorRef[]> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("module_authors")
        .select("user_id, position")
        .eq("module_id", moduleId)
        .order("position");
    if (error) {
        if (isMissingSchema(error)) {
            return [];
        }
        throw toAuthorError(error);
    }
    const ids = (data || []).map((row: any) => row.user_id as string);
    const names = await fetchUsernames(ids);
    const missing = ids.filter((id) => !names.has(id));
    const resolved = await Promise.all(missing.map((id) => findAccountById(id).catch((): null => null)));
    resolved.forEach((account) => {
        if (account) {
            names.set(account.id, account.username);
        }
    });
    return ids.map((id) => ({ id, username: names.get(id) || "Unknown account" }));
};

// Make the module's co-author list exactly `authors` (in that order).
export const setModuleCoAuthors = async (moduleId: string, authors: AuthorRef[]): Promise<void> => {
    const client = requireSupabase();
    if (authors.length > MAX_CO_AUTHORS) {
        throw new Error(`A module can credit up to ${MAX_CO_AUTHORS} co-authors.`);
    }
    const { data: existing, error: readError } = await client
        .from("module_authors")
        .select("user_id")
        .eq("module_id", moduleId);
    if (readError) {
        throw toAuthorError(readError);
    }

    const wanted = authors.map((author) => author.id);
    const removed = (existing || []).map((row: any) => row.user_id as string).filter((id) => !wanted.includes(id));
    if (removed.length) {
        const { error } = await client.from("module_authors").delete().eq("module_id", moduleId).in("user_id", removed);
        if (error) {
            throw toAuthorError(error);
        }
    }
    if (authors.length) {
        const { error } = await client
            .from("module_authors")
            .upsert(authors.map((author, index) => ({ module_id: moduleId, user_id: author.id, position: index + 1 })), {
                onConflict: "module_id,user_id",
            });
        if (error) {
            throw toAuthorError(error);
        }
    }
};

// A tagged co-author taking their own name off a module.
export const removeMyselfAsCoAuthor = async (moduleId: string, userId: string): Promise<void> => {
    const { error } = await requireSupabase().from("module_authors").delete().eq("module_id", moduleId).eq("user_id", userId);
    if (error) {
        throw toAuthorError(error);
    }
};

// "A", "A & B", "A, B & C"
export const formatCredits = (authors: AuthorRef[]): string => {
    const names = authors.map((author) => author.username);
    if (names.length <= 1) {
        return names[0] || "";
    }
    return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
};
