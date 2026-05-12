/// <reference lib="webworker" />

import type {
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
    UiSnapshot,
    WingmanState,
    WorkerFrameMessage,
} from "./shared";
import {
    BOSS_FIRE_COOLDOWN_MS,
    BOSS_HEALTH,
    BOSS_HEIGHT,
    BOSS_PLAYER_COLLISION_INSET_X,
    BOSS_PLAYER_COLLISION_INSET_Y,
    BOSS_PLAYER_COLLISION_RADIUS_X,
    BOSS_PLAYER_COLLISION_RADIUS_Y,
    BOSS_WIDTH,
    BULLET_SPEED,
    CORE_BYTE_COUNT,
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
    PLAYER_RESPITE_MS,
    PLAYER_SPEED,
    PLAYER_START_LIVES,
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
    | { type: "setDirection"; direction: InputDirection; active: boolean };

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
let specialEnemyId = STANDARD_ENEMY_COUNT;
let enemyShotId = 0;
let powerUpId = 0;
let laserCooldownMs = 0;
let fireBufferCount = 0;
let pendingCoreUpdates: CoreByteUpdate[] = [];
let terminalUiPosted = false;
let renderInWorker = false;
let renderCanvas: OffscreenCanvas | null = null;
let renderContext: OffscreenCanvasRenderingContext2D | null = null;
let renderMetrics: { width: number; height: number; dpr: number; xScale: number; yScale: number; fontScale: number } | null = null;

type WorkerScopeWithAnimationFrame = DedicatedWorkerGlobalScope & {
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
};

const workerScope = self as unknown as WorkerScopeWithAnimationFrame;

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

const getEnemyDimensions = (enemy: EnemyState): Pick<EnemyState, "width" | "height"> => {
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
    const speedProfile = kind === "fast"
        ? { vx: randomFloat(-8.5, 8.5), vy: randomFloat(17, 23.5) }
        : kind === "block"
            ? { vx: randomFloat(-2.8, 2.8), vy: randomFloat(5.7, 8.8) }
            : kind === "gunner"
                ? { vx: randomFloat(-4.4, 4.4), vy: randomFloat(8.8, 12.8) }
                : { vx: randomFloat(-5.5, 5.5), vy: randomFloat(9, 15.5) };
    return {
        ...prototypeEnemy,
        x: randomFloat(3, Math.max(3, spawnWidth - 3)),
        y: spawnFromTop ? randomFloat(-12, 4) : randomFloat(10, 64),
        vx: speedProfile.vx,
        vy: speedProfile.vy,
        fireCooldownMs: kind === "gunner" ? randomInt(700, 1500) : 0,
    };
};

function createInitialRuntime(): RuntimeSnapshot {
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
        id: powerUpId++,
        x,
        y,
        kind,
    });
};

const applyPowerUp = (kind: PowerUpKind): void => {
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
    const dx = clamp(targetX - x, -14, 14);
    runtime.enemyShots.push({
        id: enemyShotId++,
        x,
        y,
        vx: dx * 0.55,
        vy: ENEMY_PROJECTILE_SPEED * speedMultiplier,
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
        specialEnemies.push(spawnEnemy(specialEnemyId++, true, "special", undefined, runtime.corruptedBytes));
    }
    if (specialEnemies.length > allowedSpecialCount) {
        specialEnemies.length = allowedSpecialCount;
    }

    runtime.enemies = [...standardEnemies, ...specialEnemies];
    runtime.hostileCount = runtime.enemies.length;
};

const damageShipAt = (shipKey: string): boolean => {
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
    boss: runtime.boss ? { ...runtime.boss } : null,
    effects: { ...runtime.effects },
    phase: runtime.phase,
    laserActive: runtime.effects.laserMs > 0 && inputState.fire,
    status: runtime.status,
});

