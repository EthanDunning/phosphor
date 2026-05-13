/// <reference lib="webworker" />

import type {
    BossAttackMode,
    BossFirewallState,
    BulletState,
    CoreByteUpdate,
    InputDirection,
    EnemyLane,
    EnemyKind,
    EnemyState,
    PowerUpKind,
    PowerUpState,
    RenderSnapshot,
    RuntimeSnapshot,
    SoundEvent,
    UiSnapshot,
    WorkerFrameGameState,
    WorkerFrameMessage,
} from "./shared";
import {
    BOSS_ATTACK_MODE_DURATION_MS,
    BOSS_FIRE_COOLDOWN_MS,
    BOSS_FIREWALL_BURST_COUNT,
    BOSS_HEALTH,
    BOSS_HEIGHT,
    BOSS_PLAYER_COLLISION_INSET_X,
    BOSS_PLAYER_COLLISION_INSET_Y,
    BOSS_SUMMON_COOLDOWN_MS,
    BOSS_SHIELD_HP,
    BOSS_FIREWALL_SPEED,
    BOSS_FIREWALL_HALF_THICKNESS,
    BOSS_FIREWALL_FADE_RATE,
    BOSS_POWERUP_INTERVAL_MS,
    BOSS_SHIELDED_ENEMY_CAP,
    BOSS_UNSHIELDED_ENEMY_CAP,
    BOSS_WIDTH,
    BULLET_SPEED,
    CORE_BYTE_COUNT,
    CORE_STAGE_COUNT,
    CORE_PHASE_ONE_END,
    CORE_PHASE_TWO_END,
    CORE_SPEEDUP_THRESHOLD,
    CORRUPTION_BYTES_PER_HIT,
    CORRUPTION_SYMBOLS,
    DEFAULT_BLOCK_LINE_HEIGHT,
    DEFAULT_ENEMY_CHAR_WORLD_WIDTH,
    DUAL_DURATION_MS,
    ENEMY_PLAYER_COLLISION_INSET_X,
    ENEMY_PLAYER_COLLISION_INSET_Y,
    ENEMY_PROJECTILE_SPEED,
    ENEMY_Y_LIMIT,
    EXPLOSIVE_DURATION_MS,
    FIXED_DT_MS,
    HEX_DIGITS,
    HOSTILE_OVERDRIVE_MULTIPLIER,
    LASER_DURATION_MS,
    LASER_TICK_MS,
    MAX_FRAME_MS,
    MAX_SPECIAL_ENEMY_COUNT,
    PLAYER_BOSS_COLLISION_RADIUS_X,
    PLAYER_BOSS_COLLISION_RADIUS_Y,
    PLAYER_BULLET_EMIT_OFFSET_X,
    PLAYER_COLLISION_RADIUS_X,
    PLAYER_COLLISION_RADIUS_Y,
    PLAYER_PROJECTILE_COLLISION_RADIUS_X,
    PLAYER_PROJECTILE_COLLISION_RADIUS_Y,
    PLAYER_MAX_HEALTH,
    HIT_DAMAGE,
    SHIELD_MAX_HP,
    SHIELD_RESPITE_MS,
    HEALTH_PACK_RESTORE,
    COMET_CHAR_HEIGHT,
    PLAYER_RESPITE_MS,
    PLAYER_SPEED,
    PLAYER_WING_OFFSET,
    PLAYFIELD_HEIGHT,
    PLAYFIELD_WIDTH,
    POWER_UP_DROP_CHANCE,
    POWER_UP_FALL_SPEED,
    POWER_UP_LABELS,
    SHOOT_COOLDOWN_MS,
    SLOW_DURATION_MS,
    SLOW_FACTOR,
    STANDARD_ENEMY_COUNT,
    UI_SYNC_INTERVAL_MS,
    WINGMAN_RESPITE_MS,
    WINGMAN_START_HP,
} from "./shared";

type WorkerControlMessage =
    | { type: "init"; canvas?: OffscreenCanvas; width?: number; height?: number; dpr?: number; renderInWorker?: boolean }
    | { type: "resize"; width: number; height: number; dpr: number }
    | { type: "reset" }
    | { type: "dispose" }
    | { type: "pulseFire" }
    | { type: "setFire"; active: boolean }
    | { type: "setDirection"; direction: InputDirection; active: boolean }
    | { type: "devGotoBoss" }
    | { type: "devToggleInvulnerable" }
    | { type: "devPowerUp"; kind: PowerUpKind }
    | { type: "devHeal" }
    | { type: "devSkipCollapse" };

interface InputState {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    fire: boolean;
}

const inputState: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false,
};

let runtime!: RuntimeSnapshot;
let loopHandle = 0;
let loopUsesAnimationFrame = false;
let isRunning = false;
let lastFrameAt = 0;
let accumulator = 0;
let lastUiSyncAt = 0;
let shotCooldownRemainingMs = 0;
let bulletId = 0;
let standardEnemyId = STANDARD_ENEMY_COUNT;
let specialEnemyId = STANDARD_ENEMY_COUNT;
let enemyShotId = 0;
let powerUpId = 0;
let laserCooldownMs = 0;
let fireBufferCount = 0;
let pendingCoreUpdates: CoreByteUpdate[] = [];
let pendingSounds: SoundEvent[] = [];
let terminalUiPosted = false;
let devInvulnerable = false;
let bossPowerUpCooldownMs = 0;
let bossFirewallsRemaining = 0;
let bossPatternIndex = 0;
let lastFirewallDirection: BossFirewallState["direction"] | "" = "";
let collapseByteIndices: number[] = [];
let finalGlitchRemainingMs = 0;
let finalShutdownRemainingMs = 0;
let renderInWorker = false;
let renderCanvas: OffscreenCanvas | null = null;
let renderContext: OffscreenCanvasRenderingContext2D | null = null;
let renderMetrics: { width: number; height: number; dpr: number; xScale: number; yScale: number; fontScale: number } | null = null;

type WorkerScopeWithAnimationFrame = DedicatedWorkerGlobalScope & {
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
};

const workerScope = self as unknown as WorkerScopeWithAnimationFrame;
const MATRIX_TRAIL_CHARS = "01<>[]{}()#$%&*+-/\\|:=!?";
const BOSS_PATTERN_ORDER: BossAttackMode[] = ["volley", "rain", "sweep"];
const CORE_POWER_UP_DROP_MULTIPLIER = 0.55;
const FINAL_COLLAPSE_BYTES_PER_HIT = 16;
const FINAL_GLITCH_DURATION_MS = 5000;
const FINAL_BLACKOUT_DURATION_MS = 2600;
const CORE_ENEMY_UNLOCK_BYTES = {
    standard: 0,
    gunner: 96,
    fast: 192,
    block: 288,
    comet: 384,
    sniper: 448,
} as const;
const CORE_STANDARD_ENEMY_MAX = 8;
const CORE_SPECIAL_ENEMY_MAX = 4;
const CORE_MAX_ENEMIES = 28;
const CORE_FULL_ROSTER_BYTES = CORE_BYTE_COUNT / 2;

const pickFirewallDir = (): BossFirewallState["direction"] => {
    const dirs = (["top", "bottom", "left", "right"] as const).filter((d) => d !== lastFirewallDirection);
    const dir = dirs[Math.floor(Math.random() * dirs.length)];
    lastFirewallDirection = dir;
    return dir;
};

const buildCenteredBar = (fraction: number, width: number): string => {
    const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
    const pad = Math.floor((width - filled) / 2);
    return " ".repeat(pad) + "=".repeat(filled) + " ".repeat(width - filled - pad);
};

const getProjectileChar = (vx: number, vy: number): string => {
    if (Math.abs(vy) >= Math.abs(vx)) {
        return vy >= 0 ? "v" : "^";
    }
    return vx >= 0 ? ">" : "<";
};
const CORE_STAGE_THREE_START = 128;

const BOSS_ATTACK_LABELS: Record<BossAttackMode, string> = {
    firewall: "FIREWALL",
    volley: "VOLLEY",
    rain: "CODE RAIN",
    sweep: "LATTICE SWEEP",
};

const clamp = (value: number, min: number, max: number): number => {
    return Math.min(max, Math.max(min, value));
};

