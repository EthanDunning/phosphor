import type { Session } from "@supabase/supabase-js";
import { hasSupabaseEnv, supabase } from "./supabase";

export type ModuleVisibility = "private" | "unlisted" | "public";
export type ModuleSort = "newest" | "top-rated" | "most-subscribed";
export type ProfileRole = "user" | "admin";
export type AdminLibraryVisibilityFilter = "all" | "public";

export interface ModuleRecord {
    id: string;
    owner_id: string;
    title: string;
    summary: string;
    script_json: any;
    cover_image_url: string | null;
    visibility: ModuleVisibility;
    rating_count: number;
    rating_average: number;
    subscription_count: number;
    published_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SaveModuleInput {
    id?: string;
    ownerId: string;
    title: string;
    summary: string;
    scriptJson: any;
    visibility: ModuleVisibility;
}

export interface UpdateModuleMetadataInput {
    id: string;
    ownerId: string;
    title: string;
    summary: string;
    visibility: ModuleVisibility;
}

export interface UserModuleRating {
    module_id: string;
    rating: number;
}

export interface SearchDiscoverableModulesOptions {
    userId?: string | null;
    role?: ProfileRole;
    adminVisibilityFilter?: AdminLibraryVisibilityFilter;
    limit?: number;
}

const MODULE_SELECT = [
    "id",
    "owner_id",
    "title",
    "summary",
    "script_json",
    "cover_image_url",
    "visibility",
    "rating_count",
    "rating_average",
    "subscription_count",
    "published_at",
    "created_at",
    "updated_at",
].join(", ");

export const MAX_MODULE_TITLE_LENGTH = 120;
export const MAX_MODULE_SUMMARY_LENGTH = 500;

const requireSupabase = () => {
    if (!supabase || !hasSupabaseEnv) {
        throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
    }

    return supabase;
};

const normalizeProfileRole = (role: any): ProfileRole => {
    return role === "admin" ? "admin" : "user";
};

const normalizeModuleRecord = (record: any): ModuleRecord => ({
    ...record,
    rating_average: typeof record?.rating_average === "number"
        ? record.rating_average
        : Number(record?.rating_average || 0),
});

const normalizeModuleTitle = (title: string): string => {
    return title.trim().slice(0, MAX_MODULE_TITLE_LENGTH);
};

const normalizeModuleSummary = (summary: string): string => {
    return summary.trim().slice(0, MAX_MODULE_SUMMARY_LENGTH);
};

export const isModuleLinkShareable = (visibility: ModuleVisibility): boolean => {
    return visibility === "public" || visibility === "unlisted";
};

const getSortableModuleTimestamp = (module: ModuleRecord): number => {
    const primaryTimestamp = new Date(module.published_at || module.updated_at || module.created_at).getTime();
    if (!Number.isNaN(primaryTimestamp)) {
        return primaryTimestamp;
    }

    const fallbackTimestamp = new Date(module.updated_at || module.created_at).getTime();
    return Number.isNaN(fallbackTimestamp) ? 0 : fallbackTimestamp;
};

const sortModuleRecords = (modules: ModuleRecord[], sort: ModuleSort): ModuleRecord[] => {
    return [...modules].sort((left, right) => {
        if (sort === "top-rated") {
            if (right.rating_average !== left.rating_average) {
                return right.rating_average - left.rating_average;
            }
            if (right.rating_count !== left.rating_count) {
                return right.rating_count - left.rating_count;
            }
        } else if (sort === "most-subscribed") {
            if (right.subscription_count !== left.subscription_count) {
                return right.subscription_count - left.subscription_count;
            }
            if (right.rating_average !== left.rating_average) {
                return right.rating_average - left.rating_average;
            }
        }

        return getSortableModuleTimestamp(right) - getSortableModuleTimestamp(left);
    });
};

const escapeModuleQuery = (queryText: string): string => {
    return queryText
        .replace(/[%_]/g, "\\$&")
        .replace(/,/g, "\\,");
};

const applyModuleSort = (query: any, sort: ModuleSort): any => {
    if (sort === "top-rated") {
        return query
            .order("rating_average", { ascending: false })
            .order("rating_count", { ascending: false })
            .order("published_at", { ascending: false, nullsFirst: false });
    }

    if (sort === "most-subscribed") {
        return query
            .order("subscription_count", { ascending: false })
            .order("rating_average", { ascending: false })
            .order("published_at", { ascending: false, nullsFirst: false });
    }

    return query
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false });
};

const applyAdminModuleSort = (query: any, sort: ModuleSort): any => {
    if (sort === "top-rated") {
        return query
            .order("rating_average", { ascending: false })
            .order("rating_count", { ascending: false })
            .order("updated_at", { ascending: false });
    }

    if (sort === "most-subscribed") {
        return query
            .order("subscription_count", { ascending: false })
            .order("rating_average", { ascending: false })
            .order("updated_at", { ascending: false });
    }

    return query
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false });
};

