import React, { FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import charEnter01Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charenter_01.wav";
import charEnter02Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charenter_02.wav";
import charEnter03Sfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charenter_03.wav";
import charScrollSfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charscroll.wav";
import charScrollLoopSfx from "../../assets/incr-ss-ark/sound effects/ui_hacking_charscroll_lp.wav";
import powerOnSfx from "../../assets/incr-ss-ark/sound effects/poweron.mp3";
import type { Session } from "@supabase/supabase-js";
import { createPortal } from "react-dom";
import CreatorSelect, { CreatorSelectOption } from "../CreatorSelect";
import {
    AdminLibraryVisibilityFilter,
    deleteModule,
    fetchPublicModulesByIds,
    ModuleRecord,
    ModuleSort,
    ModuleVisibility,
    ProfileRole,
    fetchAccessibleModuleById,
    getCurrentSession,
    getProfileRole,
    isModuleLinkShareable,
    isSupabaseConfigured,
    listOwnModules,
    listUserRatings,
    listUserSubscriptions,
    onAuthStateChange,
    rateModule,
    searchDiscoverableModules,
    searchModulesByOwner,
    signInWithGoogle,
    signOut,
    subscribeToModule,
    unsubscribeFromModule,
    updateModuleMetadata,
} from "../../lib/modules";
import {
    ModulesBrowserFontMode,
    ModulesBrowserViewMode,
    loadPersistedModulesBrowserFontMode,
    loadPersistedModulesBrowserViewMode,
    loadPersistedSoundEnabled,
    persistModulesBrowserFontMode,
    persistModulesBrowserViewMode,
    persistSoundEnabled,
} from "../../lib/preferences";
import { APP_TITLE } from "../../lib/branding";
import { getModulesBrowserUrl, getTerminalAppUrl, isLegacyModulesBrowserPath } from "../../lib/routes";
import {
    THEMES,
    Theme,
    CustomThemeConfig,
    createCustomTheme,
    applyTheme,
    loadPersistedCustomTheme,
    loadPersistedTheme,
    persistCustomTheme,
    persistTheme,
} from "../../themes";
import "./style.scss";

const SORT_OPTIONS: CreatorSelectOption[] = [
    { value: "newest", label: "Newest" },
    { value: "top-rated", label: "Top Rated" },
    { value: "most-subscribed", label: "Most Subscribed" },
];

const RATING_VALUES = [1, 2, 3, 4, 5];
const BROWSER_VIEW_OPTIONS: Array<{ value: ModulesBrowserViewMode; label: string }> = [
    { value: "retro", label: "Retro View" },
    { value: "web", label: "Web View" },
];
const BROWSER_FONT_OPTIONS: Array<{ value: ModulesBrowserFontMode; label: string }> = [
    { value: "retro", label: "VGA Font" },
    { value: "normal", label: "Normal Font" },
];
const TRANSIENT_AUTH_PARAMS = [
    "code",
    "state",
    "error",
    "error_code",
    "error_description",
    "provider_token",
    "provider_refresh_token",
] as const;
const OWNER_MENU_WIDTH = 224;
const OWNER_MENU_HEIGHT = 188;
const SHARE_MENU_WIDTH = 224;
const SHARE_MENU_HEIGHT = 90;
const MAX_AUTHOR_LENGTH = 25;
const OWNER_SHORT_ID_LENGTH = 8;
const MAX_RATING = 5;
const HEADER_OVERFLOW_MAX_LEVEL = 4;

const getModulesBrowserUrlWithTransientAuthParams = (
    params?: Record<string, string | null | undefined>
): string => {
    const nextUrl = new URL(getModulesBrowserUrl(params));

    try {
        const currentUrl = new URL(window.location.href);
        TRANSIENT_AUTH_PARAMS.forEach((param) => {
            const value = currentUrl.searchParams.get(param);
            if (value) {
                nextUrl.searchParams.set(param, value);
            }
        });
    } catch {
        // ignore invalid URLs
    }

    return nextUrl.toString();
};

const getCurrentLibraryReturnUrl = (): string => {
    try {
        const currentUrl = new URL(window.location.href);
        const returnUrl = new URL(getTerminalAppUrl(currentUrl.searchParams.get("module") || undefined));
        currentUrl.searchParams.forEach((value, key) => {
            if ([...TRANSIENT_AUTH_PARAMS, "auth_return"].includes(key as typeof TRANSIENT_AUTH_PARAMS[number] | "auth_return")) {
                return;
            }

            returnUrl.searchParams.set(key, value);
        });
        returnUrl.searchParams.set("auth_return", "library");
        return returnUrl.toString();
    } catch {
        const fallbackUrl = new URL(getTerminalAppUrl());
        fallbackUrl.searchParams.set("auth_return", "library");
        return fallbackUrl.toString();
    }
};

const clearTransientAuthParams = (): void => {
    try {
        const url = new URL(window.location.href);
        let changed = false;
        TRANSIENT_AUTH_PARAMS.forEach((param) => {
            if (url.searchParams.has(param)) {
                url.searchParams.delete(param);
                changed = true;
            }
        });

        if (changed) {
            window.history.replaceState({}, "", url.toString());
        }
    } catch {
        // ignore invalid URLs
    }
};

const parseInitialSort = (): ModuleSort => {
    try {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get("sort");
        if (raw === "top-rated" || raw === "most-subscribed" || raw === "newest") {
            return raw;
        }
    } catch {
        // ignore invalid URLs
    }

    return "newest";
};

const parseInitialSearch = (): string => {
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get("q") || "";
    } catch {
        return "";
    }
};

const parseInitialModuleId = (): string | null => {
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get("module") || null;
    } catch {
        return null;
    }
};

const parseInitialSubscribedOnly = (): boolean => {
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get("subscribed") === "1";
    } catch {
        return false;
    }
};

const parseInitialOwnerFilter = (): string | null => {
    try {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get("owner");
        return raw && raw.trim().length ? raw.trim() : null;
    } catch {
        return null;
    }
};