const updateRenderMetrics = (width: number, height: number, dpr: number): void => {
    if (!renderCanvas) {
        return;
    }

    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const safeDpr = Math.max(1, dpr || 1);
    renderCanvas.width = Math.max(1, Math.round(safeWidth * safeDpr));
    renderCanvas.height = Math.max(1, Math.round(safeHeight * safeDpr));
    renderMetrics = {
        width: safeWidth,
        height: safeHeight,
        dpr: safeDpr,
        xScale: safeWidth / PLAYFIELD_WIDTH,
        yScale: safeHeight / PLAYFIELD_HEIGHT,
        fontScale: Math.max(11, Math.min(safeWidth * 0.019, safeHeight * 0.045)),
    };
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

const randomMatrixTrailChar = (): string => {
    return MATRIX_TRAIL_CHARS[randomInt(0, MATRIX_TRAIL_CHARS.length - 1)];
};

const randomMatrixTrail = (length: number): string => {
    return Array.from({ length }, (_, index) => (index === 0 ? "@" : randomMatrixTrailChar())).join("");
};

const randomCorruptionByte = (): string => {
    const left = CORRUPTION_SYMBOLS[randomInt(0, CORRUPTION_SYMBOLS.length - 1)];
    const right = CORRUPTION_SYMBOLS[randomInt(0, CORRUPTION_SYMBOLS.length - 1)];
    return `${left}${right}`;
};

const buildUncorruptedByteIndices = (): number[] => {
    return Array.from({ length: CORE_BYTE_COUNT }, (_, index) => index);
};

const getCoreStage = (corruptedBytes: number): number => {
    if (corruptedBytes < Math.floor(CORE_PHASE_ONE_END * 0.5)) {
        return 1;
    }
    if (corruptedBytes < CORE_PHASE_TWO_END) {
        return 2;
    }
    if (corruptedBytes < CORE_STAGE_THREE_START) {
        return 3;
    }
    return CORE_STAGE_COUNT;
};

const getBossAttackLabel = (attackMode: BossAttackMode | null): string => {
    return attackMode ? BOSS_ATTACK_LABELS[attackMode] : "";
};

const getFirewallAxisPosition = (firewall: BossFirewallState): number => {
    if (firewall.direction === "top") {
        return firewall.progress * PLAYFIELD_HEIGHT;
    }
    if (firewall.direction === "bottom") {
        const bossCeiling = runtime.boss
            ? Math.min(PLAYFIELD_HEIGHT - 14, runtime.boss.y + BOSS_HEIGHT + 12)
            : PLAYFIELD_HEIGHT * 0.18;
        return PLAYFIELD_HEIGHT - (firewall.progress * (PLAYFIELD_HEIGHT - bossCeiling));
    }
    if (firewall.direction === "left") {
        return firewall.progress * PLAYFIELD_WIDTH;
    }
    return PLAYFIELD_WIDTH - (firewall.progress * PLAYFIELD_WIDTH);
};

const getNextCoreUnlockBytes = (kind: keyof typeof CORE_ENEMY_UNLOCK_BYTES): number => {
    if (kind === "standard") {
        return CORE_ENEMY_UNLOCK_BYTES.gunner;
    }
    if (kind === "gunner") {
        return CORE_ENEMY_UNLOCK_BYTES.fast;
    }
    if (kind === "fast") {
        return CORE_ENEMY_UNLOCK_BYTES.block;
    }
    if (kind === "block") {
        return CORE_ENEMY_UNLOCK_BYTES.comet;
    }
    if (kind === "comet") {
        return CORE_ENEMY_UNLOCK_BYTES.sniper;
    }
    return CORE_BYTE_COUNT;
};

const getCoreTargetCountFromUnlock = (
    corruptedBytes: number,
    unlockBytes: number,
    nextUnlockBytes: number,
    baseCount: number,
    maxCount: number
): number => {
    if (corruptedBytes < unlockBytes) {
        return 0;
    }

    const growthEndBytes = Math.min(nextUnlockBytes, CORE_FULL_ROSTER_BYTES);
    if (corruptedBytes >= growthEndBytes) {
        return maxCount;
    }

    const span = Math.max(1, growthEndBytes - unlockBytes);
    const progress = (corruptedBytes - unlockBytes) / span;
    const extraCount = Math.floor(progress * (maxCount - baseCount));
    return Math.min(maxCount, baseCount + extraCount);
};

const getTargetStandardEnemyCount = (corruptedBytes: number): number => {
    return getCoreTargetCountFromUnlock(
        corruptedBytes,
        CORE_ENEMY_UNLOCK_BYTES.standard,
        getNextCoreUnlockBytes("standard"),
        4,
        CORE_STANDARD_ENEMY_MAX
    );
};

const getSpecialEnemyTargets = (corruptedBytes: number): Record<Exclude<EnemyKind, "standard">, number> => {
    return {
        gunner: getCoreTargetCountFromUnlock(corruptedBytes, CORE_ENEMY_UNLOCK_BYTES.gunner, getNextCoreUnlockBytes("gunner"), 2, CORE_SPECIAL_ENEMY_MAX),
        fast: getCoreTargetCountFromUnlock(corruptedBytes, CORE_ENEMY_UNLOCK_BYTES.fast, getNextCoreUnlockBytes("fast"), 2, CORE_SPECIAL_ENEMY_MAX),
        block: getCoreTargetCountFromUnlock(corruptedBytes, CORE_ENEMY_UNLOCK_BYTES.block, getNextCoreUnlockBytes("block"), 2, CORE_SPECIAL_ENEMY_MAX),
        comet: getCoreTargetCountFromUnlock(corruptedBytes, CORE_ENEMY_UNLOCK_BYTES.comet, getNextCoreUnlockBytes("comet"), 2, CORE_SPECIAL_ENEMY_MAX),
        sniper: getCoreTargetCountFromUnlock(corruptedBytes, CORE_ENEMY_UNLOCK_BYTES.sniper, getNextCoreUnlockBytes("sniper"), 2, CORE_SPECIAL_ENEMY_MAX),
    };
};

const getBossEnemyCap = (): number => {
    if (!runtime.boss) {
        return BOSS_SHIELDED_ENEMY_CAP;
    }
    if (runtime.boss.attackMode === "firewall") {
        return BOSS_UNSHIELDED_ENEMY_CAP;
    }
    if (runtime.boss.bossShieldHp > 0) {
        return BOSS_SHIELDED_ENEMY_CAP;
    }
    return BOSS_UNSHIELDED_ENEMY_CAP;
};

const getHostileSpeedMultiplier = (): number => {
    if (runtime.phase !== "core") {
        return 1;
    }

    const coreStage = getCoreStage(runtime.corruptedBytes);
    const baseMultiplier = coreStage === 1
        ? 0.74
        : coreStage === 2
            ? 0.86
            : coreStage === 3
                ? 0.98
                : 1.08;
    return runtime.corruptedBytes >= CORE_SPEEDUP_THRESHOLD
        ? baseMultiplier * HOSTILE_OVERDRIVE_MULTIPLIER
        : baseMultiplier;
};

const chooseEnemyKind = (corruptedBytes: number, lane: EnemyLane): EnemyKind => {
    if (lane === "standard") {
        return "standard";
    }

    const roll = Math.random();
    const coreStage = getCoreStage(corruptedBytes);
    if (coreStage <= 2) {
        if (roll < 0.45) {
            return "fast";
        }
        if (roll < 0.8) {
            return "block";
        }
        return "comet";
    }
    if (coreStage === 3) {
        if (roll < 0.26) {
            return "fast";
        }
        if (roll < 0.50) {
            return "block";
        }
        if (roll < 0.74) {
            return "comet";
        }
        if (roll < 0.90) {
            return "gunner";
        }
        return "sniper";
    }
    if (roll < 0.20) {
        return "fast";
    }
    if (roll < 0.38) {
        return "block";
    }
    if (roll < 0.62) {
        return "comet";
    }
    if (roll < 0.80) {
        return "gunner";
    }
    return "sniper";
};

const generateEnemyBody = (kind: EnemyKind): string => {
    if (kind === "comet") {
        return randomMatrixTrail(randomInt(14, 22));
    }

    const byteCount = kind === "block"
        ? randomInt(8, 12)
        : kind === "gunner" || kind === "sniper"
            ? randomInt(4, 7)
            : kind === "fast"
                ? 1
                : randomInt(3, 6);
    return Array.from({ length: byteCount }, () => randomHexByte()).join("");
};

const getEnemyLabel = (enemy: EnemyState): string => {
    if (enemy.kind === "comet") {
        return enemy.body;
    }
    return `0x${enemy.body}`;
};

const getEnemyLinesFor = (kind: EnemyKind, label: string): string[] => {
    if (kind === "comet") {
        return label.split("");
    }
    if (kind !== "block") {
        return [label];
    }

    const lines: string[] = [];
    for (let index = 0; index < label.length; index += 8) {
        lines.push(label.slice(index, index + 8));
    }
    return lines;
};

const getEnemyDimensions = (enemy: EnemyState): Pick<EnemyState, "width" | "height"> => {
    if (enemy.kind === "comet") {
        return {
            width: 2.35,
            height: Math.max(8.8, enemy.lines.length * 1.95),
        };
    }

    const longestLineLength = enemy.lines.reduce((longest, line) => Math.max(longest, line.length), 0);
    return {
        width: Math.max(3.8, (longestLineLength * DEFAULT_ENEMY_CHAR_WORLD_WIDTH) - 0.15),
        height: Math.max(3.2, enemy.lines.length * DEFAULT_BLOCK_LINE_HEIGHT),
    };
};

const hydrateEnemyGeometry = (enemy: EnemyState): EnemyState => {
    enemy.label = getEnemyLabel(enemy);
    enemy.lines = getEnemyLinesFor(enemy.kind, enemy.label);
    const dimensions = getEnemyDimensions(enemy);
    enemy.width = dimensions.width;
    enemy.height = dimensions.height;
    return enemy;
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
    const prototypeEnemy: EnemyState = hydrateEnemyGeometry({
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
    });
    const spawnWidth = Math.max(0, PLAYFIELD_WIDTH - prototypeEnemy.width);
    const cometStepMs = randomFloat(80, 105);
    const fastHorizontalDirection = Math.random() < 0.5 ? -1 : 1;
    const speedProfile = kind === "fast"
        ? { vx: fastHorizontalDirection * randomFloat(42, 58), vy: randomFloat(11, 17) }
        : kind === "block"
            ? { vx: randomFloat(-2.8, 2.8), vy: randomFloat(5.7, 8.8) }
            : kind === "gunner"
                ? { vx: randomFloat(-4.4, 4.4), vy: randomFloat(8.8, 12.8) }
                : kind === "sniper"
                    ? { vx: randomFloat(-2.2, 2.2), vy: randomFloat(4.5, 7.2) }
                    : kind === "comet"
                        ? { vx: 0, vy: cometStepMs }
                        : { vx: randomFloat(-5.5, 5.5), vy: randomFloat(9, 15.5) };
    return {
        ...prototypeEnemy,
        x: kind === "comet"
            ? randomFloat(6, Math.max(6, spawnWidth - 4))
            : randomFloat(3, Math.max(3, spawnWidth - 3)),
        y: spawnFromTop
            ? randomFloat(
                (-prototypeEnemy.height - (kind === "comet" ? 20 : 10)),
                kind === "comet"
                    ? Math.min(-prototypeEnemy.height - COMET_CHAR_HEIGHT, -8)
                    : Math.min(-prototypeEnemy.height * 0.75, -4)
            )
            : randomFloat(10, 64),
        vx: speedProfile.vx,
        vy: speedProfile.vy,
        fireCooldownMs: kind === "gunner" ? randomInt(700, 1500) : kind === "sniper" ? randomInt(1800, 3200) : kind === "comet" ? cometStepMs : 0,
    };
};

function createInitialRuntime(): RuntimeSnapshot {
    const startingStandardCount = getTargetStandardEnemyCount(0);
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
        enemies: Array.from({ length: startingStandardCount }, (_, index) => buildEnemy(index, false, "standard", "standard", 0)),
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
        health: PLAYER_MAX_HEALTH,
        maxHealth: PLAYER_MAX_HEALTH,
        shieldHp: 0,
        hostileCount: startingStandardCount,
        status: "running",
    };
}

