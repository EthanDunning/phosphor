import React, { startTransition, useEffect, useMemo, useRef, useState } from "react";
import "./style.scss";

interface MainframeGameProps {
    className?: string;
    onRendered?: () => void;
}

interface PlayerState {
    x: number;
    y: number;
    invulnerableMs: number;
}

interface WingmanState {
    side: "left" | "right";
    hp: number;
    active: boolean;
    invulnerableMs: number;
}

interface BulletState {
    id: number;
    x: number;
    y: number;
    kind: "normal" | "explosive";
}

interface EnemyProjectileState {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

interface PowerUpState {
    id: number;
    x: number;
    y: number;
    kind: PowerUpKind;
}

interface EnemyState {
    id: number;
    lane: EnemyLane;
    kind: EnemyKind;
    x: number;
    y: number;
    vx: number;
    vy: number;
    body: string;
    label: string;
    lines: string[];
    width: number;
    height: number;
    fireCooldownMs: number;
}

interface BossState {
    x: number;
    y: number;
    vx: number;
    health: number;
    maxHealth: number;
    fireCooldownMs: number;
}

interface EffectState {
    dualMs: number;
    laserMs: number;
    slowMs: number;
    explosiveMs: number;
}

interface RuntimeSnapshot {
    player: PlayerState;
    wingmen: WingmanState[];
    bullets: BulletState[];
    enemyShots: EnemyProjectileState[];
    powerUps: PowerUpState[];
    enemies: EnemyState[];
    boss: BossState | null;
    effects: EffectState;
    phase: "core" | "boss";
    coreBytes: string[];
    uncorruptedByteIndices: number[];
    corruptedBytes: number;
    shots: number;
    hits: number;
    purged: number;
    lives: number;
    hostileCount: number;
    status: "running" | "victory" | "defeat";
}

interface UiSnapshot {
    coreBytes: string[];
    corruptedBytes: number;
    shots: number;
    hits: number;
    purged: number;
    lives: number;
    enemyShotCount: number;
    powerUpCount: number;
    hostileCount: number;
    effects: EffectState;
    phase: "core" | "boss";
    bossHealth: number;
    bossMaxHealth: number;
    wingmanHealths: number[];
    status: "running" | "victory" | "defeat";
}

interface InputState {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    fire: boolean;
}

interface PlayfieldMetrics {
    width: number;
    height: number;
    dpr: number;
    xScale: number;
    yScale: number;
    fontScale: number;
    enemyCharWorldWidth: number;
}

type InputDirection = "up" | "down" | "left" | "right";
type EnemyKind = "standard" | "fast" | "block" | "gunner";
type EnemyLane = "standard" | "special";
type PowerUpKind = "dual" | "laser" | "slow" | "explosive";

const PLAYFIELD_WIDTH = 100;
const PLAYFIELD_HEIGHT = 100;
const PLAYER_SPEED = 34;
const BULLET_SPEED = 74;
const STANDARD_ENEMY_COUNT = 8;
const MAX_SPECIAL_ENEMY_COUNT = 8;
const SHOOT_COOLDOWN_MS = 140;
const CORE_BYTE_COUNT = 1024;
const CORE_BYTES_PER_ROW = 16;
const CORE_COLUMN_COUNT = 2;
const CORRUPTION_BYTES_PER_HIT = 3;
const ENEMY_Y_LIMIT = 94;
const FIXED_DT_MS = 1000 / 60;
const MIN_RENDER_INTERVAL_MS = 1000 / 60;
const UI_SYNC_INTERVAL_MS = 90;
const MAX_FRAME_MS = 48;
const PLAYER_COLLISION_RADIUS_X = 1.42;
const PLAYER_COLLISION_RADIUS_Y = 1.08;
const PLAYER_PROJECTILE_COLLISION_RADIUS_X = 1.18;
const PLAYER_PROJECTILE_COLLISION_RADIUS_Y = 0.96;
const PLAYER_BOSS_COLLISION_RADIUS_X = 1.72;
const PLAYER_BOSS_COLLISION_RADIUS_Y = 1.24;
const ENEMY_PLAYER_COLLISION_INSET_X = 2.15;
const ENEMY_PLAYER_COLLISION_INSET_Y = 1.05;
const BOSS_PLAYER_COLLISION_INSET_X = 3.5;
const BOSS_PLAYER_COLLISION_INSET_Y = 1.35;
const PLAYER_START_LIVES = 3;
const PLAYER_RESPITE_MS = 1200;
const PLAYER_WING_OFFSET = 7;
const PLAYER_BULLET_EMIT_OFFSET_X = 0.05;
const WINGMAN_START_HP = 3;
const WINGMAN_RESPITE_MS = 700;
const ENEMY_PROJECTILE_SPEED = 28;
const POWER_UP_FALL_SPEED = 12;
const POWER_UP_DROP_CHANCE = 0.22;
const LASER_TICK_MS = 90;
const DUAL_DURATION_MS = 12000;
const LASER_DURATION_MS = 9500;
const SLOW_DURATION_MS = 10500;
const EXPLOSIVE_DURATION_MS = 10500;
const SLOW_FACTOR = 0.55;
const CORE_PHASE_ONE_END = 32;
const CORE_PHASE_TWO_END = 64;
const CORE_SPEEDUP_THRESHOLD = CORE_BYTE_COUNT / 2;
const HOSTILE_OVERDRIVE_MULTIPLIER = 1.22;
const BOSS_WIDTH = 33;
const BOSS_HEIGHT = 8.4;
const BOSS_HEALTH = 40;
const BOSS_FIRE_COOLDOWN_MS = 1150;
const CORRUPTION_SYMBOLS = [
    "~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "-", "=",
    "{", "}", "|", ":", "\"", "<", ">", "?", ",", ".", "/", ";", "'", "[", "]", "\\",
];
const HEX_DIGITS = "0123456789abcdef";
const POWER_UP_LABELS: Record<PowerUpKind, string> = {
    dual: "[D]",
    laser: "[L]",
    slow: "[S]",
    explosive: "[X]",
};

const clamp = (value: number, min: number, max: number): number => {
    return Math.min(max, Math.max(min, value));
};

const randomInt = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const randomFloat = (min: number, max: number): number => {
    return (Math.random() * (max - min)) + min;
};

const randomHexByte = (): string => {
    return `${HEX_DIGITS[randomInt(0, 15)]}${HEX_DIGITS[randomInt(0, 15)]}`;
};

const randomCorruptionByte = (): string => {
    const left = CORRUPTION_SYMBOLS[randomInt(0, CORRUPTION_SYMBOLS.length - 1)];
    const right = CORRUPTION_SYMBOLS[randomInt(0, CORRUPTION_SYMBOLS.length - 1)];
    return `${left}${right}`;
};

const buildUncorruptedByteIndices = (): number[] => {
    return Array.from({ length: CORE_BYTE_COUNT }, (_, index) => index);
};

const getAllowedSpecialEnemyCount = (corruptedBytes: number): number => {
    if (corruptedBytes < CORE_PHASE_ONE_END) {
        return 0;
    }
    if (corruptedBytes < CORE_PHASE_TWO_END) {
        return 4;
    }
    return MAX_SPECIAL_ENEMY_COUNT;
};

const chooseEnemyKind = (corruptedBytes: number, lane: EnemyLane): EnemyKind => {
    if (lane === "standard") {
        return "standard";
    }

    const roll = Math.random();
    if (corruptedBytes < CORE_PHASE_TWO_END) {
        return roll < 0.58 ? "fast" : "block";
    }

    if (roll < 0.36) {
        return "fast";
    }
    if (roll < 0.72) {
        return "block";
    }
    return "gunner";
};

const generateEnemyBody = (kind: EnemyKind): string => {
    const byteCount = kind === "block"
        ? randomInt(8, 12)
        : kind === "gunner"
            ? randomInt(4, 7)
            : kind === "fast"
                ? randomInt(3, 5)
                : randomInt(3, 6);
    return Array.from({ length: byteCount }, () => randomHexByte()).join("");
};

const getEnemyLabel = (enemy: EnemyState): string => {
    return `0x${enemy.body}`;
};

const getEnemyLinesFor = (kind: EnemyKind, label: string): string[] => {
    if (kind !== "block") {
        return [label];
    }

    const lines: string[] = [];
    for (let index = 0; index < label.length; index += 8) {
        lines.push(label.slice(index, index + 8));
    }
    return lines;
};

const getFallbackEnemyWidth = (enemy: EnemyState, metrics?: PlayfieldMetrics | null): number => {
    const characterWidth = metrics ? metrics.enemyCharWorldWidth : 0.72;
    const lineCount = enemy.lines.length;
    const effectiveLength = enemy.kind === "block" ? Math.min(8, enemy.label.length) : enemy.label.length;
    return Math.max(4.2, (effectiveLength * characterWidth) + (lineCount > 1 ? 1.1 : 0));
};

const getFallbackEnemyHeight = (enemy: EnemyState, metrics?: PlayfieldMetrics | null): number => {
    if (!metrics) {
        return enemy.kind === "block" ? 8.5 : enemy.kind === "fast" ? 2.8 : 3.3;
    }

    const lineHeightWorld = (metrics.fontScale * 0.92) / metrics.yScale;
    return Math.max(3.2, enemy.lines.length * lineHeightWorld);
};

const hydrateEnemyGeometry = (
    enemy: EnemyState,
    metrics?: PlayfieldMetrics | null,
    context?: CanvasRenderingContext2D | null
): EnemyState => {
    enemy.label = getEnemyLabel(enemy);
    enemy.lines = getEnemyLinesFor(enemy.kind, enemy.label);

    if (!metrics || !context) {
        enemy.width = getFallbackEnemyWidth(enemy, metrics);
        enemy.height = getFallbackEnemyHeight(enemy, metrics);
        return enemy;
    }

    context.save();
    context.font = `${metrics.fontScale}px Vga, Menlo, Monaco, Consolas, monospace`;
    let measuredWidth = 0;
    for (let index = 0; index < enemy.lines.length; index += 1) {
        measuredWidth = Math.max(measuredWidth, context.measureText(enemy.lines[index]).width);
    }
    context.restore();

    enemy.width = Math.max(3.8, (measuredWidth / metrics.xScale) - 0.55);
    enemy.height = getFallbackEnemyHeight(enemy, metrics);
    return enemy;
};

const buildPlayfieldMetrics = (playfield: HTMLDivElement): PlayfieldMetrics => {
    const width = Math.max(1, Math.floor(playfield.clientWidth));
    const height = Math.max(1, Math.floor(playfield.clientHeight));
    const dpr = window.devicePixelRatio || 1;
    const xScale = width / PLAYFIELD_WIDTH;
    const yScale = height / PLAYFIELD_HEIGHT;
    const fontScale = Math.max(11, Math.min(width * 0.019, height * 0.045));
    return {
        width,
        height,
        dpr,
        xScale,
        yScale,
        fontScale,
        enemyCharWorldWidth: Math.max(0.5, (fontScale * 0.58) / xScale),
    };
};

const buildEnemy = (
    id: number,
    spawnFromTop = false,
    lane: EnemyLane = "standard",
    forcedKind?: EnemyKind,
    corruptedBytes = 0
): EnemyState => {
    const kind = forcedKind || chooseEnemyKind(corruptedBytes, lane);
    const body = generateEnemyBody(kind);
    const prototypeEnemy: EnemyState = {
        id,
        lane,
        kind,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        body,
        label: "",
        lines: [],
        width: 0,
        height: 0,
        fireCooldownMs: 0,
    };
    hydrateEnemyGeometry(prototypeEnemy);
    const spawnWidth = Math.max(0, PLAYFIELD_WIDTH - prototypeEnemy.width);
    const speedProfile = kind === "fast"
        ? { vx: randomFloat(-8.5, 8.5), vy: randomFloat(17, 23.5) }
        : kind === "block"
            ? { vx: randomFloat(-2.8, 2.8), vy: randomFloat(5.7, 8.8) }
            : kind === "gunner"
                ? { vx: randomFloat(-4.4, 4.4), vy: randomFloat(8.8, 12.8) }
                : { vx: randomFloat(-5.5, 5.5), vy: randomFloat(9, 15.5) };
    return {
        id,
        lane,
        kind,
        x: randomFloat(3, Math.max(3, spawnWidth - 3)),
        y: spawnFromTop ? randomFloat(-12, 4) : randomFloat(10, 64),
        vx: speedProfile.vx,
        vy: speedProfile.vy,
        body,
        label: prototypeEnemy.label,
        lines: prototypeEnemy.lines,
        width: prototypeEnemy.width,
        height: prototypeEnemy.height,
        fireCooldownMs: kind === "gunner" ? randomInt(700, 1500) : 0,
    };
};

const createInitialRuntime = (): RuntimeSnapshot => {
    return {
        player: {
            x: 48.5,
            y: 88,
            invulnerableMs: 0,
        },
        wingmen: [
            { side: "left", hp: WINGMAN_START_HP, active: false, invulnerableMs: 0 },
            { side: "right", hp: WINGMAN_START_HP, active: false, invulnerableMs: 0 },
        ],
        bullets: [],
        enemyShots: [],
        powerUps: [],
        enemies: Array.from({ length: STANDARD_ENEMY_COUNT }, (_, index) => buildEnemy(index, false, "standard", "standard", 0)),
        boss: null,
        effects: {
            dualMs: 0,
            laserMs: 0,
            slowMs: 0,
            explosiveMs: 0,
        },
        phase: "core",
        coreBytes: Array.from({ length: CORE_BYTE_COUNT }, () => randomHexByte()),
        uncorruptedByteIndices: buildUncorruptedByteIndices(),
        corruptedBytes: 0,
        shots: 0,
        hits: 0,
        purged: 0,
        lives: PLAYER_START_LIVES,
        hostileCount: STANDARD_ENEMY_COUNT,
        status: "running",
    };
};

const toUiSnapshot = (runtime: RuntimeSnapshot): UiSnapshot => ({
    coreBytes: [...runtime.coreBytes],
    corruptedBytes: runtime.corruptedBytes,
    shots: runtime.shots,
    hits: runtime.hits,
    purged: runtime.purged,
    lives: runtime.lives,
    enemyShotCount: runtime.enemyShots.length,
    powerUpCount: runtime.powerUps.length,
    hostileCount: runtime.hostileCount,
    effects: { ...runtime.effects },
    phase: runtime.phase,
    bossHealth: runtime.boss?.health || 0,
    bossMaxHealth: runtime.boss?.maxHealth || 0,
    wingmanHealths: runtime.wingmen.map((wingman) => (wingman.active ? wingman.hp : 0)),
    status: runtime.status,
});

const uiSnapshotNeedsReset = (snapshot: UiSnapshot): boolean => {
    return snapshot.coreBytes.length !== CORE_BYTE_COUNT
        || !Number.isFinite(snapshot.corruptedBytes)
        || !Number.isFinite(snapshot.shots)
        || !Number.isFinite(snapshot.hits)
        || !Number.isFinite(snapshot.purged)
        || !Number.isFinite(snapshot.lives)
        || !Number.isFinite(snapshot.enemyShotCount)
        || !Number.isFinite(snapshot.powerUpCount)
        || !Number.isFinite(snapshot.hostileCount)
        || snapshot.lives < 0
        || snapshot.lives > PLAYER_START_LIVES;
};

const MainframeGame = ({ className = "", onRendered }: MainframeGameProps): React.ReactElement => {
    const initialRuntime = useMemo(() => createInitialRuntime(), []);
    const [uiSnapshot, setUiSnapshot] = useState<UiSnapshot>(() => toUiSnapshot(initialRuntime));
    const runtimeRef = useRef<RuntimeSnapshot>(initialRuntime);
    const inputRef = useRef<InputState>({
        up: false,
        down: false,
        left: false,
        right: false,
        fire: false,
    });
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
    const playfieldRef = useRef<HTMLDivElement | null>(null);
    const playfieldMetricsRef = useRef<PlayfieldMetrics | null>(null);
    const frameRef = useRef<number | null>(null);
    const lastFrameAtRef = useRef<number>(0);
    const lastRenderAtRef = useRef<number>(0);
    const lastUiSyncAtRef = useRef<number>(0);
    const pendingUiSyncRef = useRef<boolean>(false);
    const accumulatorRef = useRef<number>(0);
    const shotCooldownRef = useRef<number>(0);
    const bulletIdRef = useRef<number>(0);
    const specialEnemyIdRef = useRef<number>(STANDARD_ENEMY_COUNT);
    const enemyShotIdRef = useRef<number>(0);
    const powerUpIdRef = useRef<number>(0);
    const laserCooldownRef = useRef<number>(0);
    const fireBufferRef = useRef<number>(0);

    const syncUi = (force = false): void => {
        if (!force) {
            pendingUiSyncRef.current = false;
        }
        lastUiSyncAtRef.current = performance.now();
        startTransition(() => {
            setUiSnapshot(toUiSnapshot(runtimeRef.current));
        });
    };

    const spawnEnemy = (
        id: number,
        spawnFromTop = false,
        lane: EnemyLane = "standard",
        forcedKind?: EnemyKind,
        corruptedBytes = runtimeRef.current.corruptedBytes
    ): EnemyState => {
        return hydrateEnemyGeometry(
            buildEnemy(id, spawnFromTop, lane, forcedKind, corruptedBytes),
            playfieldMetricsRef.current,
            canvasContextRef.current
        );
    };

    const getShipAnchors = (
        playerX: number,
        playerY: number,
        runtime = runtimeRef.current
    ): Array<{ key: string; kind: "player" | "wingman"; side?: "left" | "right"; x: number; y: number; hp?: number }> => {
        const anchors: Array<{ key: string; kind: "player" | "wingman"; side?: "left" | "right"; x: number; y: number; hp?: number }> = [
            { key: "player", kind: "player", x: playerX, y: playerY },
        ];
        runtime.wingmen.forEach((wingman) => {
            if (!wingman.active) {
                return;
            }
            anchors.push({
                key: `wingman-${wingman.side}`,
                kind: "wingman",
                side: wingman.side,
                x: clamp(playerX + (wingman.side === "left" ? -PLAYER_WING_OFFSET : PLAYER_WING_OFFSET), 2, PLAYFIELD_WIDTH - 6),
                y: playerY,
                hp: wingman.hp,
            });
        });
        return anchors;
    };

    const refreshRuntimeEnemyGeometry = (): void => {
        const runtime = runtimeRef.current;
        const metrics = playfieldMetricsRef.current;
        const context = canvasContextRef.current;
        for (let index = 0; index < runtime.enemies.length; index += 1) {
            hydrateEnemyGeometry(runtime.enemies[index], metrics, context);
        }
    };

    const getEffectDurationFor = (kind: PowerUpKind): number => {
        if (kind === "dual") {
            return DUAL_DURATION_MS;
        }
        if (kind === "laser") {
            return LASER_DURATION_MS;
        }
        if (kind === "slow") {
            return SLOW_DURATION_MS;
        }
        return EXPLOSIVE_DURATION_MS;
    };

    const spawnPowerUpDrop = (x: number, y: number): void => {
        const runtime = runtimeRef.current;
        const roll = Math.random();
        if (roll > POWER_UP_DROP_CHANCE) {
            return;
        }

        const kindRoll = Math.random();
        const kind: PowerUpKind = kindRoll < 0.25
            ? "dual"
            : kindRoll < 0.5
                ? "laser"
                : kindRoll < 0.75
                    ? "slow"
                    : "explosive";
        runtime.powerUps.push({
            id: powerUpIdRef.current++,
            x,
            y,
            kind,
        });
    };

    const applyPowerUp = (kind: PowerUpKind): void => {
        const runtime = runtimeRef.current;
        const duration = getEffectDurationFor(kind);
        if (kind === "dual") {
            runtime.effects.dualMs = Math.max(runtime.effects.dualMs, duration);
            runtime.wingmen.forEach((wingman) => {
                wingman.active = true;
                wingman.hp = WINGMAN_START_HP;
                wingman.invulnerableMs = 0;
            });
            return;
        }
        if (kind === "laser") {
            runtime.effects.laserMs = Math.max(runtime.effects.laserMs, duration);
            return;
        }
        if (kind === "slow") {
            runtime.effects.slowMs = Math.max(runtime.effects.slowMs, duration);
            return;
        }
        runtime.effects.explosiveMs = Math.max(runtime.effects.explosiveMs, duration);
    };

    const spawnEnemyProjectile = (x: number, y: number, targetX: number, speedMultiplier = 1): void => {
        const runtime = runtimeRef.current;
        const dx = clamp(targetX - x, -14, 14);
        runtime.enemyShots.push({
            id: enemyShotIdRef.current++,
            x,
            y,
            vx: dx * 0.55,
            vy: ENEMY_PROJECTILE_SPEED * speedMultiplier,
        });
    };

    const reconcileSpecialEnemies = (): void => {
        const runtime = runtimeRef.current;
        const standardEnemies: EnemyState[] = [];
        const specialEnemies: EnemyState[] = [];

        for (let index = 0; index < runtime.enemies.length; index += 1) {
            const enemy = runtime.enemies[index];
            if (enemy.lane === "standard") {
                standardEnemies.push(enemy);
            } else {
                specialEnemies.push(enemy);
            }
        }

        if (runtime.phase !== "core") {
            runtime.enemies = standardEnemies;
            runtime.hostileCount = standardEnemies.length;
            return;
        }

        const allowedSpecialCount = getAllowedSpecialEnemyCount(runtime.corruptedBytes);

        while (specialEnemies.length < allowedSpecialCount) {
            specialEnemies.push(spawnEnemy(specialEnemyIdRef.current++, true, "special", undefined, runtime.corruptedBytes));
        }

        if (specialEnemies.length > allowedSpecialCount) {
            specialEnemies.length = allowedSpecialCount;
        }

        runtime.enemies = [...standardEnemies, ...specialEnemies];
        runtime.hostileCount = runtime.enemies.length;
    };

    const damageShipAt = (shipKey: string): boolean => {
        const runtime = runtimeRef.current;
        if (runtime.status !== "running") {
            return false;
        }

        if (shipKey === "player") {
            if (runtime.player.invulnerableMs > 0) {
                return false;
            }
            runtime.lives = Math.max(0, runtime.lives - 1);
            runtime.player.invulnerableMs = PLAYER_RESPITE_MS;
            if (runtime.lives <= 0) {
                runtime.status = "defeat";
            }
            return true;
        }

        const side = shipKey.endsWith("left") ? "left" : "right";
        const wingman = runtime.wingmen.find((candidate) => candidate.side === side);
        if (!wingman || !wingman.active || wingman.invulnerableMs > 0) {
            return false;
        }

        wingman.hp = Math.max(0, wingman.hp - 1);
        wingman.invulnerableMs = WINGMAN_RESPITE_MS;
        if (wingman.hp <= 0) {
            wingman.active = false;
            wingman.invulnerableMs = 0;
        }
        return true;
    };

    const startBossBattle = (): void => {
        const runtime = runtimeRef.current;
        if (runtime.phase === "boss") {
            return;
        }

        runtime.phase = "boss";
        runtime.enemies = [];
        runtime.enemyShots = [];
        runtime.powerUps = [];
        runtime.hostileCount = 1;
        runtime.boss = {
            x: 34,
            y: 9,
            vx: 9,
            health: BOSS_HEALTH,
            maxHealth: BOSS_HEALTH,
            fireCooldownMs: BOSS_FIRE_COOLDOWN_MS,
        };
    };

    const damageBoss = (amount: number): boolean => {
        const runtime = runtimeRef.current;
        if (!runtime.boss) {
            return false;
        }

        runtime.hits += 1;
        runtime.boss.health = Math.max(0, runtime.boss.health - amount);
        if (runtime.boss.health <= 0) {
            runtime.status = "victory";
        }
        return true;
    };

    const rebuildBackground = (): void => {
        const canvas = canvasRef.current;
        const playfield = playfieldRef.current;
        if (!canvas || !playfield) {
            return;
        }

        const metrics = buildPlayfieldMetrics(playfield);
        playfieldMetricsRef.current = metrics;
        canvas.width = Math.max(1, Math.round(metrics.width * metrics.dpr));
        canvas.height = Math.max(1, Math.round(metrics.height * metrics.dpr));
        canvas.style.width = `${metrics.width}px`;
        canvas.style.height = `${metrics.height}px`;

        const context = canvas.getContext("2d");
        canvasContextRef.current = context;
        if (!context) {
            return;
        }
        refreshRuntimeEnemyGeometry();
    };

    const drawScene = (alpha = 0): void => {
        const canvas = canvasRef.current;
        const context = canvasContextRef.current;
        const metrics = playfieldMetricsRef.current;
        if (!canvas || !context || !metrics) {
            return;
        }

        const runtime = runtimeRef.current;
        const alphaSeconds = (FIXED_DT_MS * alpha) / 1000;
        const moveX = (inputRef.current.right ? 1 : 0) - (inputRef.current.left ? 1 : 0);
        const moveY = (inputRef.current.down ? 1 : 0) - (inputRef.current.up ? 1 : 0);
        const renderPlayerX = clamp(runtime.player.x + (moveX * PLAYER_SPEED * alphaSeconds), 1.5, PLAYFIELD_WIDTH - 6);
        const renderPlayerY = clamp(runtime.player.y + (moveY * PLAYER_SPEED * alphaSeconds), 6, PLAYFIELD_HEIGHT - 6);
        const slowMultiplier = runtime.effects.slowMs > 0 ? SLOW_FACTOR : 1;
        const hostileSpeedMultiplier = runtime.phase === "core" && runtime.corruptedBytes >= CORE_SPEEDUP_THRESHOLD
            ? HOSTILE_OVERDRIVE_MULTIPLIER
            : 1;

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);

        context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
        context.textBaseline = "middle";
        context.textAlign = "center";
        context.font = `${metrics.fontScale}px Vga, Menlo, Monaco, Consolas, monospace`;

        const renderShipAnchors = getShipAnchors(renderPlayerX, renderPlayerY, runtime);

        if (runtime.effects.laserMs > 0 && inputRef.current.fire && runtime.status === "running") {
            context.strokeStyle = "rgba(180, 220, 255, 0.72)";
            context.lineWidth = 2;
            renderShipAnchors.forEach((anchor) => {
                context.beginPath();
                context.moveTo(anchor.x * metrics.xScale, anchor.y * metrics.yScale);
                context.lineTo(anchor.x * metrics.xScale, 0);
                context.stroke();
            });
        }

        const playerVisible = runtime.player.invulnerableMs <= 0 || Math.floor(runtime.player.invulnerableMs / 90) % 2 === 0;
        if (playerVisible) {
            context.textAlign = "center";
            for (let index = 0; index < renderShipAnchors.length; index += 1) {
                const anchor = renderShipAnchors[index];
                const wingmanInvulnerable = anchor.kind === "wingman"
                    ? runtime.wingmen[anchor.side === "left" ? 0 : 1]?.invulnerableMs
                    : 0;
                if (anchor.kind === "wingman" && wingmanInvulnerable && Math.floor(wingmanInvulnerable / 90) % 2 !== 0) {
                    continue;
                }
                context.fillStyle = anchor.kind === "wingman"
                    ? (anchor.hp === 1 ? "#ffb9c2" : "#d9d4ff")
                    : "#d8e4ff";
                context.fillText("<^>", anchor.x * metrics.xScale, anchor.y * metrics.yScale);
            }
        }

        context.textAlign = "center";
        runtime.bullets.forEach((bullet) => {
            context.fillStyle = bullet.kind === "explosive" ? "#ffd27d" : "#ff9aa8";
            context.fillText(bullet.kind === "explosive" ? "*" : "|", bullet.x * metrics.xScale, (bullet.y - (BULLET_SPEED * alphaSeconds)) * metrics.yScale);
        });

        context.fillStyle = "#ffad77";
        runtime.enemyShots.forEach((shot) => {
            context.fillText(
                "v",
                (shot.x + (shot.vx * alphaSeconds)) * metrics.xScale,
                (shot.y + (shot.vy * alphaSeconds * slowMultiplier * hostileSpeedMultiplier)) * metrics.yScale
            );
        });

        runtime.powerUps.forEach((powerUp) => {
            context.fillStyle = powerUp.kind === "laser"
                ? "#9fd4ff"
                : powerUp.kind === "slow"
                    ? "#9ff3c1"
                    : powerUp.kind === "explosive"
                        ? "#ffd27d"
                        : "#f6c5ff";
            context.fillText(POWER_UP_LABELS[powerUp.kind], powerUp.x * metrics.xScale, (powerUp.y + (POWER_UP_FALL_SPEED * alphaSeconds)) * metrics.yScale);
        });

        context.fillStyle = "#ff7d89";
        context.textAlign = "left";
        runtime.enemies.forEach((enemy) => {
            const width = enemy.width;
            const height = enemy.height;
            const lines = enemy.lines;
            const nextX = clamp(enemy.x + (enemy.vx * alphaSeconds * slowMultiplier * hostileSpeedMultiplier), 1, PLAYFIELD_WIDTH - width - 1);
            const nextY = enemy.y + (enemy.vy * alphaSeconds * slowMultiplier * hostileSpeedMultiplier);
            context.fillStyle = enemy.kind === "fast"
                ? "#ff6f7e"
                : enemy.kind === "block"
                    ? "#ffbe7d"
                    : enemy.kind === "gunner"
                        ? "#ff8f9d"
                        : "#ff7d89";
            lines.forEach((line, index) => {
                const lineY = nextY + ((height / lines.length) * (index + 0.5));
                context.fillText(line, nextX * metrics.xScale, lineY * metrics.yScale);
            });
        });

        if (runtime.phase === "boss" && runtime.boss) {
            const boss = runtime.boss;
            const renderBossX = clamp(boss.x + (boss.vx * alphaSeconds * slowMultiplier), 2, PLAYFIELD_WIDTH - BOSS_WIDTH - 2);
            const pixelX = renderBossX * metrics.xScale;
            const pixelY = boss.y * metrics.yScale;
            const pixelWidth = BOSS_WIDTH * metrics.xScale;
            const pixelHeight = BOSS_HEIGHT * metrics.yScale;

            context.strokeStyle = "#ff8aa0";
            context.lineWidth = 2;
            context.strokeRect(pixelX, pixelY, pixelWidth, pixelHeight);
            context.fillStyle = "rgba(255, 90, 116, 0.12)";
            context.fillRect(pixelX, pixelY, pixelWidth, pixelHeight);
            context.fillStyle = "#ffd6de";
            context.textAlign = "center";
            context.fillText("APHELION PRIME", pixelX + (pixelWidth * 0.5), pixelY + (pixelHeight * 0.33));
            context.fillText(`BOSS HP ${String(boss.health).padStart(2, "0")}`, pixelX + (pixelWidth * 0.5), pixelY + (pixelHeight * 0.68));
        }
    };

