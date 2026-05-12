import React, { useEffect, useMemo, useRef, useState } from "react";
import "./style.scss";

interface MainframeGameProps {
    className?: string;
    onRendered?: () => void;
}

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
    lives: number;
    status: "running" | "victory" | "defeat";
}

interface UiSnapshot {
    coreBytes: string[];
    corruptedBytes: number;
    shots: number;
    hits: number;
    purged: number;
    lives: number;
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

const PLAYFIELD_WIDTH = 100;
const PLAYFIELD_HEIGHT = 100;
const PLAYER_SPEED = 34;
const BULLET_SPEED = 74;
const ENEMY_COUNT = 8;
const SHOOT_COOLDOWN_MS = 140;
const CORE_BYTE_COUNT = 1024;
const CORE_BYTES_PER_ROW = 16;
const CORE_COLUMN_COUNT = 2;
const CORRUPTION_BYTES_PER_HIT = 3;
const ENEMY_Y_LIMIT = 94;
const FIXED_DT_MS = 1000 / 120;
const MAX_FRAME_MS = 48;
const PLAYER_COLLISION_RADIUS_X = 6;
const PLAYER_COLLISION_RADIUS_Y = 3.2;
const PLAYER_START_LIVES = 3;
const CORRUPTION_SYMBOLS = [
    "~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "-", "=",
    "{", "}", "|", ":", "\"", "<", ">", "?", ",", ".", "/", ";", "'", "[", "]", "\\",
];
const HEX_DIGITS = "0123456789abcdef";

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

const getEnemyLabel = (enemy: EnemyState): string => {
    return `0x${enemy.body}`;
};

const getFallbackEnemyWidth = (enemy: EnemyState, metrics?: PlayfieldMetrics | null): number => {
    const characterWidth = metrics ? metrics.enemyCharWorldWidth : 0.72;
    return Math.max(4.2, getEnemyLabel(enemy).length * characterWidth);
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

const buildEnemy = (id: number, spawnFromTop = false): EnemyState => {
    const body = generateEnemyBody();
    const width = Math.max(0, PLAYFIELD_WIDTH - getFallbackEnemyWidth({ id, x: 0, y: 0, vx: 0, vy: 0, body }));
    return {
        id,
        x: randomFloat(3, Math.max(3, width - 3)),
        y: spawnFromTop ? randomFloat(-12, 4) : randomFloat(10, 64),
        vx: randomFloat(-5.5, 5.5),
        vy: randomFloat(9, 15.5),
        body,
    };
};

const createInitialRuntime = (): RuntimeSnapshot => {
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
        lives: PLAYER_START_LIVES,
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
    status: runtime.status,
});

const uiSnapshotNeedsReset = (snapshot: UiSnapshot): boolean => {
    return snapshot.coreBytes.length !== CORE_BYTE_COUNT
        || !Number.isFinite(snapshot.corruptedBytes)
        || !Number.isFinite(snapshot.shots)
        || !Number.isFinite(snapshot.hits)
        || !Number.isFinite(snapshot.purged)
        || !Number.isFinite(snapshot.lives)
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
    const accumulatorRef = useRef<number>(0);
    const shotCooldownRef = useRef<number>(0);
    const bulletIdRef = useRef<number>(0);
    const fireBufferRef = useRef<number>(0);
    const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const enemyWidthCacheRef = useRef<Map<string, number>>(new Map());

    const syncUi = (): void => {
        setUiSnapshot(toUiSnapshot(runtimeRef.current));
    };

    const getEnemyWidth = (enemy: EnemyState): number => {
        const metrics = playfieldMetricsRef.current;
        const context = canvasContextRef.current;
        if (!metrics || !context) {
            return getFallbackEnemyWidth(enemy, metrics);
        }

        const label = getEnemyLabel(enemy);
        const cacheKey = `${metrics.fontScale}:${label}`;
        const cachedWidth = enemyWidthCacheRef.current.get(cacheKey);
        if (cachedWidth !== undefined) {
            return cachedWidth;
        }

        context.save();
        context.font = `${metrics.fontScale}px Vga, Menlo, Monaco, Consolas, monospace`;
        const measuredWidth = context.measureText(label).width / metrics.xScale;
        context.restore();

        const worldWidth = Math.max(3.8, measuredWidth - 0.55);
        enemyWidthCacheRef.current.set(cacheKey, worldWidth);
        return worldWidth;
    };

    const rebuildBackground = (): void => {
        const canvas = canvasRef.current;
        const playfield = playfieldRef.current;
        if (!canvas || !playfield) {
            return;
        }

        const metrics = buildPlayfieldMetrics(playfield);
        playfieldMetricsRef.current = metrics;
        enemyWidthCacheRef.current.clear();
        canvas.width = Math.max(1, Math.round(metrics.width * metrics.dpr));
        canvas.height = Math.max(1, Math.round(metrics.height * metrics.dpr));
        canvas.style.width = `${metrics.width}px`;
        canvas.style.height = `${metrics.height}px`;

        const context = canvas.getContext("2d");
        canvasContextRef.current = context;

        const backgroundCanvas = document.createElement("canvas");
        backgroundCanvas.width = canvas.width;
        backgroundCanvas.height = canvas.height;
        backgroundCanvasRef.current = backgroundCanvas;

        const backgroundContext = backgroundCanvas.getContext("2d");
        if (!context || !backgroundContext) {
            return;
        }

        backgroundContext.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);

        const gradient = backgroundContext.createLinearGradient(0, 0, 0, metrics.height);
        gradient.addColorStop(0, "#0a1430");
        gradient.addColorStop(1, "#040918");
        backgroundContext.fillStyle = gradient;
        backgroundContext.fillRect(0, 0, metrics.width, metrics.height);

        backgroundContext.strokeStyle = "rgba(127, 149, 209, 0.07)";
        backgroundContext.lineWidth = 1;

        for (let x = 0; x <= PLAYFIELD_WIDTH; x += 6.25) {
            const pixelX = (x / PLAYFIELD_WIDTH) * metrics.width;
            backgroundContext.beginPath();
            backgroundContext.moveTo(pixelX, 0);
            backgroundContext.lineTo(pixelX, metrics.height);
            backgroundContext.stroke();
        }

        for (let y = 0; y <= PLAYFIELD_HEIGHT; y += 8.333) {
            const pixelY = (y / PLAYFIELD_HEIGHT) * metrics.height;
            backgroundContext.beginPath();
            backgroundContext.moveTo(0, pixelY);
            backgroundContext.lineTo(metrics.width, pixelY);
            backgroundContext.stroke();
        }
    };