export const isSupabaseConfigured = (): boolean => {
    return !!supabase && hasSupabaseEnv;
};

export const getCurrentSession = async (): Promise<Session | null> => {
    const client = requireSupabase();
    const { data, error } = await client.auth.getSession();
    if (error) {
        throw error;
    }

    return data.session;
};

export const onAuthStateChange = (
    callback: (session: Session | null) => void
): { unsubscribe: () => void } => {
    const client = requireSupabase();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
        callback(session);
    });

    return {
        unsubscribe: () => data.subscription.unsubscribe(),
    };
};

export const signInWithGoogle = async (redirectTo: string): Promise<void> => {
    const client = requireSupabase();
    const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo,
        },
    });

    if (error) {
        throw error;
    }
};

export const signOut = async (): Promise<void> => {
    const client = requireSupabase();
    const { error } = await client.auth.signOut();
    if (error) {
        throw error;
    }
};

export const getProfileRole = async (userId: string): Promise<ProfileRole> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return normalizeProfileRole(data?.role);
};

export const listOwnModules = async (ownerId: string): Promise<ModuleRecord[]> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("modules")
        .select(MODULE_SELECT)
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: false });

    if (error) {
        throw error;
    }

    return (data || []).map(normalizeModuleRecord);
};

export const searchPublicModules = async (
    queryText: string,
    sort: ModuleSort,
    limit = 60
): Promise<ModuleRecord[]> => {
    return searchModulesByVisibility(queryText, sort, ["public"], limit);
};

const searchModulesByVisibility = async (
    queryText: string,
    sort: ModuleSort,
    visibility: ModuleVisibility[],
    limit = 60
): Promise<ModuleRecord[]> => {
    const client = requireSupabase();
    let query = client
        .from("modules")
        .select(MODULE_SELECT)
        .in("visibility", visibility);

    const trimmedQuery = queryText.trim();
    if (trimmedQuery.length) {
        const escapedQuery = escapeModuleQuery(trimmedQuery);
        query = query.or(`title.ilike.%${escapedQuery}%,summary.ilike.%${escapedQuery}%`);
    }

    const { data, error } = await applyModuleSort(query, sort).limit(limit);

    if (error) {
        throw error;
    }

    return (data || []).map(normalizeModuleRecord);
};

const searchOwnModules = async (
    ownerId: string,
    queryText: string,
    visibility?: ModuleVisibility[],
    limit = 60
): Promise<ModuleRecord[]> => {
    const client = requireSupabase();
    let query = client
        .from("modules")
        .select(MODULE_SELECT)
        .eq("owner_id", ownerId);

    if (visibility?.length) {
        query = query.in("visibility", visibility);
    }

    const trimmedQuery = queryText.trim();
    if (trimmedQuery.length) {
        const escapedQuery = escapeModuleQuery(trimmedQuery);
        query = query.or(`title.ilike.%${escapedQuery}%,summary.ilike.%${escapedQuery}%`);
    }

    const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    return (data || []).map(normalizeModuleRecord);
};

const searchAllModules = async (
    queryText: string,
    sort: ModuleSort,
    limit?: number
): Promise<ModuleRecord[]> => {
    const client = requireSupabase();
    const trimmedQuery = queryText.trim();
    const escapedQuery = trimmedQuery.length ? escapeModuleQuery(trimmedQuery) : "";
    const pageSize = 1000;
    const requestedLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : null;
    const modules: ModuleRecord[] = [];
    let offset = 0;

    while (true) {
        let query = client
            .from("modules")
            .select(MODULE_SELECT);

        if (escapedQuery.length) {
            query = query.or(`title.ilike.%${escapedQuery}%,summary.ilike.%${escapedQuery}%`);
        }

        const currentPageSize = requestedLimit
            ? Math.min(pageSize, requestedLimit - modules.length)
            : pageSize;
        if (currentPageSize <= 0) {
            break;
        }

        const end = offset + currentPageSize - 1;
        const { data, error } = await applyAdminModuleSort(query, sort).range(offset, end);
        if (error) {
            throw error;
        }

        const normalizedPage = (data || []).map(normalizeModuleRecord);
        modules.push(...normalizedPage);

        if (normalizedPage.length < currentPageSize) {
            break;
        }

        offset += normalizedPage.length;
    }

    return modules;
};