const getShipAnchors = (
    playerX: number,
    playerY: number,
    targetRuntime = runtime
): Array<{ key: string; kind: "player" | "wingman"; side?: "left" | "right"; x: number; y: number; hp?: number }> => {
    const anchors: Array<{ key: string; kind: "player" | "wingman"; side?: "left" | "right"; x: number; y: number; hp?: number }> = [
        { key: "player", kind: "player", x: playerX, y: playerY },
    ];
    targetRuntime.wingmen.forEach((wingman) => {
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

const spawnEnemy = (
    id: number,
    spawnFromTop = false,
    lane: EnemyLane = "standard",
    forcedKind?: EnemyKind,
    corruptedBytes = runtime.corruptedBytes
): EnemyState => {
    return buildEnemy(id, spawnFromTop, lane, forcedKind, corruptedBytes);
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
    const roll = Math.random();
    const dropChance = runtime.phase === "core"
        ? POWER_UP_DROP_CHANCE * CORE_POWER_UP_DROP_MULTIPLIER
        : POWER_UP_DROP_CHANCE;
    if (roll > dropChance) {
        return;
    }

    const kindRoll = Math.random();
    const kind: PowerUpKind = kindRoll < 0.20
        ? "dual"
        : kindRoll < 0.40
            ? "laser"
            : kindRoll < 0.58
                ? "slow"
                : kindRoll < 0.76
                    ? "explosive"
                    : kindRoll < 0.88
                        ? "shield"
                        : "healthpack";
    runtime.powerUps.push({
        id: powerUpId++,
        x,
        y,
        kind,
    });
};

const applyPowerUp = (kind: PowerUpKind): void => {
    const duration = getEffectDurationFor(kind);
    const restoreHitWorth = (): void => {
        runtime.health = Math.min(runtime.maxHealth, runtime.health + HIT_DAMAGE);
    };
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
        if (runtime.effects.laserMs > 0) {
            restoreHitWorth();
        }
        runtime.effects.laserMs = Math.max(runtime.effects.laserMs, duration);
        runtime.effects.explosiveMs = 0;
        return;
    }
    if (kind === "slow") {
        runtime.effects.slowMs = Math.max(runtime.effects.slowMs, duration);
        return;
    }
    if (kind === "shield") {
        if (runtime.shieldHp >= SHIELD_MAX_HP) {
            restoreHitWorth();
        }
        runtime.shieldHp = SHIELD_MAX_HP;
        return;
    }
    if (kind === "healthpack") {
        runtime.health = Math.min(runtime.maxHealth, runtime.health + HEALTH_PACK_RESTORE);
        return;
    }
    if (runtime.effects.explosiveMs > 0) {
        restoreHitWorth();
    }
    runtime.effects.explosiveMs = Math.max(runtime.effects.explosiveMs, duration);
    runtime.effects.laserMs = 0;
};

const spawnEnemyProjectile = (x: number, y: number, targetX: number, speedMultiplier = 1): void => {
    const dx = clamp(targetX - x, -14, 14);
    runtime.enemyShots.push({
        id: enemyShotId++,
        x,
        y,
        vx: dx * 0.55,
        vy: ENEMY_PROJECTILE_SPEED * speedMultiplier,
    });
};

const spawnSniperProjectile = (x: number, y: number): void => {
    const dx = runtime.player.x - x;
    const dy = runtime.player.y - y;
    const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
    const speed = ENEMY_PROJECTILE_SPEED * 1.18;
    const vx = (dx / dist) * speed;
    const vy = (dy / dist) * speed;
    runtime.enemyShots.push({
        id: enemyShotId++,
        x,
        y,
        vx,
        vy,
        char: getProjectileChar(vx, vy),
    });
};

const verticalSegmentHitsRect = (
    x: number,
    yStart: number,
    yEnd: number,
    rectX: number,
    rectY: number,
    rectWidth: number,
    rectHeight: number,
    radiusX = 0,
    radiusY = 0
): boolean => {
    if (x < rectX - radiusX || x > rectX + rectWidth + radiusX) {
        return false;
    }

    const segmentTop = Math.min(yStart, yEnd);
    const segmentBottom = Math.max(yStart, yEnd);
    return segmentBottom >= rectY - radiusY && segmentTop <= rectY + rectHeight + radiusY;
};

const reconcileSpecialEnemies = (): void => {
    if (runtime.phase !== "core") {
        runtime.hostileCount = (runtime.boss ? 1 : 0) + runtime.enemies.length;
        return;
    }

    const standardEnemies: EnemyState[] = [];
    const specialEnemiesByKind: Record<Exclude<EnemyKind, "standard">, EnemyState[]> = {
        fast: [],
        block: [],
        gunner: [],
        comet: [],
        sniper: [],
    };

    for (let index = 0; index < runtime.enemies.length; index += 1) {
        const enemy = runtime.enemies[index];
        if (enemy.lane === "standard") {
            standardEnemies.push(enemy);
        } else {
            if (enemy.kind === "standard") {
                standardEnemies.push(enemy);
                continue;
            }
            specialEnemiesByKind[enemy.kind].push(enemy);
        }
    }

    const targetStandardCount = getTargetStandardEnemyCount(runtime.corruptedBytes);
    while (standardEnemies.length < targetStandardCount) {
        standardEnemies.push(spawnEnemy(standardEnemyId++, true, "standard", "standard", runtime.corruptedBytes));
    }
    if (standardEnemies.length > targetStandardCount) {
        standardEnemies.length = targetStandardCount;
    }

    const specialTargets = getSpecialEnemyTargets(runtime.corruptedBytes);
    (Object.keys(specialTargets) as Array<keyof typeof specialTargets>).forEach((kind) => {
        const targetCount = specialTargets[kind];
        const enemiesForKind = specialEnemiesByKind[kind];
        while (enemiesForKind.length < targetCount) {
            enemiesForKind.push(spawnEnemy(specialEnemyId++, true, "special", kind, runtime.corruptedBytes));
        }
        if (enemiesForKind.length > targetCount) {
            enemiesForKind.length = targetCount;
        }
    });

    const specialEnemies = (Object.keys(specialEnemiesByKind) as Array<keyof typeof specialEnemiesByKind>)
        .flatMap((kind) => specialEnemiesByKind[kind]);
    if (specialEnemies.length > CORE_MAX_ENEMIES - CORE_STANDARD_ENEMY_MAX) {
        specialEnemies.length = CORE_MAX_ENEMIES - CORE_STANDARD_ENEMY_MAX;
    }

    runtime.enemies = [...standardEnemies, ...specialEnemies];
    if (runtime.enemies.length > CORE_MAX_ENEMIES) {
        runtime.enemies.length = CORE_MAX_ENEMIES;
    }
    runtime.hostileCount = runtime.enemies.length;
};

const damageShipAt = (shipKey: string): boolean => {
    if (runtime.status !== "running") {
        return false;
    }

    if (devInvulnerable) {
        return false;
    }

    if (shipKey === "player") {
        if (runtime.player.invulnerableMs > 0) {
            return false;
        }
        if (runtime.shieldHp > 0) {
            runtime.shieldHp = Math.max(0, runtime.shieldHp - HIT_DAMAGE);
            runtime.player.invulnerableMs = SHIELD_RESPITE_MS;
            pendingSounds.push("death");
            return true;
        }
        runtime.health = Math.max(0, runtime.health - HIT_DAMAGE);
        runtime.player.invulnerableMs = PLAYER_RESPITE_MS;
        if (runtime.health <= 0) {
            runtime.status = "defeat";
        }
        pendingSounds.push("death");
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
        pendingSounds.push("death");
    }
    return true;
};

const startBossBattle = (): void => {
    if (runtime.phase === "boss") {
        return;
    }

    runtime.phase = "boss";
    runtime.enemies = [];
    runtime.enemyShots = [];
    runtime.powerUps = [];
    runtime.hostileCount = 1;
    bossPowerUpCooldownMs = Math.max(1600, BOSS_POWERUP_INTERVAL_MS * 0.225);
    bossFirewallsRemaining = BOSS_FIREWALL_BURST_COUNT;
    bossPatternIndex = 0;
    lastFirewallDirection = "";
    runtime.boss = {
        x: 34,
        y: 2,
        vx: 9,
        health: BOSS_HEALTH,
        maxHealth: BOSS_HEALTH,
        fireCooldownMs: BOSS_FIRE_COOLDOWN_MS,
        attackMode: "firewall",
        attackModeMs: 0,
        summonCooldownMs: BOSS_SUMMON_COOLDOWN_MS * 0.7,
        bossShieldHp: BOSS_SHIELD_HP,
        bossMaxShieldHp: BOSS_SHIELD_HP,
        firewall: {
            direction: pickFirewallDir(),
            progress: 0,
            alpha: 1,
            fading: false,
        },
    };
};

const getPhaseProgress = (): number => {
    if (runtime.phase === "epilogue") {
        return 1;
    }
    if (runtime.phase === "shutdown") {
        return 1 - (finalShutdownRemainingMs / FINAL_BLACKOUT_DURATION_MS);
    }
    if (runtime.phase === "glitch") {
        return 1 - (finalGlitchRemainingMs / FINAL_GLITCH_DURATION_MS);
    }
    if (runtime.phase === "collapse") {
        return 1 - (runtime.corruptedBytes / CORE_BYTE_COUNT);
    }
    return 0;
};

const startFinalGlitch = (): void => {
    runtime.phase = "glitch";
    runtime.boss = null;
    runtime.enemies = [];
    runtime.enemyShots = [];
    runtime.powerUps = [];
    runtime.bullets = [];
    runtime.effects = {
        dualMs: 0,
        laserMs: 0,
        slowMs: 0,
        explosiveMs: 0,
    };
    runtime.wingmen.forEach((wingman) => {
        wingman.active = false;
        wingman.invulnerableMs = 0;
    });
    runtime.hostileCount = 0;
    finalGlitchRemainingMs = FINAL_GLITCH_DURATION_MS;
    finalShutdownRemainingMs = 0;
};

const drainCorruptedMemory = (byteCount: number): boolean => {
    if (!collapseByteIndices.length) {
        return false;
    }

    const clearCount = Math.min(byteCount, collapseByteIndices.length);
    for (let index = 0; index < clearCount; index += 1) {
        const targetPosition = randomInt(0, collapseByteIndices.length - 1);
        const [targetIndex] = collapseByteIndices.splice(targetPosition, 1);
        runtime.coreBytes[targetIndex] = "  ";
        runtime.corruptedBytes = Math.max(0, runtime.corruptedBytes - 1);
        pendingCoreUpdates.push({ index: targetIndex, value: "  " });
    }

    if (!collapseByteIndices.length) {
        startFinalGlitch();
    }

    return true;
};

const startFinalCollapse = (): void => {
    runtime.phase = "collapse";
    if (runtime.boss) {
        runtime.boss.health = 0;
        runtime.boss.vx = 0;
        runtime.boss.fireCooldownMs = Number.POSITIVE_INFINITY;
        runtime.boss.summonCooldownMs = Number.POSITIVE_INFINITY;
        runtime.boss.attackModeMs = 0;
        runtime.boss.firewall = null;
    }
    runtime.enemies = [];
    runtime.enemyShots = [];
    runtime.powerUps = [];
    runtime.bullets = [];
    runtime.effects = {
        dualMs: 0,
        laserMs: 0,
        slowMs: 0,
        explosiveMs: 0,
    };
    runtime.wingmen.forEach((wingman) => {
        wingman.active = false;
        wingman.invulnerableMs = 0;
    });
    runtime.hostileCount = runtime.boss ? 1 : 0;
    finalGlitchRemainingMs = 0;
    finalShutdownRemainingMs = 0;
    collapseByteIndices = [];
    for (let index = 0; index < runtime.coreBytes.length; index += 1) {
        if (runtime.coreBytes[index].trim().length) {
            collapseByteIndices.push(index);
        }
    }
};

const damageBoss = (amount: number): boolean => {
    if (!runtime.boss) {
        return false;
    }

    runtime.hits += 1;
    if (runtime.phase === "collapse") {
        return drainCorruptedMemory(Math.max(1, Math.round(amount)) * FINAL_COLLAPSE_BYTES_PER_HIT);
    }
    if (runtime.boss.bossShieldHp > 0) {
        runtime.boss.bossShieldHp = Math.max(0, runtime.boss.bossShieldHp - amount);
        if (runtime.boss.bossShieldHp <= 0) {
            runtime.boss.firewall = null;
            bossFirewallsRemaining = 0;
            runtime.boss.summonCooldownMs = 0;
            bossPowerUpCooldownMs = Math.min(bossPowerUpCooldownMs, 1300);
            if (runtime.boss.attackMode === "firewall") {
                transitionBossMode(BOSS_PATTERN_ORDER[bossPatternIndex]);
            }
        }
        return true;
    }
    runtime.boss.health = Math.max(0, runtime.boss.health - amount);
    if (runtime.boss.health <= 0) {
        startFinalCollapse();
        return drainCorruptedMemory(FINAL_COLLAPSE_BYTES_PER_HIT);
    }
    return true;
};

const getNextBossAttackMode = (current: BossAttackMode): BossAttackMode => {
    if (current === "firewall") {
        return BOSS_PATTERN_ORDER[bossPatternIndex];
    }
    bossPatternIndex = (bossPatternIndex + 1) % BOSS_PATTERN_ORDER.length;
    return "firewall";
};

const getDesiredBossEscortKinds = (): EnemyKind[] => {
    const desiredKinds: EnemyKind[] = ["standard", "gunner", "fast", "block", "comet", "sniper"];
    const activeKinds = new Set(runtime.enemies.map((enemy) => enemy.kind));
    return desiredKinds.filter((kind) => !activeKinds.has(kind));
};

const getWeightedBossEscortKind = (shielded: boolean): EnemyKind => {
    const roll = Math.random();
    if (shielded) {
        if (roll < 0.2) {
            return "standard";
        }
        if (roll < 0.38) {
            return "gunner";
        }
        if (roll < 0.54) {
            return "fast";
        }
        if (roll < 0.68) {
            return "block";
        }
        if (roll < 0.87) {
            return "comet";
        }
        return "sniper";
    }

    if (roll < 0.14) {
        return "standard";
    }
    if (roll < 0.31) {
        return "gunner";
    }
    if (roll < 0.47) {
        return "fast";
    }
    if (roll < 0.61) {
        return "block";
    }
    if (roll < 0.82) {
        return "comet";
    }
    return "sniper";
};

const transitionBossMode = (nextMode: BossAttackMode): void => {
    const boss = runtime.boss;
    if (!boss) return;
    boss.attackMode = nextMode;
    if (nextMode === "firewall") {
        boss.attackModeMs = 0;
        boss.fireCooldownMs = Math.max(boss.fireCooldownMs, 320);
        bossFirewallsRemaining = BOSS_FIREWALL_BURST_COUNT;
        boss.firewall = {
            direction: pickFirewallDir(),
            progress: 0,
            alpha: 1,
            fading: false,
        };
        return;
    }

    boss.attackModeMs = BOSS_ATTACK_MODE_DURATION_MS;
    boss.fireCooldownMs = 400;
    boss.firewall = null;
    bossFirewallsRemaining = 0;
};

const spawnBossEscort = (): void => {
    const boss = runtime.boss;
    if (!boss) {
        return;
    }

    const availableSlots = Math.max(0, getBossEnemyCap() - runtime.enemies.length);
    if (!availableSlots) {
        return;
    }

    const shielded = boss.bossShieldHp > 0;
    const missingKinds = getDesiredBossEscortKinds();
    const wantsLargeWave = boss.bossShieldHp <= 0;
    const spawnCount = Math.min(
        availableSlots,
        Math.max(
            missingKinds.length,
            wantsLargeWave
                ? randomInt(2, 4)
                : randomInt(2, 3)
        )
    );
    for (let si = 0; si < spawnCount; si += 1) {
        const forcedKind: EnemyKind = missingKinds[si] || getWeightedBossEscortKind(shielded);
        const escort = spawnEnemy(specialEnemyId++, true, "special", forcedKind, runtime.corruptedBytes);
        escort.x = clamp(boss.x + randomFloat(-3, BOSS_WIDTH - 1) + (si * randomFloat(8, 16)), 2, PLAYFIELD_WIDTH - escort.width - 2);
        if (escort.kind === "comet") {
            escort.vx = 0;
            const stepMs = randomFloat(80, 105);
            escort.vy = stepMs;
            escort.fireCooldownMs = stepMs;
        } else if (escort.kind === "gunner") {
            escort.vx = randomFloat(-3.4, 3.4);
            escort.vy = randomFloat(8.5, 11.5);
            escort.fireCooldownMs = randomInt(480, 920);
        } else if (escort.kind === "sniper") {
            escort.vx = randomFloat(-2.5, 2.5);
            escort.vy = randomFloat(5.8, 8.2);
            escort.fireCooldownMs = randomInt(1100, 1800);
        }
        runtime.enemies.push(escort);
    }
    runtime.hostileCount = (runtime.boss ? 1 : 0) + runtime.enemies.length;
};

const spawnDirectedEnemyShot = (x: number, y: number, vx: number, vy: number): void => {
    runtime.enemyShots.push({
        id: enemyShotId++,
        x,
        y,
        vx,
        vy,
    });
};

const fireBossAttack = (slowMultiplier: number): void => {
    const boss = runtime.boss;
    if (!boss) {
        return;
    }

    if (boss.attackMode === "firewall") {
        return;
    }

    const bossBottomY = boss.y + BOSS_HEIGHT;
    if (boss.attackMode === "volley") {
        [-10, -5, 0, 5, 10].forEach((offset, index) => {
            const x = boss.x + (BOSS_WIDTH * (0.12 + (index * 0.19)));
            spawnEnemyProjectile(x, bossBottomY, runtime.player.x + offset, slowMultiplier * 1.08);
        });
        boss.fireCooldownMs = 760;
        return;
    }

    if (boss.attackMode === "rain") {
        for (let index = 0; index < 8; index += 1) {
            const x = index === 0
                ? boss.x + (BOSS_WIDTH * 0.16)
                : index === 7
                    ? boss.x + (BOSS_WIDTH * 0.84)
                    : randomFloat(5, PLAYFIELD_WIDTH - 5);
            spawnDirectedEnemyShot(x, bossBottomY + randomFloat(-1, 1.5), randomFloat(-0.45, 0.45), (ENEMY_PROJECTILE_SPEED * 1.12) * slowMultiplier);
        }
        boss.fireCooldownMs = 430;
        return;
    }

    const sweepDirection = boss.vx >= 0 ? 1 : -1;
    for (let index = 0; index < 7; index += 1) {
        const spread = (index - 3) * 2.35;
        const x = boss.x + (BOSS_WIDTH * 0.5) + (spread * 0.45);
        spawnDirectedEnemyShot(
            x,
            bossBottomY,
            (spread + (sweepDirection * 3.8)) * slowMultiplier,
            (ENEMY_PROJECTILE_SPEED * 0.78) * slowMultiplier
        );
    }
    boss.fireCooldownMs = 620;
};

const appendBullet = (): boolean => {
    if (runtime.status !== "running" || shotCooldownRemainingMs > 0) {
        return false;
    }

    const emitters = getShipAnchors(runtime.player.x + PLAYER_BULLET_EMIT_OFFSET_X, runtime.player.y, runtime);
    const bulletKind: BulletState["kind"] = runtime.effects.explosiveMs > 0 ? "explosive" : "normal";
    for (let index = 0; index < emitters.length; index += 1) {
        runtime.bullets.push({
            id: bulletId++,
            x: emitters[index].x,
            y: runtime.player.y - 3,
            kind: bulletKind,
        });
    }
    runtime.shots += emitters.length;
    shotCooldownRemainingMs = SHOOT_COOLDOWN_MS;
    return true;
};

const corruptCore = (): boolean => {
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
        const value = randomCorruptionByte();
        runtime.coreBytes[targetIndex] = value;
        runtime.corruptedBytes += 1;
        pendingCoreUpdates.push({ index: targetIndex, value });
    }

    if (runtime.corruptedBytes >= CORE_BYTE_COUNT) {
        startBossBattle();
        return true;
    }
    return false;
};

const toRenderSnapshot = (): RenderSnapshot => ({
    player: { ...runtime.player },
    wingmen: runtime.wingmen.map((wingman) => ({ ...wingman })),
    bullets: runtime.bullets.map((bullet) => ({ ...bullet })),
    enemyShots: runtime.enemyShots.map((shot) => ({ ...shot })),
    powerUps: runtime.powerUps.map((powerUp) => ({ ...powerUp })),
    enemies: runtime.enemies.map((enemy) => ({
        ...enemy,
        lines: [...enemy.lines],
    })),
    boss: runtime.boss ? { ...runtime.boss, firewall: runtime.boss.firewall ? { ...runtime.boss.firewall } : null } : null,
    effects: { ...runtime.effects },
    phase: runtime.phase,
    laserActive: runtime.effects.laserMs > 0 && inputState.fire,
    status: runtime.status,
    health: runtime.health,
    maxHealth: runtime.maxHealth,
    shieldHp: runtime.shieldHp,
    phaseProgress: getPhaseProgress(),
});

const toUiSnapshot = (forceFullCoreBytes = false): UiSnapshot => {
    const coreStage = getCoreStage(runtime.corruptedBytes);
    const snapshot: UiSnapshot = {
        corruptedBytes: runtime.corruptedBytes,
        shots: runtime.shots,
        hits: runtime.hits,
        purged: runtime.purged,
        health: runtime.health,
        maxHealth: runtime.maxHealth,
        shieldHp: runtime.shieldHp,
        enemyShotCount: runtime.enemyShots.length,
        powerUpCount: runtime.powerUps.length,
        hostileCount: runtime.hostileCount,
        effects: { ...runtime.effects },
        phase: runtime.phase,
        coreStage,
        coreStageCount: CORE_STAGE_COUNT,
        bossHealth: runtime.boss?.health || 0,
        bossMaxHealth: runtime.boss?.maxHealth || 0,
        bossAttackMode: runtime.boss?.attackMode || null,
        wingmanHealths: runtime.wingmen.map((wingman) => (wingman.active ? wingman.hp : 0)),
        status: runtime.status,
    };

    if (forceFullCoreBytes) {
        snapshot.coreBytes = [...runtime.coreBytes];
        pendingCoreUpdates = [];
    } else if (pendingCoreUpdates.length) {
        snapshot.coreUpdates = pendingCoreUpdates.splice(0, pendingCoreUpdates.length);
    }

    return snapshot;
};

const postFrame = (includeUi = false, forceFullCoreBytes = false): void => {
    const message: WorkerFrameMessage = {
        type: "frame",
    };
    if (!renderInWorker) {
        message.render = toRenderSnapshot();
    }
    if (includeUi) {
        message.ui = toUiSnapshot(forceFullCoreBytes);
    }
    if (pendingSounds.length) {
        message.sounds = pendingSounds.splice(0, pendingSounds.length);
    }
    const gameState: WorkerFrameGameState = {
        laserFiring: runtime.effects.laserMs > 0 && inputState.fire,
        status: runtime.status,
        phase: runtime.phase,
    };
    message.gameState = gameState;
    self.postMessage(message);
};

const drawScene = (): void => {
    if (!renderContext || !renderCanvas || !renderMetrics) {
        return;
    }

    renderContext.setTransform(1, 0, 0, 1, 0, 0);
    renderContext.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
    renderContext.setTransform(renderMetrics.dpr, 0, 0, renderMetrics.dpr, 0, 0);
    renderContext.textBaseline = "middle";
    renderContext.font = `${renderMetrics.fontScale}px Vga, Menlo, Monaco, Consolas, monospace`;

    if (runtime.phase === "shutdown" || runtime.phase === "epilogue") {
        renderContext.fillStyle = "#010206";
        renderContext.fillRect(0, 0, renderMetrics.width, renderMetrics.height);
        return;
    }

    if (runtime.phase === "glitch") {
        renderContext.textAlign = "center";
        const playerVisible = runtime.player.invulnerableMs <= 0 || Math.floor(runtime.player.invulnerableMs / 90) % 2 === 0;
        if (playerVisible) {
            renderContext.fillStyle = "#d8e4ff";
            renderContext.fillText("<^>", runtime.player.x * renderMetrics.xScale, runtime.player.y * renderMetrics.yScale);
        }
        return;
    }

    if (runtime.effects.laserMs > 0 && inputState.fire && runtime.status === "running") {
        renderContext.strokeStyle = "rgba(180, 220, 255, 0.72)";
        renderContext.lineWidth = 2;
        renderContext.beginPath();
        renderContext.moveTo(runtime.player.x * renderMetrics.xScale, runtime.player.y * renderMetrics.yScale);
        renderContext.lineTo(runtime.player.x * renderMetrics.xScale, 0);
        runtime.wingmen.forEach((wingman) => {
            if (!wingman.active) {
                return;
            }
            const wingX = clamp(runtime.player.x + (wingman.side === "left" ? -PLAYER_WING_OFFSET : PLAYER_WING_OFFSET), 2, PLAYFIELD_WIDTH - 6) * renderMetrics.xScale;
            renderContext.moveTo(wingX, runtime.player.y * renderMetrics.yScale);
            renderContext.lineTo(wingX, 0);
        });
        renderContext.stroke();
    }

    renderContext.textAlign = "center";
    const playerVisible = runtime.player.invulnerableMs <= 0 || Math.floor(runtime.player.invulnerableMs / 90) % 2 === 0;
    if (playerVisible) {
        renderContext.fillStyle = "#d8e4ff";
        renderContext.fillText(runtime.shieldHp > 0 ? "(<^>)" : "<^>", runtime.player.x * renderMetrics.xScale, runtime.player.y * renderMetrics.yScale);
    }

    runtime.wingmen.forEach((wingman) => {
        if (!wingman.active) {
            return;
        }
        const visible = wingman.invulnerableMs <= 0 || Math.floor(wingman.invulnerableMs / 90) % 2 === 0;
        if (!visible) {
            return;
        }
        renderContext.fillStyle = wingman.hp === 1 ? "#ffb9c2" : "#d9d4ff";
        renderContext.fillText(
            "<^>",
            clamp(runtime.player.x + (wingman.side === "left" ? -PLAYER_WING_OFFSET : PLAYER_WING_OFFSET), 2, PLAYFIELD_WIDTH - 6) * renderMetrics.xScale,
            runtime.player.y * renderMetrics.yScale
        );
    });

    runtime.bullets.forEach((bullet) => {
        renderContext.fillStyle = bullet.kind === "explosive" ? "#ffd27d" : "#ff9aa8";
        renderContext.fillText(bullet.kind === "explosive" ? "*" : "|", bullet.x * renderMetrics.xScale, bullet.y * renderMetrics.yScale);
    });

    renderContext.fillStyle = "#ffad77";
    runtime.enemyShots.forEach((shot) => {
        renderContext.fillText(shot.char ?? "v", shot.x * renderMetrics.xScale, shot.y * renderMetrics.yScale);
    });

    runtime.powerUps.forEach((powerUp) => {
        renderContext.fillStyle = powerUp.kind === "laser"
            ? "#9fd4ff"
            : powerUp.kind === "slow"
                ? "#9ff3c1"
                : powerUp.kind === "explosive"
                    ? "#ffd27d"
                    : "#f6c5ff";
        renderContext.fillText(POWER_UP_LABELS[powerUp.kind], powerUp.x * renderMetrics.xScale, powerUp.y * renderMetrics.yScale);
    });

    renderContext.textAlign = "left";
    runtime.enemies.forEach((enemy) => {
        renderContext.fillStyle = enemy.kind === "fast"
            ? "#7edcff"
            : enemy.kind === "comet"
                ? "#7dff95"
                : enemy.kind === "block"
                    ? "#ffbe7d"
                    : enemy.kind === "gunner"
                        ? "#ff8f9d"
                        : enemy.kind === "sniper"
                            ? "#f6c5ff"
                            : "#ff7d89";
        enemy.lines.forEach((line, index) => {
            const lineY = enemy.y + ((enemy.height / enemy.lines.length) * (index + 0.5));
            renderContext.fillText(line, enemy.x * renderMetrics.xScale, lineY * renderMetrics.yScale);
        });
    });

    if ((runtime.phase === "boss" || runtime.phase === "collapse") && runtime.boss) {
        const pixelX = runtime.boss.x * renderMetrics.xScale;
        const pixelY = runtime.boss.y * renderMetrics.yScale;
        const pixelWidth = BOSS_WIDTH * renderMetrics.xScale;
        const pixelHeight = BOSS_HEIGHT * renderMetrics.yScale;

        renderContext.strokeStyle = "#ff8aa0";
        renderContext.lineWidth = 2;
        renderContext.strokeRect(pixelX, pixelY, pixelWidth, pixelHeight);
        renderContext.fillStyle = "rgba(255, 90, 116, 0.12)";
        renderContext.fillRect(pixelX, pixelY, pixelWidth, pixelHeight);

        if (runtime.boss.bossShieldHp > 0) {
            const shieldFrac = runtime.boss.bossShieldHp / Math.max(1, runtime.boss.bossMaxShieldHp);
            renderContext.strokeStyle = `rgba(0, 255, 240, ${0.45 + shieldFrac * 0.55})`;
            renderContext.lineWidth = 3;
            renderContext.strokeRect(pixelX - 4, pixelY - 4, pixelWidth + 8, pixelHeight + 8);
            renderContext.fillStyle = `rgba(0, 255, 240, ${0.04 + shieldFrac * 0.1})`;
            renderContext.fillRect(pixelX - 4, pixelY - 4, pixelWidth + 8, pixelHeight + 8);
        }

        const bossStatusLabel = runtime.phase === "collapse"
            ? "CORE PURGE"
            : runtime.boss.bossShieldHp > 0
            ? `${getBossAttackLabel(runtime.boss.attackMode)} // BARRIER ${String(runtime.boss.bossShieldHp).padStart(3, "0")}`
            : `${getBossAttackLabel(runtime.boss.attackMode)} // HP ${String(runtime.boss.health).padStart(3, "0")}`;
        renderContext.fillStyle = "#ffd6de";
        renderContext.textAlign = "center";
        renderContext.fillText("APHELION PRIME", pixelX + (pixelWidth * 0.5), pixelY + (pixelHeight * 0.33));
        renderContext.fillText(bossStatusLabel, pixelX + (pixelWidth * 0.5), pixelY + (pixelHeight * 0.68));
    }

    if ((runtime.phase === "boss" || runtime.phase === "collapse") && runtime.boss?.firewall) {
        const fw = runtime.boss.firewall;
        renderContext.save();
        renderContext.globalAlpha = fw.alpha;
        renderContext.shadowColor = "#ff8844";
        renderContext.shadowBlur = 12;
        renderContext.strokeStyle = "#ff3322";
        renderContext.lineWidth = BOSS_FIREWALL_HALF_THICKNESS * 2 * renderMetrics.yScale;
        renderContext.beginPath();
        if (fw.direction === "top") {
            const y = fw.progress * PLAYFIELD_HEIGHT * renderMetrics.yScale;
            renderContext.moveTo(0, y);
            renderContext.lineTo(renderMetrics.width, y);
        } else if (fw.direction === "bottom") {
            const y = (1 - fw.progress) * PLAYFIELD_HEIGHT * renderMetrics.yScale;
            renderContext.moveTo(0, y);
            renderContext.lineTo(renderMetrics.width, y);
        } else if (fw.direction === "left") {
            const x = fw.progress * PLAYFIELD_WIDTH * renderMetrics.xScale;
            renderContext.moveTo(x, 0);
            renderContext.lineTo(x, renderMetrics.height);
        } else {
            const x = (1 - fw.progress) * PLAYFIELD_WIDTH * renderMetrics.xScale;
            renderContext.moveTo(x, 0);
            renderContext.lineTo(x, renderMetrics.height);
        }
        renderContext.stroke();
        renderContext.restore();
    }

    const barFontSize = Math.max(18, Math.min(renderMetrics.height * 0.065, 36));
    renderContext.font = `${barFontSize}px Vga, Menlo, Monaco, Consolas, monospace`;
    renderContext.textBaseline = "alphabetic";
    renderContext.textAlign = "center";
    const eqMeasure = renderContext.measureText("=");
    const eqWidth = eqMeasure.width;
    const barCount = Math.max(4, Math.floor(renderMetrics.width / eqWidth));
    const glyphAscent = eqMeasure.actualBoundingBoxAscent ?? (barFontSize * 0.7);
    const glyphDescent = eqMeasure.actualBoundingBoxDescent ?? 0;
    const glyphHeight = glyphAscent + glyphDescent;
    const hpBaseline = renderMetrics.height - glyphDescent - 6;
    const barCenterX = renderMetrics.width / 2;
    renderContext.fillStyle = "#d8e4ff";
    renderContext.fillText(buildCenteredBar(runtime.health / runtime.maxHealth, barCount), barCenterX, hpBaseline);
    if (runtime.shieldHp > 0) {
        renderContext.fillStyle = "#7efff4";
        renderContext.fillText(buildCenteredBar(runtime.shieldHp / SHIELD_MAX_HP, barCount), barCenterX, hpBaseline - glyphHeight - 6);
    }
};

const stepSimulation = (): boolean => {
    if (runtime.status !== "running") {
        return false;
    }

    let uiDirty = false;
    const dtSeconds = FIXED_DT_MS / 1000;
    const slowMultiplier = runtime.effects.slowMs > 0 ? SLOW_FACTOR : 1;
    const hostileSpeedMultiplier = getHostileSpeedMultiplier();

    shotCooldownRemainingMs = Math.max(0, shotCooldownRemainingMs - FIXED_DT_MS);
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

    const moveX = (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0);
    const moveY = (inputState.down ? 1 : 0) - (inputState.up ? 1 : 0);
    runtime.player.x = clamp(runtime.player.x + (moveX * PLAYER_SPEED * dtSeconds), 1.5, PLAYFIELD_WIDTH - 6);
    runtime.player.y = clamp(runtime.player.y + (moveY * PLAYER_SPEED * dtSeconds), 6, PLAYFIELD_HEIGHT - 6);

    let shipAnchors = getShipAnchors(runtime.player.x, runtime.player.y, runtime);
    const refreshShipAnchors = (): void => {
        shipAnchors = getShipAnchors(runtime.player.x, runtime.player.y, runtime);
    };

    if (runtime.phase === "glitch") {
        finalGlitchRemainingMs = Math.max(0, finalGlitchRemainingMs - FIXED_DT_MS);
        if (finalGlitchRemainingMs <= 0) {
            runtime.phase = "shutdown";
            finalShutdownRemainingMs = FINAL_BLACKOUT_DURATION_MS;
        }
        return true;
    }

    if (runtime.phase === "shutdown") {
        finalShutdownRemainingMs = Math.max(0, finalShutdownRemainingMs - FIXED_DT_MS);
        if (finalShutdownRemainingMs <= 0) {
            runtime.phase = "epilogue";
            runtime.status = "victory";
        }
        return true;
    }

    const damageEnemyAt = (enemyIndex: number, instantKill = false): void => {
        const currentEnemy = runtime.enemies[enemyIndex];
        if (!currentEnemy) {
            return;
        }

        const trimSize = currentEnemy.kind === "comet" ? 1 : 2;
        const removeEnemy = (): void => {
            const enemyCenterX = currentEnemy.x + (currentEnemy.width * 0.5);
            const enemyCenterY = currentEnemy.y + (currentEnemy.height * 0.5);
            runtime.purged += 1;
            spawnPowerUpDrop(enemyCenterX, enemyCenterY);
            runtime.enemies.splice(enemyIndex, 1);
            runtime.hostileCount = (runtime.boss ? 1 : 0) + runtime.enemies.length;
        };

        if (runtime.phase === "boss") {
            runtime.hits += 1;
            uiDirty = true;
            if (instantKill || currentEnemy.body.length <= trimSize) {
                pendingSounds.push("death");
                removeEnemy();
                return;
            }

            pendingSounds.push("explosion");
            currentEnemy.body = currentEnemy.body.slice(0, -trimSize);
            if (currentEnemy.kind === "comet") {
                currentEnemy.lines = currentEnemy.body.split("");
                currentEnemy.height = Math.max(8.8, currentEnemy.lines.length * COMET_CHAR_HEIGHT);
            } else {
                currentEnemy.vy = Math.min(currentEnemy.vy + 0.45, currentEnemy.kind === "fast" ? 25.5 : 18);
                hydrateEnemyGeometry(currentEnemy);
            }
            return;
        }

        runtime.hits += 1;
        const bossTriggered = corruptCore();
        uiDirty = true;
        if (bossTriggered) {
            return;
        }

        if (instantKill || currentEnemy.body.length <= trimSize) {
            const enemyCenterX = currentEnemy.x + (currentEnemy.width * 0.5);
            const enemyCenterY = currentEnemy.y + (currentEnemy.height * 0.5);
            runtime.purged += 1;
            spawnPowerUpDrop(enemyCenterX, enemyCenterY);
            pendingSounds.push("death");
            runtime.enemies[enemyIndex] = spawnEnemy(
                currentEnemy.id,
                true,
                currentEnemy.lane,
                currentEnemy.lane === "standard" ? "standard" : undefined,
                runtime.corruptedBytes
            );
            return;
        }

        pendingSounds.push("explosion");
        currentEnemy.body = currentEnemy.body.slice(0, -trimSize);
        if (currentEnemy.kind === "comet") {
            currentEnemy.lines = currentEnemy.body.split("");
            currentEnemy.height = Math.max(8.8, currentEnemy.lines.length * COMET_CHAR_HEIGHT);
        } else {
            currentEnemy.vy = Math.min(currentEnemy.vy + 0.35, currentEnemy.kind === "fast" ? 25.5 : 18);
            hydrateEnemyGeometry(currentEnemy);
        }
    };

    const fireLaserVolley = (): void => {
        if (laserCooldownMs > 0) {
            laserCooldownMs = Math.max(0, laserCooldownMs - FIXED_DT_MS);
            return;
        }

        laserCooldownMs = LASER_TICK_MS;
        const damagedEnemyIndices = new Set<number>();
        let bossDamaged = false;
        for (let emitterIndex = 0; emitterIndex < shipAnchors.length; emitterIndex += 1) {
            const emitterX = shipAnchors[emitterIndex].x;
            if ((runtime.phase === "boss" || runtime.phase === "collapse") && runtime.boss) {
                const bossHit = emitterX >= runtime.boss.x && emitterX <= runtime.boss.x + BOSS_WIDTH;
                if (bossHit) {
                    damageBoss(2);
                    uiDirty = true;
                    bossDamaged = true;
                }
            }

            for (let index = 0; index < runtime.enemies.length; index += 1) {
                const enemy = runtime.enemies[index];
                if (
                    !damagedEnemyIndices.has(index)
                    && verticalSegmentHitsRect(emitterX, runtime.player.y, 0, enemy.x, enemy.y, enemy.width, enemy.height)
                ) {
                    damagedEnemyIndices.add(index);
                }
            }
        }

        Array.from(damagedEnemyIndices).sort((left, right) => right - left).forEach((enemyIndex) => {
            damageEnemyAt(enemyIndex);
        });
        if (damagedEnemyIndices.size || bossDamaged) {
            uiDirty = true;
        }
    };

    if (runtime.effects.laserMs > 0 && inputState.fire) {
        fireLaserVolley();
    } else if ((fireBufferCount > 0 || inputState.fire) && appendBullet()) {
        uiDirty = true;
        pendingSounds.push(runtime.effects.explosiveMs > 0 ? "xblast" : "bullet");
        if (fireBufferCount > 0) {
            fireBufferCount -= 1;
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
            pendingSounds.push(powerUp.kind === "explosive" ? "xblast" : "pickuppowerup");
            refreshShipAnchors();
            continue;
        }
        if (powerUp.y <= PLAYFIELD_HEIGHT + 4) {
            nextPowerUps.push(powerUp);
        }
    }
    runtime.powerUps = nextPowerUps;

    const nextEnemyShots = [];
    const interceptedBulletIds = new Set<number>();
    for (let index = 0; index < runtime.enemyShots.length; index += 1) {
        const shot = runtime.enemyShots[index];
        shot.x += shot.vx * dtSeconds;
        shot.y += shot.vy * dtSeconds * slowMultiplier * hostileSpeedMultiplier;

        let intercepted = false;
        for (let bulletIndex = 0; bulletIndex < runtime.bullets.length; bulletIndex += 1) {
            const bullet = runtime.bullets[bulletIndex];
            if (interceptedBulletIds.has(bullet.id)) {
                continue;
            }
            const collisionRadiusX = bullet.kind === "explosive" ? 1.35 : 0.9;
            const collisionRadiusY = bullet.kind === "explosive" ? 2.1 : 1.45;
            if (Math.abs(shot.x - bullet.x) <= collisionRadiusX && Math.abs(shot.y - bullet.y) <= collisionRadiusY) {
                interceptedBulletIds.add(bullet.id);
                intercepted = true;
                break;
            }
        }
        if (intercepted) {
            continue;
        }

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
    if (interceptedBulletIds.size) {
        runtime.bullets = runtime.bullets.filter((bullet) => !interceptedBulletIds.has(bullet.id));
    }

    for (let index = 0; index < runtime.enemies.length;) {
        const enemy = runtime.enemies[index];
        if (enemy.kind === "comet") {
            enemy.fireCooldownMs -= FIXED_DT_MS * slowMultiplier * hostileSpeedMultiplier;
            if (enemy.fireCooldownMs <= 0) {
                enemy.y += COMET_CHAR_HEIGHT;
                enemy.body = enemy.body.slice(1) + randomMatrixTrailChar();
                enemy.lines = enemy.body.split("");
                enemy.fireCooldownMs += enemy.vy;
            }
        } else {
            let nextEnemyX = enemy.x + (enemy.vx * dtSeconds * slowMultiplier * hostileSpeedMultiplier);
            let nextEnemyVx = enemy.vx;
            if (nextEnemyX <= 1) {
                nextEnemyX = 1;
                nextEnemyVx = Math.abs(nextEnemyVx);
            }
            if (nextEnemyX >= PLAYFIELD_WIDTH - enemy.width - 1) {
                nextEnemyX = PLAYFIELD_WIDTH - enemy.width - 1;
                nextEnemyVx = -Math.abs(nextEnemyVx);
            }
            enemy.x = nextEnemyX;
            enemy.y += enemy.vy * dtSeconds * slowMultiplier * hostileSpeedMultiplier;
            enemy.vx = nextEnemyVx;
        }

        if (enemy.kind === "gunner" || enemy.kind === "sniper") {
            enemy.fireCooldownMs = Math.max(0, enemy.fireCooldownMs - (FIXED_DT_MS * hostileSpeedMultiplier));
            if (enemy.fireCooldownMs <= 0 && enemy.y > 10) {
                if (enemy.kind === "sniper") {
                    spawnSniperProjectile(enemy.x + (enemy.width * 0.5), enemy.y + enemy.height);
                    enemy.fireCooldownMs = runtime.phase === "boss" ? randomInt(1100, 1800) : randomInt(1800, 3200);
                } else {
                    spawnEnemyProjectile(enemy.x + (enemy.width * 0.5), enemy.y + enemy.height, runtime.player.x, slowMultiplier * Math.max(1, hostileSpeedMultiplier));
                    enemy.fireCooldownMs = runtime.phase === "boss" ? randomInt(520, 940) : randomInt(720, 1450);
                }
                uiDirty = true;
            }
        }

        if (runtime.phase === "core" && enemy.y >= ENEMY_Y_LIMIT) {
            runtime.enemies[index] = spawnEnemy(
                enemy.id,
                true,
                enemy.lane,
                enemy.lane === "standard" ? "standard" : undefined,
                runtime.corruptedBytes
            );
            index += 1;
            continue;
        }

        if (runtime.phase === "boss" && enemy.y >= PLAYFIELD_HEIGHT + 8) {
            runtime.enemies.splice(index, 1);
            runtime.hostileCount = (runtime.boss ? 1 : 0) + runtime.enemies.length;
            continue;
        }

        const enemyCenterX = enemy.x + (enemy.width * 0.5);
        const enemyCenterY = enemy.y + (enemy.height * 0.5);
        const collisionEnemyHalfWidth = Math.max(0.55, (enemy.width * 0.5) - ENEMY_PLAYER_COLLISION_INSET_X);
        const collisionEnemyHalfHeight = Math.max(0.45, (enemy.height * 0.5) - ENEMY_PLAYER_COLLISION_INSET_Y);
        const collidingShip = shipAnchors.find((anchor) => {
            const radiusX = anchor.kind === "wingman" ? PLAYER_COLLISION_RADIUS_X + 0.12 : PLAYER_COLLISION_RADIUS_X;
            const radiusY = anchor.kind === "wingman" ? PLAYER_COLLISION_RADIUS_Y + 0.08 : PLAYER_COLLISION_RADIUS_Y;
            return Math.abs(enemyCenterX - anchor.x) <= collisionEnemyHalfWidth + radiusX
                && Math.abs(enemyCenterY - anchor.y) <= collisionEnemyHalfHeight + radiusY;
        });

        if (!collidingShip) {
            index += 1;
            continue;
        }

        const damaged = damageShipAt(collidingShip.key);
        uiDirty = damaged || uiDirty;
        if (damaged) {
            refreshShipAnchors();
        }

        if (runtime.phase === "core") {
            runtime.enemies[index] = spawnEnemy(enemy.id, true, enemy.lane, enemy.lane === "standard" ? "standard" : undefined, runtime.corruptedBytes);
            index += 1;
            continue;
        }

        runtime.enemies.splice(index, 1);
        runtime.hostileCount = (runtime.boss ? 1 : 0) + runtime.enemies.length;
    }

    if (runtime.phase === "core") {
        runtime.hostileCount = runtime.enemies.length;
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
        runtime.boss.summonCooldownMs = Math.max(0, runtime.boss.summonCooldownMs - FIXED_DT_MS);
        runtime.boss.fireCooldownMs = Math.max(0, runtime.boss.fireCooldownMs - FIXED_DT_MS);

        if (runtime.boss.attackMode === "firewall" && runtime.boss.bossShieldHp > 0) {
            const fw = runtime.boss.firewall;
            if (fw) {
                if (!fw.fading) {
                    fw.progress = Math.min(1, fw.progress + (BOSS_FIREWALL_SPEED * dtSeconds) / PLAYFIELD_HEIGHT);
                    let fwPos: number;
                    let playerCoord: number;
                    if (fw.direction === "top") {
                        fwPos = getFirewallAxisPosition(fw);
                        playerCoord = runtime.player.y;
                    } else if (fw.direction === "bottom") {
                        fwPos = getFirewallAxisPosition(fw);
                        playerCoord = runtime.player.y;
                    } else if (fw.direction === "left") {
                        fwPos = getFirewallAxisPosition(fw);
                        playerCoord = runtime.player.x;
                    } else {
                        fwPos = getFirewallAxisPosition(fw);
                        playerCoord = runtime.player.x;
                    }
                    if (Math.abs(playerCoord - fwPos) <= BOSS_FIREWALL_HALF_THICKNESS) {
                        const damaged = damageShipAt("player");
                        uiDirty = damaged || uiDirty;
                        if (damaged) refreshShipAnchors();
                    }
                    if (fw.progress >= 0.8) {
                        fw.fading = true;
                    }
                } else {
                    fw.alpha = Math.max(0, fw.alpha - BOSS_FIREWALL_FADE_RATE * dtSeconds);
                    if (fw.alpha <= 0) {
                        runtime.boss.firewall = null;
                        bossFirewallsRemaining = Math.max(0, bossFirewallsRemaining - 1);
                        if (bossFirewallsRemaining > 0) {
                            runtime.boss.firewall = { direction: pickFirewallDir(), progress: 0, alpha: 1, fading: false };
                        } else {
                            transitionBossMode(getNextBossAttackMode("firewall"));
                        }
                        uiDirty = true;
                    }
                }
            } else if (bossFirewallsRemaining > 0) {
                runtime.boss.firewall = { direction: pickFirewallDir(), progress: 0, alpha: 1, fading: false };
                uiDirty = true;
            }
        } else if (runtime.boss.firewall) {
            runtime.boss.firewall = null;
            bossFirewallsRemaining = 0;
            uiDirty = true;
        }

        if (runtime.boss.attackMode !== "firewall") {
            runtime.boss.attackModeMs = Math.max(0, runtime.boss.attackModeMs - FIXED_DT_MS);
            if (runtime.boss.attackModeMs <= 0) {
                transitionBossMode(getNextBossAttackMode(runtime.boss.attackMode));
                uiDirty = true;
            }
        }

        if (runtime.boss.summonCooldownMs <= 0) {
            spawnBossEscort();
            runtime.boss.summonCooldownMs = runtime.boss.attackMode === "firewall"
                ? Math.max(1200, BOSS_SUMMON_COOLDOWN_MS * 0.28)
                : runtime.boss.bossShieldHp > 0
                    ? BOSS_SUMMON_COOLDOWN_MS
                    : Math.max(1700, BOSS_SUMMON_COOLDOWN_MS * 0.4);
            uiDirty = true;
        }
        if (runtime.boss.fireCooldownMs <= 0) {
            fireBossAttack(slowMultiplier);
            uiDirty = true;
        }

        if (runtime.phase === "boss") {
            bossPowerUpCooldownMs = Math.max(0, bossPowerUpCooldownMs - FIXED_DT_MS);
        }
        if (runtime.phase === "boss" && bossPowerUpCooldownMs <= 0) {
            const kindRoll = Math.random();
            const bossDropKind: PowerUpKind = kindRoll < 0.20 ? "dual" : kindRoll < 0.40 ? "laser" : kindRoll < 0.58 ? "slow" : kindRoll < 0.76 ? "explosive" : kindRoll < 0.88 ? "shield" : "healthpack";
            runtime.powerUps.push({ id: powerUpId++, x: randomFloat(10, PLAYFIELD_WIDTH - 10), y: runtime.boss.y + BOSS_HEIGHT + 2, kind: bossDropKind });
            bossPowerUpCooldownMs = runtime.boss.bossShieldHp > 0
                ? Math.max(2600, BOSS_POWERUP_INTERVAL_MS * 0.275)
                : Math.max(1600, BOSS_POWERUP_INTERVAL_MS * 0.16);
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
        const bulletTravelDistance = BULLET_SPEED * dtSeconds;
        for (let bulletIndex = 0; bulletIndex < runtime.bullets.length; bulletIndex += 1) {
            const bullet = runtime.bullets[bulletIndex];
            const previousBulletY = bullet.y + bulletTravelDistance;
            const bulletRadiusX = bullet.kind === "explosive" ? 1.05 : 0.45;
            const bulletRadiusY = bullet.kind === "explosive" ? 1.4 : 0.65;
            let hitsBoss = false;
            let closestImpactY = Number.NEGATIVE_INFINITY;
            if ((runtime.phase === "boss" || runtime.phase === "collapse") && runtime.boss) {
                hitsBoss = verticalSegmentHitsRect(
                    bullet.x,
                    previousBulletY,
                    bullet.y,
                    runtime.boss.x,
                    runtime.boss.y,
                    BOSS_WIDTH,
                    BOSS_HEIGHT,
                    bulletRadiusX,
                    bulletRadiusY
                );
                if (hitsBoss) {
                    closestImpactY = runtime.boss.y + BOSS_HEIGHT;
                }
            }

            let enemyIndex = -1;
            for (let index = 0; index < runtime.enemies.length; index += 1) {
                const enemy = runtime.enemies[index];
                if (verticalSegmentHitsRect(
                    bullet.x,
                    previousBulletY,
                    bullet.y,
                    enemy.x,
                    enemy.y,
                    enemy.width,
                    enemy.height,
                    bulletRadiusX,
                    bulletRadiusY
                )) {
                    const impactY = enemy.y + enemy.height;
                    if (impactY <= closestImpactY) {
                        continue;
                    }
                    enemyIndex = index;
                    closestImpactY = impactY;
                }
            }

            if (enemyIndex === -1) {
                if (hitsBoss) {
                    uiDirty = damageBoss(bullet.kind === "explosive" ? 5 : 1) || uiDirty;
                    continue;
                }
                remainingBullets.push(bullet);
                continue;
            }

            damageEnemyAt(enemyIndex, bullet.kind === "explosive");
        }

        runtime.bullets = remainingBullets;
    }

    if (runtime.effects.laserMs <= 0) {
        laserCooldownMs = 0;
    }

    return uiDirty;
};

const stopLoop = (): void => {
    if (loopHandle) {
        if (loopUsesAnimationFrame && typeof workerScope.cancelAnimationFrame === "function") {
            workerScope.cancelAnimationFrame(loopHandle);
        } else {
            self.clearTimeout(loopHandle);
        }
        loopHandle = 0;
    }
    loopUsesAnimationFrame = false;
    isRunning = false;
};

const scheduleNextTick = (): void => {
    if (typeof workerScope.requestAnimationFrame === "function") {
        loopUsesAnimationFrame = true;
        loopHandle = workerScope.requestAnimationFrame(tick);
        return;
    }

    loopUsesAnimationFrame = false;
    loopHandle = self.setTimeout(() => tick(performance.now()), 16) as unknown as number;
};

const tick = (now = performance.now()): void => {
    if (!isRunning) {
        return;
    }

    loopHandle = 0;
    if (!lastFrameAt) {
        lastFrameAt = now;
    }

    let frameTime = now - lastFrameAt;
    lastFrameAt = now;
    frameTime = Math.min(frameTime, MAX_FRAME_MS);
    accumulator += frameTime;

    if (runtime.status === "running") {
        while (accumulator >= FIXED_DT_MS) {
            accumulator -= FIXED_DT_MS;
            stepSimulation();
        }
    } else {
        accumulator = 0;
    }

    const isTerminal = runtime.status !== "running";
    const shouldSendUi = !lastUiSyncAt
        || (!isTerminal && (now - lastUiSyncAt) >= UI_SYNC_INTERVAL_MS)
        || (isTerminal && !terminalUiPosted);
    if (shouldSendUi) {
        lastUiSyncAt = now;
        if (isTerminal) {
            terminalUiPosted = true;
        }
    }
    if (renderInWorker) {
        drawScene();
        if (shouldSendUi) {
            postFrame(true);
        }
    } else {
        postFrame(shouldSendUi);
    }

    if (isTerminal) {
        stopLoop();
        return;
    }

    scheduleNextTick();
};

const resetRuntime = (): void => {
    runtime = createInitialRuntime();
    shotCooldownRemainingMs = 0;
    bulletId = 0;
    standardEnemyId = STANDARD_ENEMY_COUNT;
    specialEnemyId = STANDARD_ENEMY_COUNT;
    enemyShotId = 0;
    powerUpId = 0;
    laserCooldownMs = 0;
    fireBufferCount = 0;
    pendingCoreUpdates = [];
    pendingSounds = [];
    terminalUiPosted = false;
    devInvulnerable = false;
    bossPowerUpCooldownMs = 0;
    bossFirewallsRemaining = 0;
    bossPatternIndex = 0;
    lastFirewallDirection = "";
    collapseByteIndices = [];
    finalGlitchRemainingMs = 0;
    finalShutdownRemainingMs = 0;
    accumulator = 0;
    lastFrameAt = 0;
    lastUiSyncAt = performance.now();
};

runtime = createInitialRuntime();

self.addEventListener("message", (event: MessageEvent<WorkerControlMessage>) => {
    const message = event.data;
    if (!message) {
        return;
    }

    if (message.type === "init") {
        renderInWorker = Boolean(message.renderInWorker && message.canvas);
        renderCanvas = renderInWorker && message.canvas ? message.canvas : null;
        renderContext = renderCanvas ? renderCanvas.getContext("2d") : null;
        if (renderCanvas) {
            updateRenderMetrics(message.width || 1, message.height || 1, message.dpr || 1);
        } else {
            renderMetrics = null;
        }
        resetRuntime();
        if (isRunning) {
            stopLoop();
        }
        isRunning = true;
        if (renderInWorker) {
            drawScene();
        }
        postFrame(true, true);
        scheduleNextTick();
        return;
    }

    if (message.type === "resize") {
        if (renderCanvas) {
            updateRenderMetrics(message.width, message.height, message.dpr);
            drawScene();
        }
        return;
    }

    if (message.type === "reset") {
        stopLoop();
        resetRuntime();
        isRunning = true;
        if (renderInWorker) {
            drawScene();
        }
        postFrame(true, true);
        scheduleNextTick();
        return;
    }

    if (message.type === "dispose") {
        stopLoop();
        renderCanvas = null;
        renderContext = null;
        renderMetrics = null;
        renderInWorker = false;
        return;
    }

    if (message.type === "pulseFire") {
        fireBufferCount += 1;
        return;
    }

    if (message.type === "setFire") {
        inputState.fire = message.active;
        return;
    }

    if (message.type === "setDirection") {
        inputState[message.direction] = message.active;
    }

    if (message.type === "devGotoBoss") {
        if (runtime.status === "running" && runtime.phase !== "boss") {
            startBossBattle();
            postFrame(true, false);
        }
        return;
    }

    if (message.type === "devToggleInvulnerable") {
        devInvulnerable = !devInvulnerable;
        return;
    }

    if (message.type === "devPowerUp") {
        applyPowerUp(message.kind);
        postFrame(true, false);
        return;
    }

    if (message.type === "devHeal") {
        runtime.health = runtime.maxHealth;
        runtime.shieldHp = 0;
        postFrame(true, false);
        return;
    }

    if (message.type === "devSkipCollapse") {
        if (runtime.phase === "collapse" || runtime.phase === "glitch" || runtime.phase === "shutdown") {
            collapseByteIndices = [];
            runtime.corruptedBytes = 0;
            runtime.phase = "epilogue";
            finalGlitchRemainingMs = 0;
            finalShutdownRemainingMs = 0;
            runtime.status = "victory";
            postFrame(true, true);
        }
        return;
    }
});