    const drawScene = (alpha = 0): void => {
        const canvas = canvasRef.current;
        const context = canvasContextRef.current;
        const metrics = playfieldMetricsRef.current;
        if (!canvas || !context || !metrics) {
            return;
        }

        const backgroundCanvas = backgroundCanvasRef.current;
        const runtime = runtimeRef.current;
        const alphaSeconds = (FIXED_DT_MS * alpha) / 1000;
        const moveX = (inputRef.current.right ? 1 : 0) - (inputRef.current.left ? 1 : 0);
        const moveY = (inputRef.current.down ? 1 : 0) - (inputRef.current.up ? 1 : 0);
        const renderPlayerX = clamp(runtime.player.x + (moveX * PLAYER_SPEED * alphaSeconds), 1.5, PLAYFIELD_WIDTH - 6);
        const renderPlayerY = clamp(runtime.player.y + (moveY * PLAYER_SPEED * alphaSeconds), 6, PLAYFIELD_HEIGHT - 6);

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (backgroundCanvas) {
            context.drawImage(backgroundCanvas, 0, 0);
        }

        context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
        context.textBaseline = "middle";
        context.textAlign = "center";
        context.font = `${metrics.fontScale}px Vga, Menlo, Monaco, Consolas, monospace`;

        context.fillStyle = "#d8e4ff";
        context.textAlign = "center";
        context.fillText("<^>", renderPlayerX * metrics.xScale, renderPlayerY * metrics.yScale);

        context.fillStyle = "#ff9aa8";
        runtime.bullets.forEach((bullet) => {
            context.fillText("|", bullet.x * metrics.xScale, (bullet.y - (BULLET_SPEED * alphaSeconds)) * metrics.yScale);
        });

        context.fillStyle = "#ff7d89";
        context.textAlign = "left";
        runtime.enemies.forEach((enemy) => {
            const width = getEnemyWidth(enemy);
            const nextX = clamp(enemy.x + (enemy.vx * alphaSeconds), 1, PLAYFIELD_WIDTH - width - 1);
            const nextY = enemy.y + (enemy.vy * alphaSeconds);
            context.fillText(getEnemyLabel(enemy), nextX * metrics.xScale, nextY * metrics.yScale);
        });
    };