export const searchDiscoverableModules = async (
    queryText: string,
    sort: ModuleSort,
    options?: SearchDiscoverableModulesOptions
): Promise<ModuleRecord[]> => {
    const userId = options?.userId || null;
    const role = options?.role || "user";
    const adminVisibilityFilter = options?.adminVisibilityFilter || "public";
    const limit = options?.limit;

    if (role === "admin" && userId) {
        return adminVisibilityFilter === "all"
            ? searchAllModules(queryText, sort, limit)
            : searchPublicModules(queryText, sort, limit ?? 60);
    }

    if (!userId) {
        return searchPublicModules(queryText, sort, limit ?? 60);
    }

    const effectiveLimit = limit ?? 60;
    const [publicModules, ownPrivateModules] = await Promise.all([
        searchPublicModules(queryText, sort, effectiveLimit),
        searchOwnModules(userId, queryText, ["private"], effectiveLimit),
    ]);

    const mergedModules = new Map<string, ModuleRecord>();
    [...publicModules, ...ownPrivateModules].forEach((module) => {
        mergedModules.set(module.id, module);
    });

    return sortModuleRecords(Array.from(mergedModules.values()), sort).slice(0, effectiveLimit);
};

export const searchModulesByOwner = async (
    ownerId: string,
    queryText: string,
    sort: ModuleSort,
    options?: { userId?: string | null; role?: ProfileRole; limit?: number }
): Promise<ModuleRecord[]> => {
    const client = requireSupabase();
    const viewerId = options?.userId || null;
    const role = options?.role || "user";
    const limit = options?.limit ?? 200;
    const isOwnerViewing = !!viewerId && viewerId === ownerId;
    const canSeeAllOfOwner = isOwnerViewing || role === "admin";

    let query = client
        .from("modules")
        .select(MODULE_SELECT)
        .eq("owner_id", ownerId);

    // Owners (viewing their own uploads) and admins see the full catalog for
    // that user. Everyone else may only discover public modules: unlisted stay
    // link-only and private stay hidden (RLS would otherwise return unlisted
    // rows to everyone).
    if (!canSeeAllOfOwner) {
        query = query.eq("visibility", "public");
    }

    const trimmedQuery = queryText.trim();
    if (trimmedQuery.length) {
        const escapedQuery = escapeModuleQuery(trimmedQuery);
        query = query.or(`title.ilike.%${escapedQuery}%,summary.ilike.%${escapedQuery}%`);
    }

    const { data, error } = await applyModuleSort(query, sort).limit(limit);

    if (error) {
        throw error;
    }

    return (data || []).map(normalizeModuleRecord);
};

export const fetchPublicModulesByIds = async (moduleIds: string[]): Promise<ModuleRecord[]> => {
    const client = requireSupabase();
    if (!moduleIds.length) {
        return [];
    }

    const { data, error } = await client
        .from("modules")
        .select(MODULE_SELECT)
        .in("id", moduleIds);

    if (error) {
        throw error;
    }

    const modulesById = new Map<string, ModuleRecord>();
    (data || []).map(normalizeModuleRecord).forEach((module) => {
        modulesById.set(module.id, module);
    });

    return moduleIds
        .map((moduleId) => modulesById.get(moduleId) || null)
        .filter((module): module is ModuleRecord => !!module);
};

export const fetchPublicModuleById = async (moduleId: string): Promise<ModuleRecord | null> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("modules")
        .select(MODULE_SELECT)
        .eq("id", moduleId)
        .eq("visibility", "public")
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data ? normalizeModuleRecord(data) : null;
};

export const fetchAccessibleModuleById = async (
    moduleId: string,
    userId?: string | null,
    options?: {
        role?: ProfileRole;
    }
): Promise<ModuleRecord | null> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("modules")
        .select(MODULE_SELECT)
        .eq("id", moduleId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        return null;
    }

    const module = normalizeModuleRecord(data);
    if (isModuleLinkShareable(module.visibility)) {
        return module;
    }

    if (options?.role === "admin" && userId) {
        return module;
    }

    return userId && module.owner_id === userId ? module : null;
};

export const listUserSubscriptions = async (userId: string): Promise<string[]> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("module_subscriptions")
        .select("module_id")
        .eq("user_id", userId);

    if (error) {
        throw error;
    }

    return (data || [])
        .map((entry: any) => entry?.module_id)
        .filter((moduleId: any): moduleId is string => typeof moduleId === "string");
};

export const listSubscribedModules = async (userId: string): Promise<ModuleRecord[]> => {
    const moduleIds = await listUserSubscriptions(userId);
    return fetchPublicModulesByIds(moduleIds);
};

export const listUserRatings = async (userId: string): Promise<Record<string, number>> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("module_ratings")
        .select("module_id, rating")
        .eq("user_id", userId);

    if (error) {
        throw error;
    }

    return (data || []).reduce((acc: Record<string, number>, entry: any) => {
        if (typeof entry?.module_id === "string" && typeof entry?.rating === "number") {
            acc[entry.module_id] = entry.rating;
        }
        return acc;
    }, {});
};

const MAX_SCRIPT_JSON_BYTES = 5 * 1024 * 1024; // 5 MB