    const appendBullet = (): boolean => {
        const runtime = runtimeRef.current;
        if (runtime.status !== "running" || shotCooldownRef.current > 0) {
            return false;
        }

        const emitters = getShipAnchors(runtime.player.x + PLAYER_BULLET_EMIT_OFFSET_X, runtime.player.y, runtime);
        const bulletKind: BulletState["kind"] = runtime.effects.explosiveMs > 0 ? "explosive" : "normal";
        for (let index = 0; index < emitters.length; index += 1) {
            runtime.bullets.push({
                id: bulletIdRef.current++,
                x: emitters[index].x,
                y: runtime.player.y - 3,
                kind: bulletKind,
            });
        }
        runtime.shots += emitters.length;
        shotCooldownRef.current = SHOOT_COOLDOWN_MS;
        return true;
    };

    const corruptCore = (): boolean => {
        const runtime = runtimeRef.current;
        if (runtime.phase !== "core") {
            return false;
        }

        if (!runtime.uncorruptedByteIndices.length) {
            startBossBattle();
            return true;
        }

        const corruptionCount = Math.min(CORRUPTION_BYTES_PER_HIT, runtime.uncorruptedByteIndices.length);
        for (let index = 0; index < corruptionCount; index += 1) {
            const targetPosition = randomInt(0, runtime.uncorruptedByteIndices.length - 1);
            const [targetIndex] = runtime.uncorruptedByteIndices.splice(targetPosition, 1);
            runtime.coreBytes[targetIndex] = randomCorruptionByte();
            runtime.corruptedBytes += 1;
        }

        if (runtime.corruptedBytes >= CORE_BYTE_COUNT) {
            startBossBattle();
            return true;
        }
        return false;
    };