    const appendBullet = (): boolean => {
        const runtime = runtimeRef.current;
        if (runtime.status !== "running" || shotCooldownRef.current > 0) {
            return false;
        }

        runtime.bullets.push({
            id: bulletIdRef.current++,
            x: runtime.player.x + 1.5,
            y: runtime.player.y - 3,
        });
        runtime.shots += 1;
        shotCooldownRef.current = SHOOT_COOLDOWN_MS;
        return true;
    };

    const corruptCore = (): void => {
        const runtime = runtimeRef.current;
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

        const corruptionCount = Math.min(CORRUPTION_BYTES_PER_HIT, availableIndices.length);
        for (let index = 0; index < corruptionCount; index += 1) {
            const targetPosition = randomInt(0, availableIndices.length - 1);
            const [targetIndex] = availableIndices.splice(targetPosition, 1);
            runtime.coreBytes[targetIndex] = randomCorruptionByte();
            runtime.corruptedBytes += 1;
        }

        if (runtime.corruptedBytes >= CORE_BYTE_COUNT) {
            runtime.status = "victory";
        }
    };

    const stepSimulation = (): boolean => {
        const runtime = runtimeRef.current;
        if (runtime.status !== "running") {
            return false;
        }

        let uiDirty = false;
        const dtSeconds = FIXED_DT_MS / 1000;
        const metrics = playfieldMetricsRef.current;
        shotCooldownRef.current = Math.max(0, shotCooldownRef.current - FIXED_DT_MS);

        const moveX = (inputRef.current.right ? 1 : 0) - (inputRef.current.left ? 1 : 0);
        const moveY = (inputRef.current.down ? 1 : 0) - (inputRef.current.up ? 1 : 0);
        runtime.player.x = clamp(runtime.player.x + (moveX * PLAYER_SPEED * dtSeconds), 1.5, PLAYFIELD_WIDTH - 6);
        runtime.player.y = clamp(runtime.player.y + (moveY * PLAYER_SPEED * dtSeconds), 6, PLAYFIELD_HEIGHT - 6);

        if ((fireBufferRef.current > 0 || inputRef.current.fire) && appendBullet()) {
            uiDirty = true;
            if (fireBufferRef.current > 0) {
                fireBufferRef.current -= 1;
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

        runtime.enemies = runtime.enemies.map((enemy) => {
            const enemyWidth = getEnemyWidth(enemy);
            const enemyCenterX = enemy.x + (enemyWidth * 0.5);
            const playerCenterX = runtime.player.x;
            const playerCenterY = runtime.player.y;
            const collides =
                Math.abs(enemyCenterX - playerCenterX) <= (enemyWidth * 0.5) + PLAYER_COLLISION_RADIUS_X
                && Math.abs(enemy.y - playerCenterY) <= PLAYER_COLLISION_RADIUS_Y;

            if (!collides) {
                return enemy;
            }

            runtime.lives = Math.max(0, runtime.lives - 1);
            uiDirty = true;
            if (runtime.lives <= 0) {
                runtime.status = "defeat";
            }
            return buildEnemy(enemy.id, true);
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

    const handleReset = (): void => {
        runtimeRef.current = createInitialRuntime();
        bulletIdRef.current = 0;
        shotCooldownRef.current = 0;
        fireBufferRef.current = 0;
        accumulatorRef.current = 0;
        lastFrameAtRef.current = 0;
        syncUi();
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

            drawScene(accumulatorRef.current / FIXED_DT_MS);
            if (uiDirty) {
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

    return (
        <div className={containerClassName}>
            <div className="mainframe-game__topline">
                <span>[APHELION_MAINFRAME//FIXED PROCESS]</span>
                <span>[HOSTILE CORE INTEGRITY {String(integrityPercent).padStart(3, "0")}%]</span>
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
                                    <div className="mainframe-game__overlay-title">
                                        {uiSnapshot.status === "victory" ? "CORE NULLIFIED" : "PILOT LOST"}
                                    </div>
                                    <div className="mainframe-game__overlay-copy">
                                        {uiSnapshot.status === "victory"
                                            ? "APHELION memory lattice has been overwritten."
                                            : "A hostile code shard breached the cockpit frame."}
                                    </div>
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
                        <span>[PURGED {String(uiSnapshot.purged).padStart(3, "0")}]</span>
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
                        <span>[BREACH DELTA +3 BYTES / HIT]</span>
                        <span>[TARGET RESPINS AFTER PURGE]</span>
                    </footer>
                </section>
            </div>

            <div className="mainframe-game__bottomline">
                <span>[MOVEMENT IS FIXED-STEP, NOT FPS-LOCKED]</span>
                <span>[3 HULL BREACHES TRIGGER TOTAL FAILURE]</span>
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