export const saveModule = async (input: SaveModuleInput): Promise<ModuleRecord> => {
    const client = requireSupabase();

    const jsonText = JSON.stringify(input.scriptJson);
    const jsonSize = new Blob([jsonText]).size;
    if (jsonSize > MAX_SCRIPT_JSON_BYTES) {
        throw new Error("Script JSON is too large. Maximum size is 5 MB.");
    }

    const isUpdate = !!input.id;
    const payload = {
        owner_id: input.ownerId,
        title: normalizeModuleTitle(input.title),
        summary: normalizeModuleSummary(input.summary),
        script_json: input.scriptJson,
        visibility: input.visibility,
    };

    console.log(`[Phosphor] saveModule ${isUpdate ? "update" : "insert"} requested`, {
        mode: isUpdate ? "update" : "insert",
        moduleId: input.id || null,
        ownerId: input.ownerId,
        title: input.title,
        titleLength: input.title.trim().length,
        summaryLength: input.summary.trim().length,
        visibility: input.visibility,
        scriptJsonSizeBytes: jsonSize,
        screenCount: Array.isArray(input.scriptJson?.screens) ? input.scriptJson.screens.length : 0,
        dialogCount: Array.isArray(input.scriptJson?.dialogs) ? input.scriptJson.dialogs.length : 0,
    });
    console.log("[Phosphor] saveModule sanitized payload", payload);

    if (isUpdate) {
        const { data, error } = await client
            .from("modules")
            .update(payload)
            .eq("id", input.id)
            .eq("owner_id", input.ownerId)
            .select(MODULE_SELECT)
            .single();

        if (error) {
            console.error("[Phosphor] saveModule update failed", {
                message: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint,
                error,
            });
            throw error;
        }

        const savedModule = normalizeModuleRecord(data as any);
        console.log("[Phosphor] saveModule update succeeded", {
            moduleId: savedModule.id,
            updatedAt: savedModule.updated_at,
        });
        return savedModule;
    }

    const { data, error } = await client
        .from("modules")
        .insert(payload)
        .select(MODULE_SELECT)
        .single();

    if (error) {
        console.error("[Phosphor] saveModule insert failed", {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
            error,
        });
        throw error;
    }

    const savedModule = normalizeModuleRecord(data as any);
    console.log("[Phosphor] saveModule insert succeeded", {
        moduleId: savedModule.id,
        updatedAt: savedModule.updated_at,
    });
    return savedModule;
};

export const updateModuleMetadata = async (input: UpdateModuleMetadataInput): Promise<ModuleRecord> => {
    const client = requireSupabase();
    const { data, error } = await client
        .from("modules")
        .update({
            title: normalizeModuleTitle(input.title),
            summary: normalizeModuleSummary(input.summary),
            visibility: input.visibility,
        })
        .eq("id", input.id)
        .eq("owner_id", input.ownerId)
        .select(MODULE_SELECT)
        .single();

    if (error) {
        throw error;
    }

    return normalizeModuleRecord(data);
};

export const deleteModule = async (moduleId: string, ownerId: string): Promise<void> => {
    const client = requireSupabase();
    // Return the deleted rows so we can tell a real delete apart from a
    // row-level-security no-op: when RLS filters a DELETE, Postgres reports
    // success with zero rows affected and no error, which would otherwise look
    // like the delete worked when it silently did nothing.
    const { data, error } = await client
        .from("modules")
        .delete()
        .eq("id", moduleId)
        .eq("owner_id", ownerId)
        .select("id");

    if (error) {
        throw error;
    }

    if (!data || !data.length) {
        throw new Error(
            "The module was not deleted — you do not have permission to delete it. "
            + "If you are an admin, make sure the \"admins can delete all modules\" "
            + "row-level-security policy has been applied to your database."
        );
    }
};

export const subscribeToModule = async (moduleId: string, userId: string): Promise<void> => {
    const client = requireSupabase();
    const { error } = await client
        .from("module_subscriptions")
        .upsert({
            module_id: moduleId,
            user_id: userId,
        }, {
            onConflict: "module_id,user_id",
        });

    if (error) {
        throw error;
    }
};

export const unsubscribeFromModule = async (moduleId: string, userId: string): Promise<void> => {
    const client = requireSupabase();
    const { error } = await client
        .from("module_subscriptions")
        .delete()
        .eq("module_id", moduleId)
        .eq("user_id", userId);

    if (error) {
        throw error;
    }
};

export const rateModule = async (moduleId: string, userId: string, rating: number): Promise<void> => {
    const client = requireSupabase();
    const { error } = await client
        .from("module_ratings")
        .upsert({
            module_id: moduleId,
            user_id: userId,
            rating,
        }, {
            onConflict: "module_id,user_id",
        });

    if (error) {
        throw error;
    }
};
