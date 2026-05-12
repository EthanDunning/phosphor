/// <reference lib="webworker" />

type InputDirection = "up" | "down" | "left" | "right";

interface PlayerState {
    x: number;
    y: number;
}

interface BulletState {
    id: number;
    x: number;
    y: number;
}

interface EnemyState {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    body: string;
}

interface RuntimeSnapshot {
    player: PlayerState;
    bullets: BulletState[];
    enemies: EnemyState[];
    coreBytes: string[];
    corruptedBytes: number;
    shots: number;
    hits: number;
    purged: number;
    status: "running" | "victory";
}

interface UiSnapshot {
    coreBytes: string[];
    corruptedBytes: number;
    shots: number;
    hits: number;
    purged: number;
    status: "running" | "victory";
}

interface InputState {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    fire: boolean;
}

interface CanvasState {
    width: number;
    height: number;
    dpr: number;
}

type InitMessage = {
    type: "init";
    canvas: OffscreenCanvas;
    width: number;
    height: number;
    dpr: number;
};

type ResizeMessage = {
    type: "resize";
    width: number;
    height: number;
    dpr: number;
};

type InputMessage = {
    type: "input";
    direction: InputDirection;
    active: boolean;
};

type FireMessage = {
    type: "fire";
    active: boolean;
};

type FirePulseMessage = {
    type: "firePulse";
};

type ResetMessage = {
    type: "reset";
};

type MainMessage =
    | InitMessage
    | ResizeMessage
    | InputMessage
    | FireMessage
    | FirePulseMessage
    | ResetMessage;

const PLAYFIELD_WIDTH = 100;
const PLAYFIELD_HEIGHT = 100;
const PLAYER_SPEED = 34;
const BULLET_SPEED = 74;
const ENEMY_COUNT = 8;
const SHOOT_COOLDOWN_MS = 140;
const CORE_BYTE_COUNT = 128;
const ENEMY_Y_LIMIT = 94;
const FIXED_DT_MS = 1000 / 120;
const MAX_FRAME_MS = 48;
const CORRUPTION_SYMBOLS = [
    "~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "-", "=",
    "{", "}", "|", ":", "\"", "<", ">", "?", ",", ".", "/", ";", "'", "[", "]", "\\",
];
const HEX_DIGITS = "0123456789abcdef";
const BACKGROUND_BLUE = "#0a1430";
const BACKGROUND_BLUE_DARK = "#040918";
const GRID_COLOR = "rgba(127, 149, 209, 0.07)";
const PLAYER_COLOR = "#d8e4ff";
const BULLET_COLOR = "#ff9aa8";
const ENEMY_COLOR = "#ff7d89";

const inputState: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false,
};

let runtime: RuntimeSnapshot = createInitialRuntime();
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let backgroundCanvas: OffscreenCanvas | null = null;
let backgroundContext: OffscreenCanvasRenderingContext2D | null = null;
let canvasState: CanvasState = { width: 0, height: 0, dpr: 1 };
let animationHandle = 0;
let lastFrameAt = 0;
let accumulator = 0;
let bulletId = 0;
let fireBufferCount = 0;
let shotCooldownRemainingMs = 0;

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

const generateEnemyBody = (): string => {
    const byteCount = randomInt(3, 6);
    return Array.from({ length: byteCount }, () => randomHexByte()).join("");
};

const getEnemyWidth = (enemy: EnemyState): number => {
    return Math.max(11, (enemy.body.length + 2) * 1.35);
};

const buildEnemy = (id: number, spawnFromTop = false): EnemyState => {
    const body = generateEnemyBody();
    const width = Math.max(0, PLAYFIELD_WIDTH - getEnemyWidth({ id, x: 0, y: 0, vx: 0, vy: 0, body }));
    return {
        id,
        x: randomFloat(3, Math.max(3, width - 3)),
        y: spawnFromTop ? randomFloat(-12, 4) : randomFloat(10, 64),
        vx: randomFloat(-5.5, 5.5),
        vy: randomFloat(9, 15.5),
        body,
    };
};

function createInitialRuntime(): RuntimeSnapshot {
    return {
        player: {
            x: 48.5,
            y: 88,
        },
        bullets: [],
        enemies: Array.from({ length: ENEMY_COUNT }, (_, index) => buildEnemy(index)),
        coreBytes: Array.from({ length: CORE_BYTE_COUNT }, () => randomHexByte()),
        corruptedBytes: 0,
        shots: 0,
        hits: 0,
        purged: 0,
        status: "running",
    };
}

const toUiSnapshot = (): UiSnapshot => ({
    coreBytes: [...runtime.coreBytes],
    corruptedBytes: runtime.corruptedBytes,
    shots: runtime.shots,
    hits: runtime.hits,
    purged: runtime.purged,
    status: runtime.status,
});

