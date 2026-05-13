export type InputDirection = "up" | "down" | "left" | "right";
export type EnemyKind = "standard" | "fast" | "block" | "gunner" | "comet" | "sniper";
export type EnemyLane = "standard" | "special";
export type PowerUpKind = "dual" | "laser" | "slow" | "explosive" | "shield" | "healthpack";
export type BossAttackMode = "volley" | "rain" | "sweep";

export interface PlayerState {
    x: number;
    y: number;
    invulnerableMs: number;
}

export interface WingmanState {
    side: "left" | "right";
    hp: number;
    active: boolean;
    invulnerableMs: number;
}

export interface BulletState {
    id: number;
    x: number;
    y: number;
    kind: "normal" | "explosive";
}

export interface EnemyProjectileState {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    char?: string;
}

export interface PowerUpState {
    id: number;
    x: number;
    y: number;
    kind: PowerUpKind;
}

export interface EnemyState {
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

export interface BossState {
    x: number;
    y: number;
    vx: number;
    health: number;
    maxHealth: number;
    fireCooldownMs: number;
    attackMode: BossAttackMode;
    attackModeMs: number;
    summonCooldownMs: number;
}

export interface EffectState {
    dualMs: number;
    laserMs: number;
    slowMs: number;
    explosiveMs: number;
}

export interface RuntimeSnapshot {
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
    health: number;
    maxHealth: number;
    shieldHp: number;
    hostileCount: number;
    status: "running" | "victory" | "defeat";
}

export interface CoreByteUpdate {
    index: number;
    value: string;
}

export interface UiSnapshot {
    coreBytes?: string[];
    coreUpdates?: CoreByteUpdate[];
    corruptedBytes: number;
    shots: number;
    hits: number;
    purged: number;
    health: number;
    maxHealth: number;
    shieldHp: number;
    enemyShotCount: number;
    powerUpCount: number;
    hostileCount: number;
    effects: EffectState;
    phase: "core" | "boss";
    coreStage: number;
    coreStageCount: number;
    bossHealth: number;
    bossMaxHealth: number;
    bossAttackMode: BossAttackMode | null;
    wingmanHealths: number[];
    status: "running" | "victory" | "defeat";
}

export interface RenderSnapshot {
    player: PlayerState;
    wingmen: WingmanState[];
    bullets: BulletState[];
    enemyShots: EnemyProjectileState[];
    powerUps: PowerUpState[];
    enemies: EnemyState[];
    boss: BossState | null;
    effects: EffectState;
    phase: "core" | "boss";
    laserActive: boolean;
    status: "running" | "victory" | "defeat";
    health: number;
    maxHealth: number;
    shieldHp: number;
}

export type SoundEvent = "bullet" | "explosion" | "death" | "pickuppowerup" | "xblast";

export interface WorkerFrameGameState {
    laserFiring: boolean;
    status: "running" | "victory" | "defeat";
}

export interface WorkerFrameMessage {
    type: "frame";
    render?: RenderSnapshot;
    ui?: UiSnapshot;
    sounds?: SoundEvent[];
    gameState?: WorkerFrameGameState;
}

export interface MainframeWorkerApi {
    init(): void;
    setDirection(direction: InputDirection, active: boolean): void;
    setFire(active: boolean): void;
    pulseFire(): void;
    reset(): void;
    dispose(): void;
}

export const PLAYFIELD_WIDTH = 100;
export const PLAYFIELD_HEIGHT = 100;
export const PLAYER_SPEED = 34;
export const BULLET_SPEED = 74;
export const STANDARD_ENEMY_COUNT = 8;
export const MAX_SPECIAL_ENEMY_COUNT = 8;
export const SHOOT_COOLDOWN_MS = 140;
export const CORE_BYTE_COUNT = 1024;
export const CORE_BYTES_PER_ROW = 16;
export const CORE_COLUMN_COUNT = 2;
export const CORRUPTION_BYTES_PER_HIT = 2;
export const CORE_STAGE_COUNT = 4;
export const ENEMY_Y_LIMIT = 94;
export const FIXED_DT_MS = 1000 / 60;
export const UI_SYNC_INTERVAL_MS = 90;
export const MAX_FRAME_MS = 48;
export const PLAYER_COLLISION_RADIUS_X = 1.42;
export const PLAYER_COLLISION_RADIUS_Y = 1.08;
export const PLAYER_PROJECTILE_COLLISION_RADIUS_X = 1.18;
export const PLAYER_PROJECTILE_COLLISION_RADIUS_Y = 0.96;
export const PLAYER_BOSS_COLLISION_RADIUS_X = 1.72;
export const PLAYER_BOSS_COLLISION_RADIUS_Y = 1.24;
export const ENEMY_PLAYER_COLLISION_INSET_X = 2.15;
export const ENEMY_PLAYER_COLLISION_INSET_Y = 1.05;
export const BOSS_PLAYER_COLLISION_INSET_X = 3.5;
export const BOSS_PLAYER_COLLISION_INSET_Y = 1.35;
export const PLAYER_MAX_HEALTH = 100;
export const HIT_DAMAGE = 25;
export const SHIELD_MAX_HP = 100;
export const SHIELD_RESPITE_MS = 500;
export const HEALTH_PACK_RESTORE = 40;
export const COMET_STEP_MS = 95;
export const COMET_CHAR_HEIGHT = 1.95;
export const PLAYER_RESPITE_MS = 1200;
export const PLAYER_WING_OFFSET = 7;
export const PLAYER_BULLET_EMIT_OFFSET_X = 0.05;
export const WINGMAN_START_HP = 3;
export const WINGMAN_RESPITE_MS = 700;
export const ENEMY_PROJECTILE_SPEED = 28;
export const POWER_UP_FALL_SPEED = 12;
export const POWER_UP_DROP_CHANCE = 0.22;
export const LASER_TICK_MS = 90;
export const DUAL_DURATION_MS = 12000;
export const LASER_DURATION_MS = 9500;
export const SLOW_DURATION_MS = 10500;
export const EXPLOSIVE_DURATION_MS = 10500;
export const SLOW_FACTOR = 0.55;
export const CORE_PHASE_ONE_END = 32;
export const CORE_PHASE_TWO_END = 64;
export const CORE_SPEEDUP_THRESHOLD = CORE_BYTE_COUNT / 2;
export const HOSTILE_OVERDRIVE_MULTIPLIER = 1.22;
export const BOSS_WIDTH = 33;
export const BOSS_HEIGHT = 8.4;
export const BOSS_HEALTH = 400;
export const BOSS_FIRE_COOLDOWN_MS = 1150;
export const BOSS_ATTACK_MODE_DURATION_MS = 3200;
export const BOSS_SUMMON_COOLDOWN_MS = 5200;
export const DEFAULT_ENEMY_CHAR_WORLD_WIDTH = 0.72;
export const DEFAULT_BLOCK_LINE_HEIGHT = 2.72;
export const CORRUPTION_SYMBOLS = [
    "~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "-", "=",
    "{", "}", "|", ":", "\"", "<", ">", "?", ",", ".", "/", ";", "'", "[", "]", "\\",
];
export const HEX_DIGITS = "0123456789abcdef";
export const HEX_BYTE_PATTERN = /^[0-9a-f]{2}$/i;
export const POWER_UP_LABELS: Record<PowerUpKind, string> = {
    dual: "[D]",
    laser: "[L]",
    slow: "[S]",
    explosive: "[X]",
    shield: "[B]",
    healthpack: "[+]",
};