const toUiSnapshot = (forceFullCoreBytes = false): UiSnapshot => {
    const snapshot: UiSnapshot = {
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
        renderContext.fillText("<^>", runtime.player.x * renderMetrics.xScale, runtime.player.y * renderMetrics.yScale);
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
        renderContext.fillText("v", shot.x * renderMetrics.xScale, shot.y * renderMetrics.yScale);
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
            : enemy.kind === "block"
                ? "#ffbe7d"
                : enemy.kind === "gunner"
                    ? "#ff8f9d"
                    : "#ff7d89";
        enemy.lines.forEach((line, index) => {
            const lineY = enemy.y + ((enemy.height / enemy.lines.length) * (index + 0.5));
            renderContext.fillText(line, enemy.x * renderMetrics.xScale, lineY * renderMetrics.yScale);
        });
    });

    if (runtime.phase === "boss" && runtime.boss) {
        const pixelX = runtime.boss.x * renderMetrics.xScale;
        const pixelY = runtime.boss.y * renderMetrics.yScale;
        const pixelWidth = BOSS_WIDTH * renderMetrics.xScale;
        const pixelHeight = BOSS_HEIGHT * renderMetrics.yScale;

        renderContext.strokeStyle = "#ff8aa0";
        renderContext.lineWidth = 2;
        renderContext.strokeRect(pixelX, pixelY, pixelWidth, pixelHeight);
        renderContext.fillStyle = "rgba(255, 90, 116, 0.12)";
        renderContext.fillRect(pixelX, pixelY, pixelWidth, pixelHeight);
        renderContext.fillStyle = "#ffd6de";
        renderContext.textAlign = "center";
        renderContext.fillText("APHELION PRIME", pixelX + (pixelWidth * 0.5), pixelY + (pixelHeight * 0.33));
        renderContext.fillText(`BOSS HP ${String(runtime.boss.health).padStart(2, "0")}`, pixelX + (pixelWidth * 0.5), pixelY + (pixelHeight * 0.68));
    }
};

const stepSimulation = (): boolean => {
    if (runtime.status !== "running") {
        return false;
    }

    let uiDirty = false;
    const dtSeconds = FIXED_DT_MS / 1000;
    const slowMultiplier = runtime.effects.slowMs > 0 ? SLOW_FACTOR : 1;
    const hostileSpeedMultiplier = runtime.phase === "core" && runtime.corruptedBytes >= CORE_SPEEDUP_THRESHOLD
        ? HOSTILE_OVERDRIVE_MULTIPLIER
        : 1;

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
        hydrateEnemyGeometry(currentEnemy);
    };

    const fireLaserVolley = (): void => {
        if (laserCooldownMs > 0) {
            laserCooldownMs = Math.max(0, laserCooldownMs - FIXED_DT_MS);
            return;
        }

        laserCooldownMs = LASER_TICK_MS;
        const damagedEnemyIndices = new Set<number>();
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

        damagedEnemyIndices.forEach((enemyIndex) => {
            damageEnemyAt(enemyIndex);
        });
        if (damagedEnemyIndices.size) {
            uiDirty = true;
        }
    };

    if (runtime.effects.laserMs > 0 && inputState.fire) {
        fireLaserVolley();
    } else if ((fireBufferCount > 0 || inputState.fire) && appendBullet()) {
        uiDirty = true;
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

    if (runtime.phase === "core") {
        for (let index = 0; index < runtime.enemies.length; index += 1) {
            const enemy = runtime.enemies[index];
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

            if (enemy.kind === "gunner") {
                enemy.fireCooldownMs = Math.max(0, enemy.fireCooldownMs - (FIXED_DT_MS * hostileSpeedMultiplier));
                if (enemy.fireCooldownMs <= 0 && enemy.y > 10) {
                    spawnEnemyProjectile(enemy.x + (enemy.width * 0.5), enemy.y + enemy.height, runtime.player.x, slowMultiplier * hostileSpeedMultiplier);
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
            }
        }

        for (let index = 0; index < runtime.enemies.length; index += 1) {
            const enemy = runtime.enemies[index];
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
        const bulletTravelDistance = BULLET_SPEED * dtSeconds;
        for (let bulletIndex = 0; bulletIndex < runtime.bullets.length; bulletIndex += 1) {
            const bullet = runtime.bullets[bulletIndex];
            const previousBulletY = bullet.y + bulletTravelDistance;
            const bulletRadiusX = bullet.kind === "explosive" ? 1.05 : 0.45;
            const bulletRadiusY = bullet.kind === "explosive" ? 1.4 : 0.65;
            if (runtime.phase === "boss" && runtime.boss) {
                const hitsBoss = verticalSegmentHitsRect(
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
                    uiDirty = damageBoss(bullet.kind === "explosive" ? 5 : 1) || uiDirty;
                    continue;
                }
            }

            let enemyIndex = -1;
            let closestImpactY = Number.NEGATIVE_INFINITY;
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
    specialEnemyId = STANDARD_ENEMY_COUNT;
    enemyShotId = 0;
    powerUpId = 0;
    laserCooldownMs = 0;
    fireBufferCount = 0;
    pendingCoreUpdates = [];
    terminalUiPosted = false;
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
});