    const stepSimulation = (): boolean => {
        const runtime = runtimeRef.current;
        if (runtime.status !== "running") {
            return false;
        }

        let uiDirty = false;
        const dtSeconds = FIXED_DT_MS / 1000;
        const slowMultiplier = runtime.effects.slowMs > 0 ? SLOW_FACTOR : 1;
        const hostileSpeedMultiplier = runtime.phase === "core" && runtime.corruptedBytes >= CORE_SPEEDUP_THRESHOLD
            ? HOSTILE_OVERDRIVE_MULTIPLIER
            : 1;
        shotCooldownRef.current = Math.max(0, shotCooldownRef.current - FIXED_DT_MS);
        runtime.player.invulnerableMs = Math.max(0, runtime.player.invulnerableMs - FIXED_DT_MS);
        runtime.wingmen.forEach((wingman) => {
            wingman.invulnerableMs = Math.max(0, wingman.invulnerableMs - FIXED_DT_MS);
        });
        runtime.effects.dualMs = Math.max(0, runtime.effects.dualMs - FIXED_DT_MS);
        runtime.effects.laserMs = Math.max(0, runtime.effects.laserMs - FIXED_DT_MS);
        runtime.effects.slowMs = Math.max(0, runtime.effects.slowMs - FIXED_DT_MS);
        runtime.effects.explosiveMs = Math.max(0, runtime.effects.explosiveMs - FIXED_DT_MS);
        if (runtime.effects.dualMs <= 0) {
            runtime.wingmen.forEach((wingman) => {
                wingman.active = false;
                wingman.invulnerableMs = 0;
            });
        }
        reconcileSpecialEnemies();

        const moveX = (inputRef.current.right ? 1 : 0) - (inputRef.current.left ? 1 : 0);
        const moveY = (inputRef.current.down ? 1 : 0) - (inputRef.current.up ? 1 : 0);
        runtime.player.x = clamp(runtime.player.x + (moveX * PLAYER_SPEED * dtSeconds), 1.5, PLAYFIELD_WIDTH - 6);
        runtime.player.y = clamp(runtime.player.y + (moveY * PLAYER_SPEED * dtSeconds), 6, PLAYFIELD_HEIGHT - 6);
        let shipAnchors = getShipAnchors(runtime.player.x, runtime.player.y, runtime);
        const refreshShipAnchors = (): typeof shipAnchors => {
            shipAnchors = getShipAnchors(runtime.player.x, runtime.player.y, runtime);
            return shipAnchors;
        };

        const damageEnemyAt = (enemyIndex: number, instantKill = false): void => {
            const currentEnemy = runtime.enemies[enemyIndex];
            if (!currentEnemy) {
                return;
            }

            runtime.hits += 1;
            const bossTriggered = corruptCore();
            uiDirty = true;
            if (bossTriggered) {
                return;
            }

            if (instantKill || currentEnemy.body.length <= 2) {
                const enemyCenterX = currentEnemy.x + (currentEnemy.width * 0.5);
                const enemyCenterY = currentEnemy.y + (currentEnemy.height * 0.5);
                runtime.purged += 1;
                spawnPowerUpDrop(enemyCenterX, enemyCenterY);
                runtime.enemies[enemyIndex] = spawnEnemy(
                    currentEnemy.id,
                    true,
                    currentEnemy.lane,
                    currentEnemy.lane === "standard" ? "standard" : undefined,
                    runtime.corruptedBytes
                );
                return;
            }

            currentEnemy.body = currentEnemy.body.slice(0, -2);
            currentEnemy.vy = Math.min(currentEnemy.vy + 0.35, currentEnemy.kind === "fast" ? 26 : 18);
            hydrateEnemyGeometry(currentEnemy, playfieldMetricsRef.current, canvasContextRef.current);
        };

        const fireLaserVolley = (): void => {
            if (laserCooldownRef.current > 0) {
                laserCooldownRef.current = Math.max(0, laserCooldownRef.current - FIXED_DT_MS);
                return;
            }

            laserCooldownRef.current = LASER_TICK_MS;
            for (let emitterIndex = 0; emitterIndex < shipAnchors.length; emitterIndex += 1) {
                const emitterX = shipAnchors[emitterIndex].x;
                if (runtime.phase === "boss" && runtime.boss) {
                    const bossHit = emitterX >= runtime.boss.x && emitterX <= runtime.boss.x + BOSS_WIDTH;
                    if (bossHit) {
                        damageBoss(2);
                        uiDirty = true;
                        continue;
                    }
                }

                let enemyIndex = -1;
                let enemyY = Number.POSITIVE_INFINITY;
                for (let index = 0; index < runtime.enemies.length; index += 1) {
                    const enemy = runtime.enemies[index];
                    if (emitterX >= enemy.x && emitterX <= enemy.x + enemy.width && enemy.y < enemyY) {
                        enemyIndex = index;
                        enemyY = enemy.y;
                    }
                }

                if (enemyIndex !== -1) {
                    damageEnemyAt(enemyIndex);
                }
            }
        };

        if (runtime.effects.laserMs > 0 && inputRef.current.fire) {
            fireLaserVolley();
        } else if ((fireBufferRef.current > 0 || inputRef.current.fire) && appendBullet()) {
            uiDirty = true;
            if (fireBufferRef.current > 0) {
                fireBufferRef.current -= 1;
            }
        }

        const nextBullets: BulletState[] = [];
        for (let index = 0; index < runtime.bullets.length; index += 1) {
            const bullet = runtime.bullets[index];
            bullet.y -= BULLET_SPEED * dtSeconds;
            if (bullet.y > -4) {
                nextBullets.push(bullet);
            }
        }
        runtime.bullets = nextBullets;

        const nextPowerUps: PowerUpState[] = [];
        for (let index = 0; index < runtime.powerUps.length; index += 1) {
            const powerUp = runtime.powerUps[index];
            powerUp.y += POWER_UP_FALL_SPEED * dtSeconds;
            let collectingShip: (typeof shipAnchors)[number] | null = null;
            for (let anchorIndex = 0; anchorIndex < shipAnchors.length; anchorIndex += 1) {
                const anchor = shipAnchors[anchorIndex];
                const radiusX = anchor.kind === "wingman" ? PLAYER_COLLISION_RADIUS_X + 0.2 : PLAYER_COLLISION_RADIUS_X;
                const radiusY = anchor.kind === "wingman" ? PLAYER_COLLISION_RADIUS_Y + 0.2 : PLAYER_COLLISION_RADIUS_Y + 1.2;
                if (Math.abs(powerUp.x - anchor.x) <= radiusX && Math.abs(powerUp.y - anchor.y) <= radiusY) {
                    collectingShip = anchor;
                    break;
                }
            }
            if (collectingShip) {
                applyPowerUp(powerUp.kind);
                uiDirty = true;
                refreshShipAnchors();
                continue;
            }
            if (powerUp.y <= PLAYFIELD_HEIGHT + 4) {
                nextPowerUps.push(powerUp);
            }
        }
        runtime.powerUps = nextPowerUps;

        const nextEnemyShots: EnemyProjectileState[] = [];
        for (let index = 0; index < runtime.enemyShots.length; index += 1) {
            const shot = runtime.enemyShots[index];
            shot.x += shot.vx * dtSeconds;
            shot.y += shot.vy * dtSeconds * slowMultiplier * hostileSpeedMultiplier;
            let hitShip: (typeof shipAnchors)[number] | null = null;
            for (let anchorIndex = 0; anchorIndex < shipAnchors.length; anchorIndex += 1) {
                const anchor = shipAnchors[anchorIndex];
                const radiusX = anchor.kind === "wingman" ? PLAYER_PROJECTILE_COLLISION_RADIUS_X + 0.15 : PLAYER_PROJECTILE_COLLISION_RADIUS_X;
                const radiusY = anchor.kind === "wingman" ? PLAYER_PROJECTILE_COLLISION_RADIUS_Y + 0.1 : PLAYER_PROJECTILE_COLLISION_RADIUS_Y;
                if (Math.abs(shot.x - anchor.x) <= radiusX && Math.abs(shot.y - anchor.y) <= radiusY) {
                    hitShip = anchor;
                    break;
                }
            }
            if (hitShip) {
                const damaged = damageShipAt(hitShip.key);
                uiDirty = damaged || uiDirty;
                if (damaged) {
                    refreshShipAnchors();
                }
                continue;
            }
            if (shot.y <= PLAYFIELD_HEIGHT + 4) {
                nextEnemyShots.push(shot);
            }
        }
        runtime.enemyShots = nextEnemyShots;

        if (runtime.phase === "core") {
            for (let index = 0; index < runtime.enemies.length; index += 1) {
                const enemy = runtime.enemies[index];
                const width = enemy.width;
                let nextEnemyX = enemy.x + (enemy.vx * dtSeconds * slowMultiplier * hostileSpeedMultiplier);
                let nextEnemyVx = enemy.vx;

                if (nextEnemyX <= 1) {
                    nextEnemyX = 1;
                    nextEnemyVx = Math.abs(nextEnemyVx);
                }
                if (nextEnemyX >= PLAYFIELD_WIDTH - width - 1) {
                    nextEnemyX = PLAYFIELD_WIDTH - width - 1;
                    nextEnemyVx = -Math.abs(nextEnemyVx);
                }

                enemy.x = nextEnemyX;
                enemy.y += enemy.vy * dtSeconds * slowMultiplier * hostileSpeedMultiplier;
                enemy.vx = nextEnemyVx;

                if (enemy.kind === "gunner") {
                    enemy.fireCooldownMs = Math.max(0, enemy.fireCooldownMs - (FIXED_DT_MS * hostileSpeedMultiplier));
                    if (enemy.fireCooldownMs <= 0 && enemy.y > 10) {
                        spawnEnemyProjectile(enemy.x + (width * 0.5), enemy.y + enemy.height, runtime.player.x, slowMultiplier * hostileSpeedMultiplier);
                        enemy.fireCooldownMs = randomInt(720, 1450);
                        uiDirty = true;
                    }
                }

                if (enemy.y >= ENEMY_Y_LIMIT) {
                    runtime.enemies[index] = spawnEnemy(
                        enemy.id,
                        true,
                        enemy.lane,
                        enemy.lane === "standard" ? "standard" : undefined,
                        runtime.corruptedBytes
                    );
                    continue;
                }
            }

            for (let index = 0; index < runtime.enemies.length; index += 1) {
                const enemy = runtime.enemies[index];
                const enemyWidth = enemy.width;
                const enemyHeight = enemy.height;
                const enemyCenterX = enemy.x + (enemyWidth * 0.5);
                const enemyCenterY = enemy.y + (enemyHeight * 0.5);
                const collisionEnemyHalfWidth = Math.max(0.55, (enemyWidth * 0.5) - ENEMY_PLAYER_COLLISION_INSET_X);
                const collisionEnemyHalfHeight = Math.max(0.45, (enemyHeight * 0.5) - ENEMY_PLAYER_COLLISION_INSET_Y);
                const collidingShip = shipAnchors.find((anchor) => {
                    const radiusX = anchor.kind === "wingman" ? PLAYER_COLLISION_RADIUS_X + 0.12 : PLAYER_COLLISION_RADIUS_X;
                    const radiusY = anchor.kind === "wingman" ? PLAYER_COLLISION_RADIUS_Y + 0.08 : PLAYER_COLLISION_RADIUS_Y;
                    return Math.abs(enemyCenterX - anchor.x) <= collisionEnemyHalfWidth + radiusX
                        && Math.abs(enemyCenterY - anchor.y) <= collisionEnemyHalfHeight + radiusY;
                });

                if (!collidingShip) {
                    continue;
                }

                const damaged = damageShipAt(collidingShip.key);
                uiDirty = damaged || uiDirty;
                if (damaged) {
                    refreshShipAnchors();
                }
                runtime.enemies[index] = spawnEnemy(enemy.id, true, enemy.lane, enemy.lane === "standard" ? "standard" : undefined, runtime.corruptedBytes);
            }
        } else if (runtime.boss) {
            let nextBossX = runtime.boss.x + (runtime.boss.vx * dtSeconds * slowMultiplier);
            if (nextBossX <= 2) {
                nextBossX = 2;
                runtime.boss.vx = Math.abs(runtime.boss.vx);
            }
            if (nextBossX >= PLAYFIELD_WIDTH - BOSS_WIDTH - 2) {
                nextBossX = PLAYFIELD_WIDTH - BOSS_WIDTH - 2;
                runtime.boss.vx = -Math.abs(runtime.boss.vx);
            }
            runtime.boss.x = nextBossX;
            runtime.boss.fireCooldownMs = Math.max(0, runtime.boss.fireCooldownMs - FIXED_DT_MS);
            if (runtime.boss.fireCooldownMs <= 0) {
                [0.12, 0.34, 0.56, 0.78, 0.9].forEach((ratio) => {
                    spawnEnemyProjectile(runtime.boss!.x + (BOSS_WIDTH * ratio), runtime.boss!.y + BOSS_HEIGHT, runtime.player.x, slowMultiplier * 1.1);
                });
                runtime.boss.fireCooldownMs = BOSS_FIRE_COOLDOWN_MS;
                uiDirty = true;
            }

            const bossCenterX = runtime.boss.x + (BOSS_WIDTH * 0.5);
            const bossCenterY = runtime.boss.y + (BOSS_HEIGHT * 0.5);
            const bossCollisionHalfWidth = Math.max(1.2, (BOSS_WIDTH * 0.5) - BOSS_PLAYER_COLLISION_INSET_X);
            const bossCollisionHalfHeight = Math.max(0.8, (BOSS_HEIGHT * 0.5) - BOSS_PLAYER_COLLISION_INSET_Y);
            const collidingShip = shipAnchors.find((anchor) => {
                const radiusX = anchor.kind === "wingman" ? PLAYER_BOSS_COLLISION_RADIUS_X + 0.1 : PLAYER_BOSS_COLLISION_RADIUS_X;
                const radiusY = anchor.kind === "wingman" ? PLAYER_BOSS_COLLISION_RADIUS_Y + 0.08 : PLAYER_BOSS_COLLISION_RADIUS_Y;
                return Math.abs(bossCenterX - anchor.x) <= bossCollisionHalfWidth + radiusX
                    && Math.abs(bossCenterY - anchor.y) <= bossCollisionHalfHeight + radiusY;
            });
            if (collidingShip) {
                const damaged = damageShipAt(collidingShip.key);
                uiDirty = damaged || uiDirty;
                if (damaged) {
                    refreshShipAnchors();
                }
            }
        }

        if (runtime.bullets.length) {
            const remainingBullets: BulletState[] = [];

            for (let bulletIndex = 0; bulletIndex < runtime.bullets.length; bulletIndex += 1) {
                const bullet = runtime.bullets[bulletIndex];
                if (runtime.phase === "boss" && runtime.boss) {
                    const hitsBoss = bullet.x >= runtime.boss.x
                        && bullet.x <= runtime.boss.x + BOSS_WIDTH
                        && bullet.y >= runtime.boss.y
                        && bullet.y <= runtime.boss.y + BOSS_HEIGHT;
                    if (hitsBoss) {
                        uiDirty = damageBoss(bullet.kind === "explosive" ? 5 : 1) || uiDirty;
                        return;
                    }
                }

                let enemyIndex = -1;
                for (let index = 0; index < runtime.enemies.length; index += 1) {
                    const enemy = runtime.enemies[index];
                    if (bullet.x >= enemy.x
                        && bullet.x <= enemy.x + enemy.width
                        && bullet.y >= enemy.y
                        && bullet.y <= enemy.y + enemy.height) {
                        enemyIndex = index;
                        break;
                    }
                }

                if (enemyIndex === -1) {
                    remainingBullets.push(bullet);
                    continue;
                }

                damageEnemyAt(enemyIndex, bullet.kind === "explosive");
            }

            runtime.bullets = remainingBullets;
        }

        if (runtime.effects.laserMs <= 0) {
            laserCooldownRef.current = 0;
        }

        return uiDirty;
    };