const postUiSnapshot = (): void => {
    self.postMessage({
        type: "ui",
        payload: toUiSnapshot(),
    });
};

const rebuildBackground = (): void => {
    if (!context || !canvasState.width || !canvasState.height) {
        return;
    }

    backgroundCanvas = new OffscreenCanvas(
        Math.max(1, Math.round(canvasState.width * canvasState.dpr)),
        Math.max(1, Math.round(canvasState.height * canvasState.dpr))
    );
    backgroundContext = backgroundCanvas.getContext("2d");

    if (!backgroundContext) {
        return;
    }

    backgroundContext.setTransform(canvasState.dpr, 0, 0, canvasState.dpr, 0, 0);

    const gradient = backgroundContext.createLinearGradient(0, 0, 0, canvasState.height);
    gradient.addColorStop(0, BACKGROUND_BLUE);
    gradient.addColorStop(1, BACKGROUND_BLUE_DARK);
    backgroundContext.fillStyle = gradient;
    backgroundContext.fillRect(0, 0, canvasState.width, canvasState.height);

    backgroundContext.strokeStyle = GRID_COLOR;
    backgroundContext.lineWidth = 1;

    for (let x = 0; x <= PLAYFIELD_WIDTH; x += 6.25) {
        const pixelX = (x / PLAYFIELD_WIDTH) * canvasState.width;
        backgroundContext.beginPath();
        backgroundContext.moveTo(pixelX, 0);
        backgroundContext.lineTo(pixelX, canvasState.height);
        backgroundContext.stroke();
    }

    for (let y = 0; y <= PLAYFIELD_HEIGHT; y += 8.333) {
        const pixelY = (y / PLAYFIELD_HEIGHT) * canvasState.height;
        backgroundContext.beginPath();
        backgroundContext.moveTo(0, pixelY);
        backgroundContext.lineTo(canvasState.width, pixelY);
        backgroundContext.stroke();
    }
}

const resizeCanvas = (width: number, height: number, dpr: number): void => {
    if (!canvas || !context) {
        return;
    }

    canvasState = {
        width: Math.max(1, width),
        height: Math.max(1, height),
        dpr: Math.max(1, dpr),
    };

    canvas.width = Math.max(1, Math.round(canvasState.width * canvasState.dpr));
    canvas.height = Math.max(1, Math.round(canvasState.height * canvasState.dpr));
    rebuildBackground();
    render();
}

const resetRuntime = (): void => {
    runtime = createInitialRuntime();
    bulletId = 0;
    fireBufferCount = 0;
    shotCooldownRemainingMs = 0;
    lastFrameAt = 0;
    accumulator = 0;
    postUiSnapshot();
}

const appendBullet = (): boolean => {
    if (runtime.status !== "running" || shotCooldownRemainingMs > 0) {
        return false;
    }

    runtime.bullets.push({
        id: bulletId++,
        x: runtime.player.x + 1.5,
        y: runtime.player.y - 3,
    });
    runtime.shots += 1;
    shotCooldownRemainingMs = SHOOT_COOLDOWN_MS;
    return true;
};

const corruptCore = (): void => {
    const availableIndices: number[] = [];
    runtime.coreBytes.forEach((value, index) => {
        if (/^[0-9a-f]{2}$/i.test(value)) {
            availableIndices.push(index);
        }
    });

    if (!availableIndices.length) {
        runtime.status = "victory";
        return;
    }

    const targetIndex = availableIndices[randomInt(0, availableIndices.length - 1)];
    runtime.coreBytes[targetIndex] = randomCorruptionByte();
    runtime.corruptedBytes += 1;

    if (runtime.corruptedBytes >= CORE_BYTE_COUNT) {
        runtime.status = "victory";
    }
}