const formatTimestamp = (value: string | null): string => {
    if (!value) {
        return "unknown";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
};

const getModuleAuthor = (module: ModuleRecord): string => {
    const author = module?.script_json?.config?.author;
    if (typeof author === "string" && author.trim().length) {
        const normalizedAuthor = author.trim();
        if (normalizedAuthor.length <= MAX_AUTHOR_LENGTH) {
            return normalizedAuthor;
        }

        return `${normalizedAuthor.slice(0, MAX_AUTHOR_LENGTH - 3)}...`;
    }

    return "Unknown author";
};

// The uploader's account UUID is the one identity a re-uploader can't fake, so
// we surface a short, stable slice of it next to the (self-declared) author.
const formatOwnerShortId = (ownerId: string | null | undefined): string => {
    if (typeof ownerId !== "string" || !ownerId.trim().length) {
        return "unknown";
    }

    return ownerId.replace(/-/g, "").slice(0, OWNER_SHORT_ID_LENGTH);
};

const getModuleRatingAscii = (ratingAverage: number): string => {
    const normalizedRating = Number.isFinite(ratingAverage)
        ? Math.max(0, Math.min(MAX_RATING, ratingAverage))
        : 0;
    const filledSlots = Math.round(normalizedRating);
    return `[${"*".repeat(filledSlots)}${"-".repeat(MAX_RATING - filledSlots)}]`;
};

const getModuleRatingTitle = (ratingAverage: number): string => {
    const normalizedRating = Number.isFinite(ratingAverage)
        ? Math.max(0, Math.min(MAX_RATING, ratingAverage))
        : 0;
    return `Rating ${normalizedRating.toFixed(1)} / ${MAX_RATING}`;
};

const getModuleRatingNumeric = (ratingAverage: number): string => {
    const normalizedRating = Number.isFinite(ratingAverage)
        ? Math.max(0, Math.min(MAX_RATING, ratingAverage))
        : 0;
    return normalizedRating.toFixed(1);
};

const getSortableModuleTimestamp = (module: ModuleRecord): number => {
    const primaryTimestamp = new Date(module.published_at || module.updated_at || module.created_at).getTime();
    if (!Number.isNaN(primaryTimestamp)) {
        return primaryTimestamp;
    }

    const fallbackTimestamp = new Date(module.updated_at || module.created_at).getTime();
    return Number.isNaN(fallbackTimestamp) ? 0 : fallbackTimestamp;
};

const sortModulesForBrowser = (modules: ModuleRecord[], sort: ModuleSort): ModuleRecord[] => {
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

const ModulesBrowser: FC = () => {
    const supabaseReady = isSupabaseConfigured();
    const initialSelectedModuleId = useMemo(() => parseInitialModuleId(), []);
    const [activeTheme, setActiveTheme] = useState<Theme>(() => loadPersistedTheme());
    const [customTheme, setCustomTheme] = useState<CustomThemeConfig>(() => loadPersistedCustomTheme());
    const [soundEnabled, setSoundEnabled] = useState<boolean>(() => loadPersistedSoundEnabled());
    const [viewMode, setViewMode] = useState<ModulesBrowserViewMode>(() => loadPersistedModulesBrowserViewMode());
    const [fontMode, setFontMode] = useState<ModulesBrowserFontMode>(() => loadPersistedModulesBrowserFontMode());
    const [session, setSession] = useState<Session | null>(null);
    const [authLoading, setAuthLoading] = useState<boolean>(supabaseReady);
    const [catalogLoading, setCatalogLoading] = useState<boolean>(supabaseReady);
    const [actionModuleId, setActionModuleId] = useState<string | null>(null);
    const [query, setQuery] = useState<string>(parseInitialSearch);
    const [sort, setSort] = useState<ModuleSort>(parseInitialSort);
    const [subscribedOnly, setSubscribedOnly] = useState<boolean>(parseInitialSubscribedOnly);
    const [ownerFilter, setOwnerFilter] = useState<string | null>(parseInitialOwnerFilter);
    const [sessionRole, setSessionRole] = useState<ProfileRole>("user");
    const [adminVisibilityFilter, setAdminVisibilityFilter] = useState<AdminLibraryVisibilityFilter>("all");
    const [modules, setModules] = useState<ModuleRecord[]>([]);
    const [selectedModuleId, setSelectedModuleId] = useState<string | null>(initialSelectedModuleId);
    const [subscribedIds, setSubscribedIds] = useState<string[]>([]);
    const [createdModuleCount, setCreatedModuleCount] = useState<number>(0);
    const [ratingsByModuleId, setRatingsByModuleId] = useState<Record<string, number>>({});
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
    const [profileOpen, setProfileOpen] = useState<boolean>(false);
    const [optionsDropdownOpen, setOptionsDropdownOpen] = useState<boolean>(false);
    const [customThemeEditorOpen, setCustomThemeEditorOpen] = useState<boolean>(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
    const [headerOverflowLevel, setHeaderOverflowLevel] = useState<number>(0);
    const [ownerMenuOpen, setOwnerMenuOpen] = useState<boolean>(false);
    const [ownerMenuPosition, setOwnerMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const [shareMenuOpen, setShareMenuOpen] = useState<boolean>(false);
    const [shareMenuPosition, setShareMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState<string>("");
    const [editSummary, setEditSummary] = useState<string>("");

    const soundEnabledRef = useRef(soundEnabled);
    useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

    const charEnterPoolRef = useRef<HTMLAudioElement[]>([]);
    const charScrollPoolRef = useRef<HTMLAudioElement[]>([]);
    const powerOnAudioRef = useRef<HTMLAudioElement | null>(null);
    const audioUnlockedRef = useRef(false);
    const audioAutoplayBlockedRef = useRef(false);
    const scrollLastPlayedAtRef = useRef(0);
    const powerOnPlayedRef = useRef(false);
    const SCROLL_COOLDOWN_MS = 120;

    useEffect(() => {
        const buildPool = (srcs: string[], vol: number, voices = 2): HTMLAudioElement[] => {
            const pool: HTMLAudioElement[] = [];
            srcs.forEach((src) => {
                for (let i = 0; i < voices; i++) {
                    const a = new Audio(src);
                    a.preload = "auto";
                    a.volume = vol;
                    pool.push(a);
                }
            });
            return pool;
        };
        charEnterPoolRef.current = buildPool([charEnter01Sfx, charEnter02Sfx, charEnter03Sfx], 0.1, 2);
        charScrollPoolRef.current = buildPool([charScrollSfx, charScrollLoopSfx], 0.1, 2);
        const powerOn = new Audio(powerOnSfx);
        powerOn.preload = "auto";
        powerOn.volume = 0.4;
        powerOnAudioRef.current = powerOn;
    }, []);

    useEffect(() => {
        if (catalogLoading || powerOnPlayedRef.current || !soundEnabledRef.current) {
            return;
        }
        powerOnPlayedRef.current = true;
        const audio = powerOnAudioRef.current;
        if (!audio) {
            return;
        }
        audio.currentTime = 0;
        audio.play().then(() => {
            audioUnlockedRef.current = true;
            audioAutoplayBlockedRef.current = false;
        }).catch((err: any) => {
            if (err?.name === "NotAllowedError") {
                audioAutoplayBlockedRef.current = true;
            }
        });
    }, [catalogLoading]);

    const playPowerOn = useCallback((): void => {
        if (!soundEnabledRef.current) {
            return;
        }
        const audio = powerOnAudioRef.current;
        if (!audio) {
            return;
        }
        audio.currentTime = 0;
        audio.play().then(() => {
            audioUnlockedRef.current = true;
            audioAutoplayBlockedRef.current = false;
        }).catch(() => {});
    }, []);

    const playFromPool = useCallback((pool: HTMLAudioElement[]): void => {
        if (!soundEnabledRef.current || !pool.length) {
            return;
        }
        if (audioAutoplayBlockedRef.current && !audioUnlockedRef.current) {
            return;
        }
        const available = pool.find((a) => a.paused || a.ended) || pool[Math.floor(Math.random() * pool.length)];
        available.currentTime = 0;
        available.play().then(() => {
            audioUnlockedRef.current = true;
            audioAutoplayBlockedRef.current = false;
        }).catch((err: any) => {
            if (err?.name === "NotAllowedError") {
                audioAutoplayBlockedRef.current = true;
            }
        });
    }, []);

    useEffect(() => {
        const handleClick = (e: MouseEvent): void => {
            const target = e.target as Element | null;
            if (!target) {
                return;
            }
            const isInteractive = target.closest("button, a, input, select, textarea, [role='menuitem'], [role='menuitemradio']");
            if (!isInteractive) {
                return;
            }
            audioUnlockedRef.current = true;
            audioAutoplayBlockedRef.current = false;
            playFromPool(charEnterPoolRef.current);
        };

        const handleWheel = (e: WheelEvent): void => {
            if (!e.deltaY || !soundEnabledRef.current) {
                return;
            }
            const now = Date.now();
            if (now - scrollLastPlayedAtRef.current < SCROLL_COOLDOWN_MS) {
                return;
            }
            scrollLastPlayedAtRef.current = now;
            audioUnlockedRef.current = true;
            audioAutoplayBlockedRef.current = false;
            playFromPool(charScrollPoolRef.current);
        };

        document.addEventListener("click", handleClick);
        window.addEventListener("wheel", handleWheel, { passive: true });
        return () => {
            document.removeEventListener("click", handleClick);
            window.removeEventListener("wheel", handleWheel);
        };
    }, [playFromPool]);

    const sessionUserId = session?.user?.id || null;
    const sessionEmail = session?.user?.email || null;
    const isAdmin = !!sessionUserId && sessionRole === "admin";
    // Admins can manage any module as if they owned it; everyone else only
    // their own uploads.
    const canManageModule = useCallback((module: ModuleRecord | null | undefined): boolean => {
        if (!module || !sessionUserId) {
            return false;
        }
        return module.owner_id === sessionUserId || isAdmin;
    }, [isAdmin, sessionUserId]);
    const subscribedIdSet = useMemo(() => new Set(subscribedIds), [subscribedIds]);
    const selectedModule = useMemo(() => {
        if (!modules.length) {
            return null;
        }

        return modules.find((module) => module.id === selectedModuleId) || modules[0];
    }, [modules, selectedModuleId]);
    const browserClassName = useMemo(() => {
        return [
            "modules-browser",
            viewMode === "web" ? "modules-browser--web-view" : "",
            fontMode === "normal" ? "modules-browser--font-normal" : "",
        ].filter(Boolean).join(" ");
    }, [fontMode, viewMode]);
    const headerRef = useRef<HTMLElement | null>(null);
    const headerTitleRef = useRef<HTMLAnchorElement | null>(null);
    const headerControlsRef = useRef<HTMLDivElement | null>(null);
    const headerOverflowWrapperRef = useRef<HTMLDivElement | null>(null);
    const profileRef = useRef<HTMLDivElement | null>(null);
    const optionsRef = useRef<HTMLDivElement | null>(null);
    const ownerMenuRef = useRef<HTMLDivElement | null>(null);
    const ownerMenuDropdownRef = useRef<HTMLDivElement | null>(null);
    const shareMenuRef = useRef<HTMLDivElement | null>(null);
    const shareMenuDropdownRef = useRef<HTMLDivElement | null>(null);
    const initialRequestedModuleIdRef = useRef<string | null>(initialSelectedModuleId);
    const isBootstrappingAuthRef = useRef<boolean>(true);
    const lastHydratedSessionUserIdRef = useRef<string | null>(null);
    const ownedModulesRef = useRef<ModuleRecord[]>([]);
    const hasCatalogBootstrappedRef = useRef<boolean>(false);

    const setHeaderOverflowLevelClass = useCallback((header: HTMLElement, level: number): void => {
        header.classList.toggle("phosphor-header--compact", level > 0);
        for (let index = 1; index <= HEADER_OVERFLOW_MAX_LEVEL; index += 1) {
            header.classList.remove(`phosphor-header--overflow-${index}`);
        }

        if (level > 0) {
            header.classList.add(`phosphor-header--overflow-${level}`);
        }
    }, []);

    const updateHeaderLayout = useCallback(() => {
        const header = headerRef.current;
        const title = headerTitleRef.current;
        const controls = headerControlsRef.current;
        if (!header || !title || !controls) {
            return;
        }

        let nextOverflowLevel = 0;
        for (let level = 0; level <= HEADER_OVERFLOW_MAX_LEVEL; level += 1) {
            setHeaderOverflowLevelClass(header, level);

            const headerRect = header.getBoundingClientRect();
            const titleRect = title.getBoundingClientRect();
            const controlsRect = controls.getBoundingClientRect();
            const controlChildren = Array.from(controls.children)
                .filter((child): child is HTMLElement => child instanceof HTMLElement)
                .filter((child) => child.offsetParent !== null);

            let controlsVisualLeft = controlsRect.left;
            let controlsVisualRight = controlsRect.right;
            controlChildren.forEach((child) => {
                const childRect = child.getBoundingClientRect();
                controlsVisualLeft = Math.min(controlsVisualLeft, childRect.left);
                controlsVisualRight = Math.max(controlsVisualRight, childRect.right);
            });

            const titleOverlap = controlsVisualLeft < titleRect.right + 8;
            const controlsOutsideHeader = controlsVisualLeft < headerRect.left + 1
                || controlsVisualRight > headerRect.right - 1;
            const fits = !titleOverlap
                && !controlsOutsideHeader
                && header.scrollWidth <= header.clientWidth + 1
                && controls.scrollWidth <= controls.clientWidth + 1;

            if (fits) {
                nextOverflowLevel = level;
                break;
            }

            nextOverflowLevel = HEADER_OVERFLOW_MAX_LEVEL;
        }

        setHeaderOverflowLevelClass(header, nextOverflowLevel);

        if (nextOverflowLevel !== headerOverflowLevel) {
            setHeaderOverflowLevel(nextOverflowLevel);
            setMobileMenuOpen(false);
            setOptionsDropdownOpen(false);
            setProfileOpen(false);
            setCustomThemeEditorOpen(false);
        }
    }, [headerOverflowLevel, setHeaderOverflowLevelClass]);

    const updateOwnerMenuPosition = useCallback(() => {
        const anchor = ownerMenuRef.current;
        if (!anchor) {
            return;
        }

        const rect = anchor.getBoundingClientRect();
        const nextLeft = Math.max(
            8,
            Math.min(rect.right - OWNER_MENU_WIDTH, window.innerWidth - OWNER_MENU_WIDTH - 8)
        );
        const nextTop = rect.bottom + 4 + OWNER_MENU_HEIGHT > window.innerHeight - 8
            ? Math.max(8, rect.top - OWNER_MENU_HEIGHT - 4)
            : rect.bottom + 4;

        setOwnerMenuPosition({
            top: nextTop,
            left: nextLeft,
        });
    }, []);

    const updateShareMenuPosition = useCallback(() => {
        const anchor = shareMenuRef.current;
        if (!anchor) {
            return;
        }

        const rect = anchor.getBoundingClientRect();
        const nextLeft = Math.max(
            8,
            Math.min(rect.right - SHARE_MENU_WIDTH, window.innerWidth - SHARE_MENU_WIDTH - 8)
        );
        const nextTop = rect.bottom + 4 + SHARE_MENU_HEIGHT > window.innerHeight - 8
            ? Math.max(8, rect.top - SHARE_MENU_HEIGHT - 4)
            : rect.bottom + 4;

        setShareMenuPosition({
            top: nextTop,
            left: nextLeft,
        });
    }, []);

    const persistBrowserQuery = useCallback((
        nextQuery: string,
        nextSort: ModuleSort,
        nextSubscribedOnly: boolean,
        nextModuleId: string | null,
        nextOwnerFilter: string | null
    ) => {
        const params: Record<string, string | undefined> = {
            q: nextQuery.trim() || undefined,
            sort: nextSort !== "most-subscribed" ? nextSort : undefined,
            subscribed: nextSubscribedOnly ? "1" : undefined,
            module: nextModuleId || undefined,
            owner: nextOwnerFilter || undefined,
        };
        window.history.replaceState({}, "", getModulesBrowserUrlWithTransientAuthParams(params));
    }, []);

    const loadPersonalState = useCallback(async (userId: string) => {
        const [nextSubscribedIds, nextRatingsByModuleId, ownModules, role] = await Promise.all([
            listUserSubscriptions(userId),
            listUserRatings(userId),
            listOwnModules(userId),
            getProfileRole(userId),
        ]);

        setSubscribedIds(nextSubscribedIds);
        setRatingsByModuleId(nextRatingsByModuleId);
        ownedModulesRef.current = ownModules;
        setCreatedModuleCount(ownModules.length);
        setSessionRole(role);

        return {
            subscribedIds: nextSubscribedIds,
            ratingsByModuleId: nextRatingsByModuleId,
            ownModules,
            createdModuleCount: ownModules.length,
            role,
        };
    }, []);

    const refreshCatalog = useCallback(async (
        currentUserId?: string | null,
        currentSubscribedIds?: string[],
        currentOwnModules?: ModuleRecord[],
        currentRole: ProfileRole = "user"
    ) => {
        if (!supabaseReady) {
            setCatalogLoading(false);
            return;
        }

        setCatalogLoading(true);
        try {
            const catalogLimit: number | undefined = currentRole === "admin" && adminVisibilityFilter === "all"
                ? undefined
                : 80;
            let nextModules: ModuleRecord[];

            if (ownerFilter) {
                // Owner filter: show every module the given uploader has that is
                // discoverable to this viewer, ignoring the own/subscribed merge
                // and deep-link injection so the list stays true to that user.
                nextModules = await searchModulesByOwner(ownerFilter, query, sort, {
                    userId: currentUserId,
                    role: currentRole,
                    limit: catalogLimit,
                });
            } else {
                nextModules = await searchDiscoverableModules(query, sort, {
                    userId: currentUserId,
                    role: currentRole,
                    adminVisibilityFilter: adminVisibilityFilter,
                    limit: catalogLimit,
                });

                if (currentUserId) {
                    const subscribedIds = currentSubscribedIds || [];
                    const [ownModules, subscribedModules] = await Promise.all([
                        Promise.resolve(currentOwnModules ?? ownedModulesRef.current),
                        subscribedIds.length ? fetchPublicModulesByIds(subscribedIds) : Promise.resolve([] as ModuleRecord[]),
                    ]);

                    const mergedModules = new Map<string, ModuleRecord>();
                    nextModules.forEach((module) => {
                        mergedModules.set(module.id, module);
                    });
                    ownModules.forEach((module) => {
                        mergedModules.set(module.id, module);
                    });
                    subscribedModules.forEach((module) => {
                        mergedModules.set(module.id, module);
                    });
                    nextModules = sortModulesForBrowser(Array.from(mergedModules.values()), sort);
                }

                const requestedModuleId = initialRequestedModuleIdRef.current;
                if (requestedModuleId && !nextModules.some((module) => module.id === requestedModuleId)) {
                    const linkedModule = await fetchAccessibleModuleById(requestedModuleId, currentUserId, {
                        role: currentRole,
                    });
                    if (linkedModule) {
                        nextModules = [linkedModule, ...nextModules];
                    } else {
                        initialRequestedModuleIdRef.current = null;
                    }
                }
            }

            if (subscribedOnly) {
                const ids = currentSubscribedIds || [];
                const subscribedLookup = new Set(ids);
                nextModules = currentUserId
                    ? nextModules.filter((module) => {
                        return subscribedLookup.has(module.id) || module.owner_id === currentUserId;
                    })
                    : [];
            }

            setModules(nextModules);
            setErrorMessage(null);
        } catch (error: any) {
            setErrorMessage(error?.message || "Could not load modules.");
        } finally {
            setCatalogLoading(false);
        }
    }, [adminVisibilityFilter, ownerFilter, query, sort, subscribedOnly, supabaseReady]);

    const handleOwnerFilterSelect = useCallback((ownerId: string | null | undefined) => {
        if (typeof ownerId !== "string" || !ownerId.trim().length) {
            return;
        }

        // Jump to a clean "everything by this uploader" view: drop the text
        // query and the subscribed-only filter so nothing narrows the results.
        setOwnerFilter(ownerId.trim());
        setQuery("");
        setSubscribedOnly(false);
        setMobileMenuOpen(false);
        playPowerOn();
    }, [playPowerOn]);

    useEffect(() => {
        applyTheme(activeTheme);
    }, [activeTheme]);

    useEffect(() => {
        if (!profileOpen && !optionsDropdownOpen && !mobileMenuOpen && !ownerMenuOpen && !shareMenuOpen) {
            return;
        }

        const handleDocumentMouseDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }
            const overflowWrapper = target instanceof Element
                ? target.closest(".phosphor-header__overflow-wrapper")
                : null;

            if (profileOpen && profileRef.current && !profileRef.current.contains(target)) {
                if (!(headerOverflowLevel > 0 && overflowWrapper)) {
                    setProfileOpen(false);
                }
            }

            if (optionsDropdownOpen && optionsRef.current && !optionsRef.current.contains(target)) {
                if (!(headerOverflowLevel > 0 && overflowWrapper)) {
                    setOptionsDropdownOpen(false);
                    setCustomThemeEditorOpen(false);
                }
            }

            if (
                ownerMenuOpen
                && ownerMenuRef.current
                && !ownerMenuRef.current.contains(target)
                && (!ownerMenuDropdownRef.current || !ownerMenuDropdownRef.current.contains(target))
            ) {
                setOwnerMenuOpen(false);
            }

            if (
                shareMenuOpen
                && shareMenuRef.current
                && !shareMenuRef.current.contains(target)
                && (!shareMenuDropdownRef.current || !shareMenuDropdownRef.current.contains(target))
            ) {
                setShareMenuOpen(false);
            }

            if (mobileMenuOpen
                && headerRef.current
                && !headerRef.current.contains(target)
                && !(headerOverflowLevel > 0 && overflowWrapper)) {
                setMobileMenuOpen(false);
                setProfileOpen(false);
                setOptionsDropdownOpen(false);
                setCustomThemeEditorOpen(false);
                setOwnerMenuOpen(false);
                setShareMenuOpen(false);
            }
        };

        const handleDocumentKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setProfileOpen(false);
                setOptionsDropdownOpen(false);
                setCustomThemeEditorOpen(false);
                setMobileMenuOpen(false);
                setOwnerMenuOpen(false);
                setShareMenuOpen(false);
            }
        };

        document.addEventListener("mousedown", handleDocumentMouseDown);
        document.addEventListener("keydown", handleDocumentKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleDocumentMouseDown);
            document.removeEventListener("keydown", handleDocumentKeyDown);
        };
    }, [headerOverflowLevel, mobileMenuOpen, optionsDropdownOpen, ownerMenuOpen, profileOpen, shareMenuOpen]);

    useEffect(() => {
        if (!ownerMenuOpen) {
            setOwnerMenuPosition(null);
            return;
        }

        updateOwnerMenuPosition();
        const handleViewportChange = () => {
            updateOwnerMenuPosition();
        };

        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);
        return () => {
            window.removeEventListener("resize", handleViewportChange);
            window.removeEventListener("scroll", handleViewportChange, true);
        };
    }, [ownerMenuOpen, updateOwnerMenuPosition]);

    useEffect(() => {
        if (!shareMenuOpen) {
            setShareMenuPosition(null);
            return;
        }

        updateShareMenuPosition();
        const handleViewportChange = () => {
            updateShareMenuPosition();
        };

        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);
        return () => {
            window.removeEventListener("resize", handleViewportChange);
            window.removeEventListener("scroll", handleViewportChange, true);
        };
    }, [shareMenuOpen, updateShareMenuPosition]);

    useLayoutEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        let rafId = window.requestAnimationFrame(updateHeaderLayout);
        const handleViewportChange = () => {
            window.cancelAnimationFrame(rafId);
            rafId = window.requestAnimationFrame(updateHeaderLayout);
        };

        window.addEventListener("resize", handleViewportChange);
        return () => {
            window.cancelAnimationFrame(rafId);
            window.removeEventListener("resize", handleViewportChange);
        };
    }, [
        authLoading,
        createdModuleCount,
        fontMode,
        headerOverflowLevel,
        isAdmin,
        mobileMenuOpen,
        optionsDropdownOpen,
        profileOpen,
        query,
        sessionEmail,
        sessionRole,
        sort,
        subscribedOnly,
        updateHeaderLayout,
        viewMode,
    ]);

    useEffect(() => {
        if (isAdmin) {
            return;
        }
        setAdminVisibilityFilter("all");
    }, [isAdmin]);

    useEffect(() => {
        if (!selectedModule || isModuleLinkShareable(selectedModule.visibility)) {
            return;
        }
        if (shareMenuOpen) {
            setShareMenuOpen(false);
        }
    }, [selectedModule, shareMenuOpen]);

    useEffect(() => {
        if (!isLegacyModulesBrowserPath()) {
            return;
        }

        try {
            const currentUrl = new URL(window.location.href);
            const nextUrl = new URL(getModulesBrowserUrl());
            nextUrl.search = currentUrl.search;
            nextUrl.hash = currentUrl.hash;
            window.history.replaceState({}, "", nextUrl.toString());
        } catch {
            // ignore invalid URLs
        }
    }, []);

    useEffect(() => {
        if (!supabaseReady) {
            setAuthLoading(false);
            setCatalogLoading(false);
            hasCatalogBootstrappedRef.current = true;
            isBootstrappingAuthRef.current = false;
            return;
        }

        let mounted = true;
        isBootstrappingAuthRef.current = true;
        const initialize = async () => {
            try {
                const nextSession = await getCurrentSession();
                if (!mounted) {
                    return;
                }

                setSession(nextSession);
                setAuthLoading(false);
                lastHydratedSessionUserIdRef.current = nextSession?.user?.id || null;

                if (nextSession?.user?.id) {
                    await loadPersonalState(nextSession.user.id);
                }

                if (mounted) {
                    hasCatalogBootstrappedRef.current = true;
                }
            } catch (error: any) {
                if (!mounted) {
                    return;
                }
                setAuthLoading(false);
                setCatalogLoading(false);
                setErrorMessage(error?.message || "Could not initialize the modules browser.");
            } finally {
                clearTransientAuthParams();
                isBootstrappingAuthRef.current = false;
            }
        };

        void initialize();

        const subscription = onAuthStateChange((nextSession) => {
            if (!mounted) {
                return;
            }

            if (isBootstrappingAuthRef.current) {
                return;
            }

            const nextSessionUserId = nextSession?.user?.id || null;
            if (lastHydratedSessionUserIdRef.current === nextSessionUserId) {
                return;
            }
            lastHydratedSessionUserIdRef.current = nextSessionUserId;
            hasCatalogBootstrappedRef.current = true;

            setSession(nextSession);
            setAuthLoading(false);

            if (!nextSession?.user?.id) {
                setSubscribedIds([]);
                setRatingsByModuleId({});
                setCreatedModuleCount(0);
                setSessionRole("user");
                setProfileOpen(false);
                if (subscribedOnly) {
                    setSubscribedOnly(false);
                }
                hasCatalogBootstrappedRef.current = true;
                return;
            }

            void loadPersonalState(nextSession.user.id).then(() => {
                hasCatalogBootstrappedRef.current = true;
            }).catch((error: any) => {
                setErrorMessage(error?.message || "Could not refresh your module state.");
            });
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [loadPersonalState, refreshCatalog, subscribedOnly, supabaseReady]);

    useEffect(() => {
        persistBrowserQuery(query, sort, subscribedOnly, selectedModuleId, ownerFilter);
    }, [persistBrowserQuery, query, selectedModuleId, sort, subscribedOnly, ownerFilter]);

    useEffect(() => {
        if (authLoading || !hasCatalogBootstrappedRef.current) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            void refreshCatalog(sessionUserId, subscribedIds, ownedModulesRef.current, sessionRole);
        }, 350);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [authLoading, refreshCatalog, sessionRole, sessionUserId, subscribedIds]);

    useEffect(() => {
        if (!noticeMessage) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setNoticeMessage(null);
        }, 5000);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [noticeMessage]);

    useEffect(() => {
        if (!modules.length) {
            if (!catalogLoading && selectedModuleId !== null) {
                setSelectedModuleId(null);
            }
            return;
        }

        if (!selectedModuleId || !modules.some((module) => module.id === selectedModuleId)) {
            setSelectedModuleId(modules[0].id);
        }
    }, [catalogLoading, modules, selectedModuleId]);

    useEffect(() => {
        setOwnerMenuOpen(false);
        setOwnerMenuPosition(null);
        if (!selectedModule || editingModuleId !== selectedModule.id) {
            setEditingModuleId(null);
            setEditTitle("");
            setEditSummary("");
        }
    }, [editingModuleId, selectedModule]);

    const handleSignIn = async (): Promise<void> => {
        if (!supabaseReady) {
            setErrorMessage("Supabase is not configured in this environment.");
            return;
        }

        setMobileMenuOpen(false);
        setProfileOpen(false);
        setOptionsDropdownOpen(false);
        setCustomThemeEditorOpen(false);
        setErrorMessage(null);
        setNoticeMessage(null);
        try {
            await signInWithGoogle(getCurrentLibraryReturnUrl());
        } catch (error: any) {
            setErrorMessage(error?.message || "Could not start Google sign-in.");
        }
    };

    const handleSignOut = async (): Promise<void> => {
        setMobileMenuOpen(false);
        setProfileOpen(false);
        setOptionsDropdownOpen(false);
        setCustomThemeEditorOpen(false);
        setErrorMessage(null);
        setNoticeMessage(null);
        try {
            await signOut();
            setCreatedModuleCount(0);
            setNoticeMessage("Signed out.");
        } catch (error: any) {
            setErrorMessage(error?.message || "Could not sign out.");
        }
    };

    const handleOptionsDropdownToggle = (): void => {
        setOptionsDropdownOpen((prev) => !prev);
        setCustomThemeEditorOpen(false);
        setProfileOpen(false);
    };

    const handleSoundToggle = (): void => {
        setSoundEnabled((prev) => {
            const nextValue = !prev;
            persistSoundEnabled(nextValue);
            return nextValue;
        });
    };

    const handleViewModeChange = (nextViewMode: ModulesBrowserViewMode): void => {
        persistModulesBrowserViewMode(nextViewMode);
        setViewMode(nextViewMode);
    };

    const handleFontModeChange = (nextFontMode: ModulesBrowserFontMode): void => {
        persistModulesBrowserFontMode(nextFontMode);
        setFontMode(nextFontMode);
    };

    const handleThemeSelect = (themeId: string): void => {
        if (themeId === "custom") {
            setCustomTheme((prevCustomTheme) => {
                const baseThemeId = activeTheme.id === "custom"
                    ? prevCustomTheme.baseThemeId
                    : activeTheme.id;
                const nextCustomTheme: CustomThemeConfig = {
                    ...prevCustomTheme,
                    baseThemeId,
                };
                const nextTheme = createCustomTheme(nextCustomTheme);
                persistCustomTheme(nextCustomTheme);
                persistTheme(nextTheme);
                setActiveTheme(nextTheme);
                setOptionsDropdownOpen(true);
                setCustomThemeEditorOpen(true);
                return nextCustomTheme;
            });
            return;
        }

        const nextTheme = THEMES.find((theme) => theme.id === themeId);
        if (!nextTheme) {
            return;
        }

        persistTheme(nextTheme);
        setActiveTheme(nextTheme);
        setOptionsDropdownOpen(false);
        setCustomThemeEditorOpen(false);
        setMobileMenuOpen(false);
    };

    const handleThemeColorChange = (
        key: "bgHex" | "fgHex" | "textHex" | "alertHex" | "emphasisHex" | "noticeHex" | "hyperlinkHex" | "systemHex",
        value: string
    ): void => {
        setCustomTheme((prevCustomTheme) => {
            const nextCustomTheme: CustomThemeConfig = {
                ...prevCustomTheme,
                [key]: value,
            };
            persistCustomTheme(nextCustomTheme);

            if (activeTheme.id !== "custom") {
                return nextCustomTheme;
            }

            const nextTheme = createCustomTheme(nextCustomTheme);
            persistTheme(nextTheme);
            setActiveTheme(nextTheme);
            return nextCustomTheme;
        });
    };

    const handleCustomThemeEditorToggle = (): void => {
        if (activeTheme.id !== "custom") {
            return;
        }

        setCustomThemeEditorOpen((prev) => !prev);
    };

    const handleSubscribeToggle = async (module: ModuleRecord): Promise<void> => {
        if (!sessionUserId) {
            setErrorMessage("Sign in to subscribe to modules.");
            return;
        }
        if (module.visibility === "private" && !isAdmin) {
            setErrorMessage("Only admins can subscribe to private modules.");
            return;
        }

        setActionModuleId(module.id);
        setErrorMessage(null);
        setNoticeMessage(null);
        try {
            if (subscribedIdSet.has(module.id)) {
                await unsubscribeFromModule(module.id, sessionUserId);
            } else {
                await subscribeToModule(module.id, sessionUserId);
            }

            const personalState = await loadPersonalState(sessionUserId);
            await refreshCatalog(sessionUserId, personalState.subscribedIds, personalState.ownModules, personalState.role);
            setNoticeMessage(
                subscribedIdSet.has(module.id)
                    ? `Unsubscribed from "${module.title}".`
                    : `Subscribed to "${module.title}".`
            );
        } catch (error: any) {
            setErrorMessage(error?.message || "Could not update the subscription.");
        } finally {
            setActionModuleId(null);
        }
    };

    const handleRateModule = async (module: ModuleRecord, rating: number): Promise<void> => {
        if (!sessionUserId) {
            setErrorMessage("Sign in to rate modules.");
            return;
        }
        if (!isModuleLinkShareable(module.visibility)) {
            setErrorMessage("Private modules cannot be rated.");
            return;
        }

        if (module.owner_id === sessionUserId) {
            setErrorMessage("You cannot rate your own module.");
            return;
        }

        setActionModuleId(module.id);
        setErrorMessage(null);
        setNoticeMessage(null);
        try {
            await rateModule(module.id, sessionUserId, rating);
            const personalState = await loadPersonalState(sessionUserId);
            await refreshCatalog(sessionUserId, personalState.subscribedIds, personalState.ownModules, personalState.role);
            setNoticeMessage(`Rated "${module.title}" ${rating}/5.`);
        } catch (error: any) {
            setErrorMessage(error?.message || "Could not save your rating.");
        } finally {
            setActionModuleId(null);
        }
    };

    const handleCopyPhosphorLink = async (module: ModuleRecord): Promise<void> => {
        setShareMenuOpen(false);
        const shareUrl = getTerminalAppUrl(module.id);
        try {
            await navigator.clipboard.writeText(shareUrl);
            setNoticeMessage("Phosphor link copied to clipboard.");
            setErrorMessage(null);
        } catch {
            setErrorMessage(`Could not copy automatically. Share this URL manually: ${shareUrl}`);
        }
    };

    const handleCopyLibraryLink = async (module: ModuleRecord): Promise<void> => {
        setShareMenuOpen(false);
        const shareUrl = getModulesBrowserUrl({ module: module.id });
        try {
            await navigator.clipboard.writeText(shareUrl);
            setNoticeMessage("Library link copied to clipboard.");
            setErrorMessage(null);
        } catch {
            setErrorMessage(`Could not copy automatically. Share this URL manually: ${shareUrl}`);
        }
    };

    const handleShareMenuToggle = (): void => {
        setShareMenuOpen((prev) => !prev);
        setOwnerMenuOpen(false);
        setProfileOpen(false);
        setOptionsDropdownOpen(false);
        setCustomThemeEditorOpen(false);
    };

    const handleOwnerMenuToggle = (): void => {
        setOwnerMenuOpen((prev) => !prev);
        setProfileOpen(false);
        setOptionsDropdownOpen(false);
        setCustomThemeEditorOpen(false);
    };

    const handleStartEdit = (module: ModuleRecord): void => {
        setOwnerMenuOpen(false);
        setEditTitle(module.title);
        setEditSummary(module.summary || "");
        setEditingModuleId(module.id);
    };

    const handleCancelEdit = (): void => {
        setEditingModuleId(null);
        setEditTitle("");
        setEditSummary("");
    };

    const handleSaveOwnerEdits = async (module: ModuleRecord): Promise<void> => {
        if (!canManageModule(module)) {
            setErrorMessage("Only the owner or an admin can edit this module.");
            return;
        }

        const nextTitle = editTitle.trim();
        if (!nextTitle.length) {
            setErrorMessage("Add a title before saving.");
            return;
        }

        setActionModuleId(module.id);
        setErrorMessage(null);
        setNoticeMessage(null);
        try {
            const updatedModule = await updateModuleMetadata({
                id: module.id,
                ownerId: module.owner_id,
                title: nextTitle,
                summary: editSummary.trim(),
                visibility: module.visibility,
            });
            const personalState = await loadPersonalState(sessionUserId);
            await refreshCatalog(sessionUserId, personalState.subscribedIds, personalState.ownModules, personalState.role);
            setSelectedModuleId(updatedModule.id);
            setEditingModuleId(null);
            setEditTitle("");
            setEditSummary("");
            setNoticeMessage(`Updated "${updatedModule.title}".`);
        } catch (error: any) {
            setErrorMessage(error?.message || "Could not update the module.");
        } finally {
            setActionModuleId(null);
        }
    };

    const handleSetOwnerVisibility = async (
        module: ModuleRecord,
        nextVisibility: ModuleVisibility
    ): Promise<void> => {
        if (!canManageModule(module)) {
            setErrorMessage("Only the owner or an admin can change module visibility.");
            return;
        }

        if (module.visibility === nextVisibility) {
            setOwnerMenuOpen(false);
            return;
        }

        setOwnerMenuOpen(false);
        setActionModuleId(module.id);
        setErrorMessage(null);
        setNoticeMessage(null);
        try {
            const updatedModule = await updateModuleMetadata({
                id: module.id,
                ownerId: module.owner_id,
                title: module.title,
                summary: module.summary,
                visibility: nextVisibility,
            });
            const personalState = await loadPersonalState(sessionUserId);
            await refreshCatalog(sessionUserId, personalState.subscribedIds, personalState.ownModules, personalState.role);
            setSelectedModuleId(updatedModule.id);
            setNoticeMessage(`"${updatedModule.title}" is now ${nextVisibility}.`);
        } catch (error: any) {
            setErrorMessage(error?.message || "Could not update module visibility.");
        } finally {
            setActionModuleId(null);
        }
    };

    const handleDeleteOwnedModule = async (module: ModuleRecord): Promise<void> => {
        if (!canManageModule(module)) {
            setErrorMessage("Only the owner or an admin can delete this module.");
            return;
        }

        if (!window.confirm(`Delete "${module.title}"? This cannot be undone.`)) {
            return;
        }

        setOwnerMenuOpen(false);
        setEditingModuleId(null);
        setActionModuleId(module.id);
        setErrorMessage(null);
        setNoticeMessage(null);
        try {
            await deleteModule(module.id, module.owner_id);
            const personalState = await loadPersonalState(sessionUserId);
            await refreshCatalog(sessionUserId, personalState.subscribedIds, personalState.ownModules, personalState.role);
            setSelectedModuleId(null);
            setNoticeMessage(`Deleted "${module.title}".`);
        } catch (error: any) {
            setErrorMessage(error?.message || "Could not delete the module.");
        } finally {
            setActionModuleId(null);
        }
    };

    const renderOptionsMenuItems = () => (
        <>
            <button
                className="phosphor-header__dropdown-item"
                role="menuitem"
                onClick={handleSoundToggle}
            >
                [SOUND:{soundEnabled ? "ON" : "OFF"}]
            </button>

            <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

            <div className="phosphor-header__dropdown-label">[DISPLAY]</div>
            {BROWSER_VIEW_OPTIONS.map((option) => (
                <button
                    key={option.value}
                    role="menuitemradio"
                    aria-checked={viewMode === option.value}
                    className={
                        "phosphor-header__dropdown-item"
                        + (viewMode === option.value ? " phosphor-header__dropdown-item--active" : "")
                    }
                    onClick={() => handleViewModeChange(option.value)}
                >
                    {viewMode === option.value ? "► " : "  "}{option.label}
                </button>
            ))}
            {BROWSER_FONT_OPTIONS.map((option) => (
                <button
                    key={option.value}
                    role="menuitemradio"
                    aria-checked={fontMode === option.value}
                    className={
                        "phosphor-header__dropdown-item"
                        + (fontMode === option.value ? " phosphor-header__dropdown-item--active" : "")
                    }
                    onClick={() => handleFontModeChange(option.value)}
                >
                    {fontMode === option.value ? "► " : "  "}{option.label}
                </button>
            ))}

            <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />

            <div className="phosphor-header__dropdown-label">[THEME]</div>
            {THEMES.map((theme) => (
                <button
                    key={theme.id}
                    role="menuitemradio"
                    aria-checked={theme.id === activeTheme.id}
                    className={
                        "phosphor-header__dropdown-item"
                        + (theme.id === activeTheme.id ? " phosphor-header__dropdown-item--active" : "")
                    }
                    onClick={() => handleThemeSelect(theme.id)}
                >
                    {theme.id === activeTheme.id ? "► " : "  "}{theme.name}
                </button>
            ))}

            <button
                role="menuitemradio"
                aria-checked={activeTheme.id === "custom"}
                className={
                    "phosphor-header__dropdown-item"
                    + (activeTheme.id === "custom" ? " phosphor-header__dropdown-item--active" : "")
                }
                onClick={() => {
                    if (activeTheme.id !== "custom") {
                        handleThemeSelect("custom");
                        return;
                    }

                    handleCustomThemeEditorToggle();
                }}
            >
                {activeTheme.id === "custom" ? "► " : "  "}
                CUSTOM {activeTheme.id === "custom" ? (customThemeEditorOpen ? "▲" : "▼") : ""}
            </button>

            {activeTheme.id === "custom" && customThemeEditorOpen && (
                <div className="phosphor-header__theme-custom">
                    <label className="phosphor-header__theme-color-field">
                        <span>FG</span>
                        <input
                            type="color"
                            aria-label="Custom foreground color"
                            value={customTheme.fgHex}
                            onChange={(event) => handleThemeColorChange("fgHex", event.target.value)}
                        />
                    </label>
                    <label className="phosphor-header__theme-color-field">
                        <span>TEXT</span>
                        <input
                            type="color"
                            aria-label="Custom text color"
                            value={customTheme.textHex}
                            onChange={(event) => handleThemeColorChange("textHex", event.target.value)}
                        />
                    </label>
                    <label className="phosphor-header__theme-color-field">
                        <span>BG</span>
                        <input
                            type="color"
                            aria-label="Custom background color"
                            value={customTheme.bgHex}
                            onChange={(event) => handleThemeColorChange("bgHex", event.target.value)}
                        />
                    </label>
                    <label className="phosphor-header__theme-color-field">
                        <span>ALERT</span>
                        <input
                            type="color"
                            aria-label="Custom alert color"
                            value={customTheme.alertHex}
                            onChange={(event) => handleThemeColorChange("alertHex", event.target.value)}
                        />
                    </label>
                    <label className="phosphor-header__theme-color-field">
                        <span>EMPHASIS</span>
                        <input
                            type="color"
                            aria-label="Custom emphasis color"
                            value={customTheme.emphasisHex}
                            onChange={(event) => handleThemeColorChange("emphasisHex", event.target.value)}
                        />
                    </label>
                    <label className="phosphor-header__theme-color-field">
                        <span>NOTICE</span>
                        <input
                            type="color"
                            aria-label="Custom notice color"
                            value={customTheme.noticeHex}
                            onChange={(event) => handleThemeColorChange("noticeHex", event.target.value)}
                        />
                    </label>
                    <label className="phosphor-header__theme-color-field">
                        <span>HYPERLINK</span>
                        <input
                            type="color"
                            aria-label="Custom hyperlink color"
                            value={customTheme.hyperlinkHex}
                            onChange={(event) => handleThemeColorChange("hyperlinkHex", event.target.value)}
                        />
                    </label>
                    <label className="phosphor-header__theme-color-field">
                        <span>SYSTEM</span>
                        <input
                            type="color"
                            aria-label="Custom system color"
                            value={customTheme.systemHex}
                            onChange={(event) => handleThemeColorChange("systemHex", event.target.value)}
                        />
                    </label>
                </div>
            )}
        </>
    );

    const renderProfileMenuItems = () => (
        <>
            <div className="phosphor-header__dropdown-label">[ACCOUNT]</div>
            <div className="modules-browser__profile-row">
                <span className="modules-browser__profile-key">[EMAIL]</span>
                <span className="modules-browser__profile-value">{sessionEmail}</span>
            </div>
            <div className="modules-browser__profile-row">
                <span className="modules-browser__profile-key">[MODULES CREATED]</span>
                <span className="modules-browser__profile-value">{createdModuleCount}</span>
            </div>
            {isAdmin && (
                <div className="modules-browser__profile-row">
                    <span className="modules-browser__profile-key">[ROLE]</span>
                    <span className="modules-browser__profile-value">admin</span>
                </div>
            )}
            <div className="phosphor-header__dropdown-item phosphor-header__dropdown-item--separator" />
            <button
                className="phosphor-header__dropdown-item"
                role="menuitem"
                onClick={() => void handleSignOut()}
            >
                [SIGN OUT]
            </button>
        </>
    );

    const emptyMessage = useMemo(() => {
        if (catalogLoading) {
            return "Loading modules...";
        }
        if (subscribedOnly && !sessionUserId) {
            return "Sign in to filter by subscriptions.";
        }
        if (ownerFilter) {
            return query.trim().length
                ? "No modules by this uploader matched your search."
                : "This uploader has no modules to show.";
        }
        if (query.trim().length) {
            return "No modules matched your search.";
        }
        if (isAdmin && adminVisibilityFilter === "all") {
            return "No modules found yet.";
        }
        if (isAdmin) {
            return "No public modules found yet.";
        }
        return sessionUserId ? "No public modules or owned modules found yet." : "No public modules found yet.";
    }, [adminVisibilityFilter, catalogLoading, isAdmin, ownerFilter, query, sessionUserId, subscribedOnly]);

    return (
        <section className={browserClassName}>
            <header
                ref={headerRef}
                className={
                    "phosphor-header modules-browser__topbar"
                    + (headerOverflowLevel > 0
                        ? ` phosphor-header--compact phosphor-header--overflow-${headerOverflowLevel}`
                        : "")
                }
            >
                <a
                    ref={headerTitleRef}
                    className="phosphor-header__title"
                    href={getTerminalAppUrl()}
                    title="Return to the PHOSPHOR terminal"
                >
                    {APP_TITLE} LIBRARY
                </a>

                <div
                    ref={headerControlsRef}
                    className="phosphor-header__controls"
                >
                    <a
                        className="phosphor-header__btn phosphor-header__hide-at-4"
                        href={getTerminalAppUrl()}
                        onClick={() => {
                            setMobileMenuOpen(false);
                            setProfileOpen(false);
                            setOptionsDropdownOpen(false);
                            setCustomThemeEditorOpen(false);
                        }}
                    >
                        [TERMINAL]
                    </a>

                    <div ref={optionsRef} className="phosphor-header__options-wrapper phosphor-header__hide-at-3">
                        <button
                            className="phosphor-header__btn"
                            onClick={handleOptionsDropdownToggle}
                            aria-haspopup="menu"
                            aria-expanded={optionsDropdownOpen}
                            title="Theme and sound options"
                        >
                            [OPTIONS {optionsDropdownOpen ? "▲" : "▼"}]
                        </button>

                        {optionsDropdownOpen && (
                            <div className="phosphor-header__dropdown phosphor-header__dropdown--options" role="menu">
                                {renderOptionsMenuItems()}
                            </div>
                        )}
                    </div>

                    <a
                        className="phosphor-header__btn phosphor-header__hide-at-2"
                        href="https://ko-fi.com/ethandunning"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        [DONATE]
                    </a>

                    {!authLoading && !sessionEmail && (
                        <button className="phosphor-header__btn phosphor-header__hide-at-1" onClick={() => void handleSignIn()}>
                            [SIGN IN]
                        </button>
                    )}

                    {!authLoading && !!sessionEmail && (
                        <div ref={profileRef} className="phosphor-header__options-wrapper phosphor-header__profile-wrapper phosphor-header__hide-at-1">
                            <button
                                className="phosphor-header__btn"
                                onClick={() => {
                                    setProfileOpen((prev) => !prev);
                                    setOptionsDropdownOpen(false);
                                    setCustomThemeEditorOpen(false);
                                }}
                                aria-haspopup="menu"
                                aria-expanded={profileOpen}
                            >
                                [PROFILE {profileOpen ? "▲" : "▼"}]
                            </button>

                            {profileOpen && (
                                <div
                                    className="phosphor-header__dropdown phosphor-header__dropdown--options modules-browser__profile-menu"
                                    role="menu"
                                >
                                    {renderProfileMenuItems()}
                                </div>
                            )}
                        </div>
                    )}

                    <div
                        ref={headerOverflowWrapperRef}
                        className="phosphor-header__options-wrapper phosphor-header__overflow-wrapper"
                    >
                        <button
                            className="phosphor-header__btn phosphor-header__menu-btn"
                            onClick={() => {
                                setMobileMenuOpen((prev) => !prev);
                                setOptionsDropdownOpen(false);
                                setProfileOpen(false);
                                setCustomThemeEditorOpen(false);
                            }}
                            aria-haspopup="menu"
                            aria-expanded={mobileMenuOpen}
                            title="Toggle library controls"
                        >
                            [MENU {mobileMenuOpen ? "▲" : "▼"}]
                        </button>

                        {mobileMenuOpen && (
                            <div
                                className="phosphor-header__dropdown phosphor-header__dropdown--options phosphor-header__overflow-dropdown"
                                role="menu"
                            >
                                {headerOverflowLevel >= 4 && (
                                    <a
                                        className="phosphor-header__dropdown-item"
                                        href={getTerminalAppUrl()}
                                        role="menuitem"
                                        onClick={() => {
                                            setMobileMenuOpen(false);
                                            setOptionsDropdownOpen(false);
                                            setProfileOpen(false);
                                            setCustomThemeEditorOpen(false);
                                        }}
                                    >
                                        [TERMINAL]
                                    </a>
                                )}

                                {headerOverflowLevel >= 3 && (
                                    <div className="phosphor-header__overflow-section">
                                        <button
                                            className="phosphor-header__dropdown-item"
                                            role="menuitem"
                                            aria-expanded={optionsDropdownOpen}
                                            onClick={handleOptionsDropdownToggle}
                                        >
                                            [OPTIONS {optionsDropdownOpen ? "▲" : "▼"}]
                                        </button>

                                        {optionsDropdownOpen && renderOptionsMenuItems()}
                                    </div>
                                )}

                                {headerOverflowLevel >= 2 && (
                                    <a
                                        className="phosphor-header__dropdown-item"
                                        href="https://ko-fi.com/ethandunning"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        role="menuitem"
                                        onClick={() => {
                                            setMobileMenuOpen(false);
                                            setOptionsDropdownOpen(false);
                                            setProfileOpen(false);
                                            setCustomThemeEditorOpen(false);
                                        }}
                                    >
                                        [DONATE]
                                    </a>
                                )}

                                {headerOverflowLevel >= 1 && !authLoading && !sessionEmail && (
                                    <button
                                        className="phosphor-header__dropdown-item"
                                        role="menuitem"
                                        onClick={() => {
                                            setMobileMenuOpen(false);
                                            void handleSignIn();
                                        }}
                                    >
                                        [SIGN IN]
                                    </button>
                                )}

                                {headerOverflowLevel >= 1 && !authLoading && !!sessionEmail && (
                                    <div className="phosphor-header__overflow-section">
                                        <button
                                            className="phosphor-header__dropdown-item"
                                            role="menuitem"
                                            aria-expanded={profileOpen}
                                            onClick={() => {
                                                setProfileOpen((prev) => !prev);
                                                setOptionsDropdownOpen(false);
                                                setCustomThemeEditorOpen(false);
                                            }}
                                        >
                                            [PROFILE {profileOpen ? "▲" : "▼"}]
                                        </button>

                                        {profileOpen && renderProfileMenuItems()}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <div className="modules-browser__shell">
                <div className="modules-browser__toolbar">
                    <label className="modules-browser__field">
                        <span>Search</span>
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search title or summary"
                        />
                    </label>

                    <label className="modules-browser__field modules-browser__field--sort">
                        <span>Sort</span>
                        <CreatorSelect
                            value={sort}
                            options={SORT_OPTIONS}
                            onChange={(nextValue) => {
                                setSort(nextValue as ModuleSort);
                                playPowerOn();
                            }}
                            fallbackLabel="Newest"
                        />
                    </label>

                    <div className="modules-browser__toolbar-actions">
                        {isAdmin && (
                            <button
                                className={
                                    "modules-browser__btn"
                                    + (adminVisibilityFilter === "all" ? " modules-browser__btn--active" : "")
                                }
                                onClick={() => {
                                    setAdminVisibilityFilter((prev) => (prev === "all" ? "public" : "all"));
                                }}
                            >
                                Admin Scope: {adminVisibilityFilter === "all" ? "All" : "Public Only"}
                            </button>
                        )}
                        <button
                            className={
                                "modules-browser__btn"
                                + (subscribedOnly ? " modules-browser__btn--active" : "")
                            }
                            disabled={!sessionUserId}
                            onClick={() => setSubscribedOnly((prev) => !prev)}
                        >
                            Subscribed Only: {subscribedOnly ? "On" : "Off"}
                        </button>
                    </div>
                </div>

                {ownerFilter && (
                    <div className="modules-browser__notice modules-browser__owner-filter-notice">
                        <span>
                            Showing modules by uploader{" "}
                            <span className="modules-browser__owner-filter-id" title={ownerFilter}>
                                #{formatOwnerShortId(ownerFilter)}
                            </span>
                        </span>
                        <button
                            type="button"
                            className="modules-browser__notice-dismiss"
                            onClick={() => setOwnerFilter(null)}
                            aria-label="Clear uploader filter"
                            title="Clear uploader filter"
                        >
                            X
                        </button>
                    </div>
                )}

                {!supabaseReady && (
                    <div className="modules-browser__notice modules-browser__notice--error">
                        Supabase is not configured in this environment. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` locally.
                    </div>
                )}

                {errorMessage && (
                    <div className="modules-browser__notice modules-browser__notice--error">
                        <span>{errorMessage}</span>
                        <button
                            type="button"
                            className="modules-browser__notice-dismiss"
                            onClick={() => setErrorMessage(null)}
                            aria-label="Dismiss error message"
                            title="Dismiss"
                        >
                            X
                        </button>
                    </div>
                )}

                {noticeMessage && (
                    <div className="modules-browser__notice">
                        <span>{noticeMessage}</span>
                        <button
                            type="button"
                            className="modules-browser__notice-dismiss"
                            onClick={() => setNoticeMessage(null)}
                            aria-label="Dismiss notice"
                            title="Dismiss"
                        >
                            X
                        </button>
                    </div>
                )}

                <main className="modules-browser__content">
                    <section className="modules-browser__panel modules-browser__panel--list">
                        {!modules.length && (
                            <div className="modules-browser__empty">{emptyMessage}</div>
                        )}

                        {!!modules.length && (
                            <div className="modules-browser__list">
                                {modules.map((module) => {
                                    const isSelected = selectedModule?.id === module.id;
                                    const isSubscribed = subscribedIdSet.has(module.id);
                                    const visibilityFlag = module.visibility === "private"
                                        ? "Private"
                                        : (module.visibility === "unlisted" ? "Unlisted" : null);
                                    const author = getModuleAuthor(module);
                                    const ratingDisplay = getModuleRatingAscii(module.rating_average);
                                    const ratingNumeric = getModuleRatingNumeric(module.rating_average);
                                    const ratingTitle = getModuleRatingTitle(module.rating_average);

                                    return (
                                        <button
                                            key={module.id}
                                            type="button"
                                            className={
                                                "modules-browser__list-item"
                                                + (isSelected ? " modules-browser__list-item--active" : "")
                                            }
                                            onClick={() => setSelectedModuleId(module.id)}
                                            aria-pressed={isSelected}
                                        >
                                            <div className="modules-browser__list-header">
                                                <div className="modules-browser__list-title-group">
                                                    <span className="modules-browser__list-name" title={module.title}>
                                                        {module.title}
                                                    </span>
                                                    <span className="modules-browser__list-author" title={author}>
                                                        By {author}
                                                    </span>
                                                    <span
                                                        className={
                                                            "modules-browser__owner-tag"
                                                            + (ownerFilter === module.owner_id ? " modules-browser__owner-tag--active" : "")
                                                        }
                                                        role="button"
                                                        tabIndex={0}
                                                        title={`Show all modules by uploader ${module.owner_id}`}
                                                        aria-label={`Show all modules by uploader ${formatOwnerShortId(module.owner_id)}`}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            handleOwnerFilterSelect(module.owner_id);
                                                        }}
                                                        onKeyDown={(event) => {
                                                            if (event.key === "Enter" || event.key === " ") {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                handleOwnerFilterSelect(module.owner_id);
                                                            }
                                                        }}
                                                    >
                                                        #{formatOwnerShortId(module.owner_id)}
                                                    </span>
                                                </div>
                                                <div className="modules-browser__list-flags">
                                                    {!!visibilityFlag && (
                                                        <span className="modules-browser__list-flag">{visibilityFlag}</span>
                                                    )}
                                                    {isSubscribed && (
                                                        <span className="modules-browser__list-flag">Subscribed</span>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="modules-browser__list-meta">
                                                <span className="modules-browser__list-meta-primary">
                                                    {module.subscription_count} subscribers
                                                    {" | "}
                                                    Published {formatTimestamp(module.published_at || module.updated_at)}
                                                </span>
                                                <span className="modules-browser__list-meta-rating" title={ratingTitle}>
                                                    Rating {ratingDisplay} ({ratingNumeric})
                                                    {" | "}
                                                    {module.rating_count} ratings
                                                </span>
                                            </span>
                                            <span className="modules-browser__list-summary">
                                                {module.summary || "[NO SUMMARY PROVIDED]"}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <aside className="modules-browser__panel modules-browser__panel--detail">
                        {!selectedModule && (
                            <div className="modules-browser__empty">
                                Select a module to see its full details.
                            </div>
                        )}

                        {!!selectedModule && (() => {
                            const isSubscribed = subscribedIdSet.has(selectedModule.id);
                            const myRating = ratingsByModuleId[selectedModule.id] || 0;
                            const isOwnModule = selectedModule.owner_id === sessionUserId;
                            const canManage = isOwnModule || isAdmin;
                            const isBusy = actionModuleId === selectedModule.id;
                            const isEditing = editingModuleId === selectedModule.id;
                            const author = getModuleAuthor(selectedModule);
                            const ratingDisplay = getModuleRatingAscii(selectedModule.rating_average);
                            const ratingNumeric = getModuleRatingNumeric(selectedModule.rating_average);
                            const ratingTitle = getModuleRatingTitle(selectedModule.rating_average);

                            return (
                                <article className="modules-browser__detail">
                                    <div className="modules-browser__detail-header">
                                        <div className="modules-browser__detail-title-group">
                                            <div className="modules-browser__detail-title-row">
                                                <h2 title={selectedModule.title}>{selectedModule.title}</h2>
                                                <span className="modules-browser__detail-author" title={author}>
                                                    By {author}
                                                </span>
                                                <button
                                                    type="button"
                                                    className={
                                                        "modules-browser__owner-tag"
                                                        + (ownerFilter === selectedModule.owner_id ? " modules-browser__owner-tag--active" : "")
                                                    }
                                                    title={`Show all modules by uploader ${selectedModule.owner_id}`}
                                                    aria-label={`Show all modules by uploader ${formatOwnerShortId(selectedModule.owner_id)}`}
                                                    onClick={() => handleOwnerFilterSelect(selectedModule.owner_id)}
                                                >
                                                    #{formatOwnerShortId(selectedModule.owner_id)}
                                                </button>
                                            </div>
                                            <div className="modules-browser__meta">
                                                <span title={ratingTitle}>Rating {ratingDisplay} ({ratingNumeric})</span>
                                                <span>{selectedModule.rating_count} ratings</span>
                                                <span>{selectedModule.subscription_count} subscribers</span>
                                                <span>Published {formatTimestamp(selectedModule.published_at || selectedModule.updated_at)}</span>
                                            </div>
                                        </div>

                                        <div className="modules-browser__detail-badges">
                                            {selectedModule.visibility === "private" && (
                                                <span className="modules-browser__pill">Private</span>
                                            )}
                                            {selectedModule.visibility === "unlisted" && (
                                                <span className="modules-browser__pill">Unlisted</span>
                                            )}
                                            {isSubscribed && (
                                                <span className="modules-browser__pill">Subscribed</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="modules-browser__detail-actions">
                                        <button
                                            className="modules-browser__btn"
                                            onClick={() => {
                                                window.location.href = getTerminalAppUrl(selectedModule.id);
                                            }}
                                        >
                                            Open in Phosphor
                                        </button>

                                        {isModuleLinkShareable(selectedModule.visibility) && (
                                            <div ref={shareMenuRef} className="modules-browser__share-menu">
                                                <button
                                                    className="modules-browser__btn"
                                                    onClick={handleShareMenuToggle}
                                                    aria-haspopup="menu"
                                                    aria-expanded={shareMenuOpen}
                                                >
                                                    {shareMenuOpen ? "Share ▲" : "Share ▼"}
                                                </button>
                                            </div>
                                        )}

                                        {!isOwnModule && (isModuleLinkShareable(selectedModule.visibility) || isAdmin) && (
                                            <button
                                                className={
                                                    "modules-browser__btn"
                                                    + (isSubscribed ? " modules-browser__btn--active" : "")
                                                }
                                                disabled={!sessionUserId || isBusy}
                                                onClick={() => void handleSubscribeToggle(selectedModule)}
                                            >
                                                {isSubscribed ? "Unsubscribe" : "Subscribe"}
                                            </button>
                                        )}

                                        {canManage && (
                                            <div ref={ownerMenuRef} className="modules-browser__owner-menu">
                                                <button
                                                    className="modules-browser__btn"
                                                    disabled={isBusy}
                                                    onClick={handleOwnerMenuToggle}
                                                    aria-haspopup="menu"
                                                    aria-expanded={ownerMenuOpen}
                                                >
                                                    {!isOwnModule && isAdmin ? "Manage (Admin)" : "Manage"}{ownerMenuOpen ? " ▲" : " ▼"}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {canManage && isEditing && (
                                        <section className="modules-browser__detail-card modules-browser__detail-card--edit">
                                            <div className="modules-browser__edit-grid">
                                                <label className="modules-browser__field">
                                                    <span>Title</span>
                                                    <input
                                                        value={editTitle}
                                                        onChange={(event) => setEditTitle(event.target.value)}
                                                        placeholder="Module title"
                                                        maxLength={80}
                                                    />
                                                </label>

                                                <label className="modules-browser__field modules-browser__field--textarea">
                                                    <span>Description</span>
                                                    <textarea
                                                        value={editSummary}
                                                        onChange={(event) => setEditSummary(event.target.value)}
                                                        placeholder="Short summary for the module page"
                                                        rows={5}
                                                        maxLength={2000}
                                                    />
                                                </label>
                                            </div>

                                            <div className="modules-browser__edit-actions">
                                                <button
                                                    className="modules-browser__btn"
                                                    disabled={isBusy}
                                                    onClick={() => void handleSaveOwnerEdits(selectedModule)}
                                                >
                                                    Save Details
                                                </button>
                                                <button
                                                    className="modules-browser__btn"
                                                    disabled={isBusy}
                                                    onClick={handleCancelEdit}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </section>
                                    )}

                                    <section className="modules-browser__detail-card modules-browser__detail-card--summary">
                                        <span className="modules-browser__detail-card-label">Description</span>
                                        <p className="modules-browser__detail-summary">
                                            {selectedModule.summary || "[NO SUMMARY PROVIDED]"}
                                        </p>
                                    </section>

                                    <div className="modules-browser__detail-stats">
                                        <div className="modules-browser__detail-stat">
                                            <span>Module ID</span>
                                            <strong>{selectedModule.id}</strong>
                                        </div>
                                        <div className="modules-browser__detail-stat">
                                            <span>Updated</span>
                                            <strong>{formatTimestamp(selectedModule.updated_at)}</strong>
                                        </div>
                                    </div>

                                    <section className="modules-browser__detail-card modules-browser__detail-card--rating">
                                        <div className="modules-browser__rating">
                                            <div className="modules-browser__rating-row">
                                                <span className="modules-browser__rating-label">Rate This Module</span>
                                                <div className="modules-browser__rating-actions">
                                                    {RATING_VALUES.map((rating) => (
                                                        <button
                                                            key={`${selectedModule.id}-rating-${rating}`}
                                                            className={
                                                                "modules-browser__rating-btn"
                                                                + (myRating === rating ? " modules-browser__rating-btn--active" : "")
                                                            }
                                                            disabled={!sessionUserId || isOwnModule || isBusy || !isModuleLinkShareable(selectedModule.visibility)}
                                                            onClick={() => void handleRateModule(selectedModule, rating)}
                                                        >
                                                            {rating}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            {!sessionUserId && (
                                                <small className="modules-browser__hint">Sign in to rate or subscribe.</small>
                                            )}
                                            {!!sessionUserId && !isModuleLinkShareable(selectedModule.visibility) && (
                                                <small className="modules-browser__hint">Private modules cannot be rated or subscribed to.</small>
                                            )}
                                            {!!sessionUserId && isOwnModule && (
                                                <small className="modules-browser__hint">You cannot rate or subscribe to your own module.</small>
                                            )}
                                        </div>
                                    </section>
                                </article>
                            );
                        })()}
                    </aside>
                </main>
            </div>

            {ownerMenuOpen && !!selectedModule && canManageModule(selectedModule) && !!ownerMenuPosition && createPortal(
                <div
                    ref={ownerMenuDropdownRef}
                    className={
                        "phosphor-header__dropdown phosphor-header__dropdown--options modules-browser__owner-menu-dropdown"
                        + (viewMode === "web" ? " modules-browser__owner-menu-dropdown--web-view" : "")
                        + (fontMode === "normal" ? " modules-browser__owner-menu-dropdown--font-normal" : "")
                    }
                    role="menu"
                    style={{
                        top: `${ownerMenuPosition.top}px`,
                        left: `${ownerMenuPosition.left}px`,
                    }}
                >
                    <button
                        className="phosphor-header__dropdown-item"
                        role="menuitem"
                        onClick={() => handleStartEdit(selectedModule)}
                    >
                        Edit Details
                    </button>
                    <button
                        className="phosphor-header__dropdown-item"
                        role="menuitem"
                        onClick={() => void handleSetOwnerVisibility(selectedModule, "public")}
                    >
                        {selectedModule.visibility === "public" ? "Visibility: Public" : "Set Public"}
                    </button>
                    <button
                        className="phosphor-header__dropdown-item"
                        role="menuitem"
                        onClick={() => void handleSetOwnerVisibility(selectedModule, "unlisted")}
                    >
                        {selectedModule.visibility === "unlisted" ? "Visibility: Unlisted" : "Set Unlisted"}
                    </button>
                    <button
                        className="phosphor-header__dropdown-item"
                        role="menuitem"
                        onClick={() => void handleSetOwnerVisibility(selectedModule, "private")}
                    >
                        {selectedModule.visibility === "private" ? "Visibility: Private" : "Set Private"}
                    </button>
                    <button
                        className="phosphor-header__dropdown-item modules-browser__dropdown-item--danger"
                        role="menuitem"
                        onClick={() => void handleDeleteOwnedModule(selectedModule)}
                    >
                        Delete Module
                    </button>
                </div>,
                document.body
            )}

            {shareMenuOpen && !!selectedModule && isModuleLinkShareable(selectedModule.visibility) && !!shareMenuPosition && createPortal(
                <div
                    ref={shareMenuDropdownRef}
                    className={
                        "phosphor-header__dropdown phosphor-header__dropdown--options modules-browser__share-menu-dropdown"
                        + (viewMode === "web" ? " modules-browser__share-menu-dropdown--web-view" : "")
                        + (fontMode === "normal" ? " modules-browser__share-menu-dropdown--font-normal" : "")
                    }
                    role="menu"
                    style={{
                        top: `${shareMenuPosition.top}px`,
                        left: `${shareMenuPosition.left}px`,
                    }}
                >
                    <button
                        className="phosphor-header__dropdown-item"
                        role="menuitem"
                        onClick={() => void handleCopyPhosphorLink(selectedModule)}
                    >
                        Copy Phosphor Link
                    </button>
                    <button
                        className="phosphor-header__dropdown-item"
                        role="menuitem"
                        onClick={() => void handleCopyLibraryLink(selectedModule)}
                    >
                        Copy Library Link
                    </button>
                </div>,
                document.body
            )}
        </section>
    );
};

export default ModulesBrowser;