    const handleReset = (): void => {
        runtimeRef.current = createInitialRuntime();
        bulletIdRef.current = 0;
        specialEnemyIdRef.current = STANDARD_ENEMY_COUNT;
        enemyShotIdRef.current = 0;
        powerUpIdRef.current = 0;
        shotCooldownRef.current = 0;
        laserCooldownRef.current = 0;
        fireBufferRef.current = 0;
        accumulatorRef.current = 0;
        lastFrameAtRef.current = 0;
        lastRenderAtRef.current = 0;
        lastUiSyncAtRef.current = 0;
        pendingUiSyncRef.current = false;
        syncUi(true);
        rebuildBackground();
        drawScene();
    };

    const setDirection = (direction: InputDirection, active: boolean): void => {
        inputRef.current[direction] = active;
    };

    const setFire = (active: boolean): void => {
        inputRef.current.fire = active;
    };

    const pulseFire = (): void => {
        fireBufferRef.current += 1;
    };

    useEffect(() => {
        onRendered && onRendered();
    }, [onRendered]);

    useEffect(() => {
        if (uiSnapshotNeedsReset(uiSnapshot)) {
            handleReset();
        }
    }, [uiSnapshot]);

    useEffect(() => {
        document.body.classList.add("mainframe-game--performance");
        rebuildBackground();
        drawScene();

        const tick = (now: number): void => {
            if (!lastFrameAtRef.current) {
                lastFrameAtRef.current = now;
            }

            let frameTime = now - lastFrameAtRef.current;
            lastFrameAtRef.current = now;
            frameTime = Math.min(frameTime, MAX_FRAME_MS);
            accumulatorRef.current += frameTime;

            let uiDirty = false;
            while (accumulatorRef.current >= FIXED_DT_MS) {
                accumulatorRef.current -= FIXED_DT_MS;
                uiDirty = stepSimulation() || uiDirty;
            }

            const shouldRender = !lastRenderAtRef.current
                || (now - lastRenderAtRef.current) >= MIN_RENDER_INTERVAL_MS
                || uiDirty;
            if (shouldRender) {
                drawScene(accumulatorRef.current / FIXED_DT_MS);
                lastRenderAtRef.current = now;
            }
            if (uiDirty) {
                pendingUiSyncRef.current = true;
            }
            const shouldSyncUi = pendingUiSyncRef.current
                && (
                    !lastUiSyncAtRef.current
                    || (now - lastUiSyncAtRef.current) >= UI_SYNC_INTERVAL_MS
                    || runtimeRef.current.status !== "running"
                );
            if (shouldSyncUi) {
                syncUi();
            }

            frameRef.current = window.requestAnimationFrame(tick);
        };

        frameRef.current = window.requestAnimationFrame(tick);

        let observer: ResizeObserver | null = null;
        if (playfieldRef.current && typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(() => {
                rebuildBackground();
                drawScene();
            });
            observer.observe(playfieldRef.current);
        }

        return () => {
            observer && observer.disconnect();
            if (frameRef.current !== null) {
                window.cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            document.body.classList.remove("mainframe-game--performance");
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            const key = event.key.toLowerCase();
            const controlledKey = [
                "arrowup", "arrowdown", "arrowleft", "arrowright",
                "w", "a", "s", "d", " ", "spacebar", "enter", "r",
            ].includes(key);

            if (controlledKey) {
                event.preventDefault();
            }

            if (key === "arrowup" || key === "w") {
                setDirection("up", true);
            }
            if (key === "arrowdown" || key === "s") {
                setDirection("down", true);
            }
            if (key === "arrowleft" || key === "a") {
                setDirection("left", true);
            }
            if (key === "arrowright" || key === "d") {
                setDirection("right", true);
            }
            if (key === " " || key === "spacebar" || key === "enter") {
                setFire(true);
                pulseFire();
            }
            if (key === "r") {
                handleReset();
            }
        };

        const handleKeyUp = (event: KeyboardEvent): void => {
            const key = event.key.toLowerCase();
            if (key === "arrowup" || key === "w") {
                setDirection("up", false);
            }
            if (key === "arrowdown" || key === "s") {
                setDirection("down", false);
            }
            if (key === "arrowleft" || key === "a") {
                setDirection("left", false);
            }
            if (key === "arrowright" || key === "d") {
                setDirection("right", false);
            }
            if (key === " " || key === "spacebar" || key === "enter") {
                setFire(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    const coreRows = useMemo(() => {
        const rowCount = Math.ceil(CORE_BYTE_COUNT / CORE_BYTES_PER_ROW);
        return Array.from({ length: rowCount }, (_, rowIndex) => {
            const start = rowIndex * CORE_BYTES_PER_ROW;
            return {
                offset: start.toString(16).padStart(4, "0"),
                bytes: uiSnapshot.coreBytes.slice(start, start + CORE_BYTES_PER_ROW),
            };
        });
    }, [uiSnapshot.coreBytes]);
    const coreRowBanks = useMemo(() => {
        const rowsPerBank = Math.ceil(coreRows.length / CORE_COLUMN_COUNT);
        return Array.from({ length: CORE_COLUMN_COUNT }, (_, bankIndex) => {
            const start = bankIndex * rowsPerBank;
            return coreRows.slice(start, start + rowsPerBank);
        });
    }, [coreRows]);

    const integrityPercent = Math.max(0, Math.round(((CORE_BYTE_COUNT - uiSnapshot.corruptedBytes) / CORE_BYTE_COUNT) * 100));
    const integrityMeter = `${"#".repeat(Math.max(0, Math.round(integrityPercent / 10))).padEnd(10, "-")}`;
    const containerClassName = ["mainframe-game", className].filter(Boolean).join(" ").trim();
    const livesDisplay = Number.isFinite(uiSnapshot.lives) ? uiSnapshot.lives : PLAYER_START_LIVES;
    const bossIntegrityPercent = uiSnapshot.bossMaxHealth > 0
        ? Math.max(0, Math.round((uiSnapshot.bossHealth / uiSnapshot.bossMaxHealth) * 100))
        : 0;
    const activeEffects = [
        uiSnapshot.effects.dualMs > 0 ? `DUAL ${Math.ceil(uiSnapshot.effects.dualMs / 1000)}S` : null,
        uiSnapshot.effects.laserMs > 0 ? `LASER ${Math.ceil(uiSnapshot.effects.laserMs / 1000)}S` : null,
        uiSnapshot.effects.slowMs > 0 ? `SLOW ${Math.ceil(uiSnapshot.effects.slowMs / 1000)}S` : null,
        uiSnapshot.effects.explosiveMs > 0 ? `BURST ${Math.ceil(uiSnapshot.effects.explosiveMs / 1000)}S` : null,
    ].filter(Boolean).join(" | ");
    const wingStatus = uiSnapshot.wingmanHealths.some((health) => health > 0)
        ? `[WINGS ${uiSnapshot.wingmanHealths.map((health, index) => `${index === 0 ? "L" : "R"}:${health}`).join(" ")}]`
        : "[WINGS OFFLINE]";
    const overlayTitle = uiSnapshot.status === "victory"
        ? "APHELION DOWN"
        : "PILOT LOST";
    const overlayCopy = uiSnapshot.status === "victory"
        ? "The memory core and final command shell have both been purged."
        : "A hostile code shard breached the cockpit frame.";

    return (
        <div className={containerClassName}>
            <div className="mainframe-game__topline">
                <span>[APHELION_MAINFRAME//{uiSnapshot.phase === "boss" ? "FINAL SHELL" : "FIXED PROCESS"}]</span>
                <span>
                    {uiSnapshot.phase === "boss"
                        ? `[BOSS SHELL ${String(bossIntegrityPercent).padStart(3, "0")}%]`
                        : `[HOSTILE CORE INTEGRITY ${String(integrityPercent).padStart(3, "0")}%]`}
                </span>
                <span>[LIVES {String(livesDisplay).padStart(2, "0")}/03]</span>
            </div>

            <div className="mainframe-game__layout">
                <section className="mainframe-game__panel mainframe-game__panel--playfield">
                    <header className="mainframe-game__panel-header">
                        <span>TARGET LATTICE</span>
                        <span>MOVE: WASD / ARROWS</span>
                        <span>FIRE: SPACE / ENTER</span>
                    </header>

                    <div ref={playfieldRef} className="mainframe-game__playfield">
                        <canvas ref={canvasRef} className="mainframe-game__canvas" aria-label="Aphelion mainframe combat area" />

                        {uiSnapshot.status !== "running" && (
                            <div className="mainframe-game__overlay">
                                <div className="mainframe-game__overlay-box">
                                    <div className="mainframe-game__overlay-title">{overlayTitle}</div>
                                    <div className="mainframe-game__overlay-copy">{overlayCopy}</div>
                                    <button
                                        type="button"
                                        className="mainframe-game__button"
                                        onClick={handleReset}
                                    >
                                        RESTART BREACH
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <footer className="mainframe-game__panel-footer">
                        <span>[HITS {String(uiSnapshot.hits).padStart(3, "0")}]</span>
                        <span>[HOSTILES {String(uiSnapshot.hostileCount).padStart(2, "0")}]</span>
                        <span>[SHOTS {String(uiSnapshot.shots).padStart(3, "0")}]</span>
                    </footer>
                </section>

                <section className="mainframe-game__panel mainframe-game__panel--core">
                    <header className="mainframe-game__panel-header">
                        <span>AI MEMORY CORE</span>
                        <span>{CORE_BYTE_COUNT} BYTES</span>
                        <span>{`[${integrityMeter}]`}</span>
                    </header>

                    <div className="mainframe-game__core">
                        {coreRowBanks.map((bank, bankIndex) => (
                            <div key={`bank-${bankIndex}`} className="mainframe-game__core-bank">
                                {bank.map((row) => (
                                    <div key={row.offset} className="mainframe-game__core-row">
                                        <span className="mainframe-game__core-offset">{row.offset}</span>
                                        <span className="mainframe-game__core-bytes">
                                            {row.bytes.map((value, index) => (
                                                <span
                                                    key={`${row.offset}-${index}`}
                                                    className={
                                                        "mainframe-game__core-byte"
                                                        + (/^[0-9a-f]{2}$/i.test(value) ? "" : " mainframe-game__core-byte--corrupted")
                                                    }
                                                >
                                                    {value}
                                                </span>
                                            ))}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>

                    <footer className="mainframe-game__panel-footer">
                        <span>{uiSnapshot.phase === "boss" ? "[FINAL SHELL VULNERABLE]" : "[BREACH DELTA +3 BYTES / HIT]"}</span>
                        <span>{uiSnapshot.phase === "boss" ? "[DODGE RETURN FIRE]" : "[TARGET RESPINS AFTER PURGE]"}</span>
                    </footer>
                </section>
            </div>

            <div className="mainframe-game__bottomline">
                <span>{activeEffects ? `[POWERUPS ${activeEffects}] ${wingStatus}` : "[SALVAGE POWERUPS TO STACK ADVANTAGES]"}</span>
                <span>{uiSnapshot.phase === "boss" ? "[DESTROY APHELION PRIME TO WIN]" : "[DEPLETING THE CORE SUMMONS THE BOSS SHELL]"}</span>
                <button type="button" className="mainframe-game__button mainframe-game__button--secondary" onClick={handleReset}>
                    RESET
                </button>
            </div>

            <div className="mainframe-game__touch-controls">
                <div className="mainframe-game__touch-pad">
                    {(["up", "left", "down", "right"] as const).map((direction) => (
                        <button
                            key={direction}
                            type="button"
                            className={`mainframe-game__touch-button mainframe-game__touch-button--${direction}`}
                            onPointerDown={() => setDirection(direction, true)}
                            onPointerUp={() => setDirection(direction, false)}
                            onPointerLeave={() => setDirection(direction, false)}
                            onPointerCancel={() => setDirection(direction, false)}
                        >
                            {direction.toUpperCase()}
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    className="mainframe-game__touch-fire"
                    onPointerDown={() => {
                        setFire(true);
                        pulseFire();
                    }}
                    onPointerUp={() => setFire(false)}
                    onPointerLeave={() => setFire(false)}
                    onPointerCancel={() => setFire(false)}
                >
                    FIRE
                </button>
            </div>
        </div>
    );
};

export default MainframeGame;