const stepSimulation = (): boolean => {
    if (runtime.status !== "running") {
        return false;
    }

    let uiDirty = false;
    const dtSeconds = FIXED_DT_MS / 1000;
    shotCooldownRemainingMs = Math.max(0, shotCooldownRemainingMs - FIXED_DT_MS);

    const moveX = (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0);
    const moveY = (inputState.down ? 1 : 0) - (inputState.up ? 1 : 0);
    runtime.player.x = clamp(runtime.player.x + (moveX * PLAYER_SPEED * dtSeconds), 1.5, PLAYFIELD_WIDTH - 6);
    runtime.player.y = clamp(runtime.player.y + (moveY * PLAYER_SPEED * dtSeconds), 6, PLAYFIELD_HEIGHT - 6);

    if ((fireBufferCount > 0 || inputState.fire) && appendBullet()) {
        uiDirty = true;
        if (fireBufferCount > 0) {
            fireBufferCount -= 1;
        }
    }

    runtime.bullets = runtime.bullets.filter((bullet) => {
        bullet.y -= BULLET_SPEED * dtSeconds;
        return bullet.y > -4;
    });

    runtime.enemies = runtime.enemies.map((enemy) => {
        const width = getEnemyWidth(enemy);
        let nextEnemyX = enemy.x + (enemy.vx * dtSeconds);
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
        enemy.y += enemy.vy * dtSeconds;
        enemy.vx = nextEnemyVx;

        if (enemy.y >= ENEMY_Y_LIMIT) {
            return buildEnemy(enemy.id, true);
        }

        return enemy;
    });

    if (runtime.bullets.length) {
        const remainingBullets: BulletState[] = [];

        runtime.bullets.forEach((bullet) => {
            const enemyIndex = runtime.enemies.findIndex((enemy) => {
                const width = getEnemyWidth(enemy);
                return bullet.x >= enemy.x
                    && bullet.x <= enemy.x + width
                    && bullet.y >= enemy.y - 1
                    && bullet.y <= enemy.y + 3.5;
            });

            if (enemyIndex === -1) {
                remainingBullets.push(bullet);
                return;
            }

            const enemy = runtime.enemies[enemyIndex];
            runtime.hits += 1;
            corruptCore();
            uiDirty = true;

            if (enemy.body.length <= 2) {
                runtime.purged += 1;
                runtime.enemies[enemyIndex] = buildEnemy(enemy.id, true);
            } else {
                enemy.body = enemy.body.slice(0, -2);
                enemy.vy = Math.min(enemy.vy + 0.35, 18);
            }
        });

        runtime.bullets = remainingBullets;
    }

    return uiDirty;
};

const render = (): void => {
    if (!context || !canvas || !canvasState.width || !canvasState.height) {
        return;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (backgroundCanvas) {
        context.drawImage(backgroundCanvas, 0, 0);
    }

    context.setTransform(canvasState.dpr, 0, 0, canvasState.dpr, 0, 0);
    context.textBaseline = "middle";
    context.textAlign = "center";

    const xScale = canvasState.width / PLAYFIELD_WIDTH;
    const yScale = canvasState.height / PLAYFIELD_HEIGHT;
    const fontScale = Math.max(11, Math.min(canvasState.width * 0.019, canvasState.height * 0.045));
    context.font = `${fontScale}px Vga, Menlo, Monaco, Consolas, monospace`;

    context.fillStyle = PLAYER_COLOR;
    context.fillText("<^>", runtime.player.x * xScale, runtime.player.y * yScale);

    context.fillStyle = BULLET_COLOR;
    runtime.bullets.forEach((bullet) => {
        context.fillText("|", bullet.x * xScale, bullet.y * yScale);
    });

    context.fillStyle = ENEMY_COLOR;
    runtime.enemies.forEach((enemy) => {
        context.fillText(`0x${enemy.body}`, enemy.x * xScale, enemy.y * yScale);
    });
}

const scheduleNextFrame = (callback: (now: number) => void): number => {
    if (typeof self.requestAnimationFrame === "function") {
        return self.requestAnimationFrame(callback);
    }

    return self.setTimeout(() => callback(performance.now()), 16) as unknown as number;
};

const cancelScheduledFrame = (handle: number): void => {
    if (typeof self.cancelAnimationFrame === "function") {
        self.cancelAnimationFrame(handle);
        return;
    }

    self.clearTimeout(handle);
};

const tick = (now: number): void => {
    if (!context) {
        animationHandle = scheduleNextFrame(tick);
        return;
    }

    if (!lastFrameAt) {
        lastFrameAt = now;
    }

    let frameTime = now - lastFrameAt;
    lastFrameAt = now;
    frameTime = Math.min(frameTime, MAX_FRAME_MS);
    accumulator += frameTime;

    let uiDirty = false;
    while (accumulator >= FIXED_DT_MS) {
        accumulator -= FIXED_DT_MS;
        uiDirty = stepSimulation() || uiDirty;
    }

    render();
    if (uiDirty) {
        postUiSnapshot();
    }

    animationHandle = scheduleNextFrame(tick);
};

self.addEventListener("message", (event: MessageEvent<MainMessage>) => {
    const message = event.data;

    if (message.type === "init") {
        canvas = message.canvas;
        context = canvas.getContext("2d");
        resizeCanvas(message.width, message.height, message.dpr);
        postUiSnapshot();
        self.postMessage({ type: "ready" });

        if (animationHandle) {
            cancelScheduledFrame(animationHandle);
        }
        animationHandle = scheduleNextFrame(tick);
        return;
    }

    if (message.type === "resize") {
        resizeCanvas(message.width, message.height, message.dpr);
        return;
    }

    if (message.type === "input") {
        inputState[message.direction] = message.active;
        return;
    }

    if (message.type === "fire") {
        inputState.fire = message.active;
        return;
    }

    if (message.type === "firePulse") {
        fireBufferCount += 1;
        return;
    }

    if (message.type === "reset") {
        resetRuntime();
        return;
    }
});

export {};
