import React, { useEffect, useMemo, useRef } from "react";
import type { InputDirection, RenderSnapshot, UiSnapshot, WorkerFrameMessage } from "./shared";
import bulletSoundSrc from "../../assets/aphelion game/bullet.wav";
import explosionSoundSrc from "../../assets/aphelion game/explosion.wav";
import deathSoundSrc from "../../assets/aphelion game/death.wav";
import pickupSoundSrc from "../../assets/aphelion game/pickuppowerup.wav";
import laserSoundSrc from "../../assets/aphelion game/laser.wav";
import xblastSoundSrc from "../../assets/aphelion game/Xblast.wav";
import gameMusicSrc from "../../assets/aphelion game/gamemusic.mp3";
import {
    BOSS_HEIGHT,
    BOSS_WIDTH,
    CORE_BYTE_COUNT,
    CORE_BYTES_PER_ROW,
    CORE_COLUMN_COUNT,
    HEX_BYTE_PATTERN,
    PLAYFIELD_HEIGHT,
    PLAYFIELD_WIDTH,
    PLAYER_START_LIVES,
    PLAYER_WING_OFFSET,
    POWER_UP_LABELS,
} from "./shared";
import "./style.scss";

interface MainframeGameProps {
    className?: string;
    onRendered?: () => void;
}

interface PlayfieldMetrics {
    width: number;
    height: number;
    dpr: number;
    xScale: number;
    yScale: number;
    fontScale: number;
}

interface CoreGlyphPosition {
    x: number;
    y: number;
    width: number;
    height: number;
}

type WorkerControlMessage =
    | { type: "init"; canvas?: OffscreenCanvas; width?: number; height?: number; dpr?: number; renderInWorker?: boolean }
    | { type: "resize"; width: number; height: number; dpr: number }
    | { type: "reset" }
    | { type: "dispose" }
    | { type: "pulseFire" }
    | { type: "setFire"; active: boolean }
    | { type: "setDirection"; direction: InputDirection; active: boolean };

const PLAYER_COLOR = "#d8e4ff";
const PLAYER_DAMAGED_COLOR = "#ffb9c2";
const WINGMAN_COLOR = "#d9d4ff";
const BULLET_COLOR = "#ff9aa8";
const EXPLOSIVE_BULLET_COLOR = "#ffd27d";
const ENEMY_SHOT_COLOR = "#ffad77";
const STANDARD_ENEMY_COLOR = "#ff7d89";
const FAST_ENEMY_COLOR = "#7edcff";
const COMET_ENEMY_COLOR = "#7dff95";
const BLOCK_ENEMY_COLOR = "#ffbe7d";
const GUNNER_ENEMY_COLOR = "#ff8f9d";
const BOSS_OUTLINE_COLOR = "#ff8aa0";
const BOSS_FILL_COLOR = "rgba(255, 90, 116, 0.12)";
const BOSS_TEXT_COLOR = "#ffd6de";
const LASER_COLOR = "rgba(180, 220, 255, 0.72)";
const CORE_OFFSET_COLOR = "rgba(127, 149, 209, 0.82)";
const CORE_BYTE_COLOR = "#c2d2ff";
const CORE_CORRUPTED_BYTE_COLOR = "#ff7485";
const POWER_UP_COLORS: Record<keyof typeof POWER_UP_LABELS, string> = {
    dual: "#f6c5ff",
    laser: "#9fd4ff",
    slow: "#9ff3c1",
    explosive: "#ffd27d",
};
const HEX_DIGITS = "0123456789abcdef";
const CORE_STAGE_LABELS = [
    "SCAN DRIFT",
    "BREACH CURRENT",
    "FIREWALL FALL",
    "PURGE VECTOR",
] as const;
const BOSS_ATTACK_LABELS = {
    volley: "VOLLEY",
    rain: "CODE RAIN",
    sweep: "LATTICE SWEEP",
} as const;

const randomHexByte = (): string => {
    const left = HEX_DIGITS[Math.floor(Math.random() * HEX_DIGITS.length)];
    const right = HEX_DIGITS[Math.floor(Math.random() * HEX_DIGITS.length)];
    return `${left}${right}`;
};

const buildInitialCoreBytes = (): string[] => {
    return Array.from({ length: CORE_BYTE_COUNT }, () => randomHexByte());
};

const buildPlayfieldMetrics = (playfield: HTMLDivElement): PlayfieldMetrics => {
    const width = Math.max(1, Math.floor(playfield.clientWidth));
    const height = Math.max(1, Math.floor(playfield.clientHeight));
    const dpr = window.devicePixelRatio || 1;
    return {
        width,
        height,
        dpr,
        xScale: width / PLAYFIELD_WIDTH,
        yScale: height / PLAYFIELD_HEIGHT,
        fontScale: Math.max(11, Math.min(width * 0.019, height * 0.045)),
    };
};

const clamp = (value: number, min: number, max: number): number => {
    return Math.min(max, Math.max(min, value));
};

const getWingmanX = (playerX: number, side: "left" | "right"): number => {
    return clamp(playerX + (side === "left" ? -PLAYER_WING_OFFSET : PLAYER_WING_OFFSET), 2, PLAYFIELD_WIDTH - 6);
};

const getEnemyFill = (kind: RenderSnapshot["enemies"][number]["kind"]): string => {
    if (kind === "fast") {
        return FAST_ENEMY_COLOR;
    }
    if (kind === "comet") {
        return COMET_ENEMY_COLOR;
    }
    if (kind === "block") {
        return BLOCK_ENEMY_COLOR;
    }
    if (kind === "gunner") {
        return GUNNER_ENEMY_COLOR;
    }
    return STANDARD_ENEMY_COLOR;
};

const playfieldMetricsChanged = (current: PlayfieldMetrics | null, next: PlayfieldMetrics): boolean => {
    return !current
        || current.width !== next.width
        || current.height !== next.height
        || current.dpr !== next.dpr;
};

const MainframeGame = ({ className = "", onRendered }: MainframeGameProps): React.ReactElement => {
    const containerClassName = ["mainframe-game", className].filter(Boolean).join(" ").trim();
    const coreRows = useMemo(() => {
        const rowCount = Math.ceil(CORE_BYTE_COUNT / CORE_BYTES_PER_ROW);
        return Array.from({ length: rowCount }, (_, rowIndex) => {
            const start = rowIndex * CORE_BYTES_PER_ROW;
            return {
                rowIndex,
                offset: start.toString(16).padStart(4, "0"),
                indices: Array.from(
                    { length: Math.min(CORE_BYTES_PER_ROW, CORE_BYTE_COUNT - start) },
                    (_, columnIndex) => start + columnIndex
                ),
            };
        });
    }, []);
    const coreRowBanks = useMemo(() => {
        const rowsPerBank = Math.ceil(coreRows.length / CORE_COLUMN_COUNT);
        return Array.from({ length: CORE_COLUMN_COUNT }, (_, bankIndex) => {
            const start = bankIndex * rowsPerBank;
            return coreRows.slice(start, start + rowsPerBank);
        });
    }, [coreRows]);

    const workerRef = useRef<Worker | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
    const playfieldRef = useRef<HTMLDivElement | null>(null);
    const coreRef = useRef<HTMLDivElement | null>(null);
    const coreLayoutRef = useRef<HTMLDivElement | null>(null);
    const coreCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const metricsRef = useRef<PlayfieldMetrics | null>(null);
    const latestRenderRef = useRef<RenderSnapshot | null>(null);
    const renderInWorkerRef = useRef(false);
    const coreBytesRef = useRef<string[]>(buildInitialCoreBytes());
    const coreByteElementsRef = useRef<Array<HTMLSpanElement | null>>([]);
    const coreOffsetElementsRef = useRef<Array<HTMLSpanElement | null>>([]);
    const coreBytePositionsRef = useRef<Array<CoreGlyphPosition | null>>([]);
    const coreOffsetPositionsRef = useRef<Array<CoreGlyphPosition | null>>([]);

    const phaseLabelRef = useRef<HTMLSpanElement | null>(null);
    const integrityLabelRef = useRef<HTMLSpanElement | null>(null);
    const livesLabelRef = useRef<HTMLSpanElement | null>(null);
    const bottomStatusRef = useRef<HTMLSpanElement | null>(null);
    const bottomObjectiveRef = useRef<HTMLSpanElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTitleRef = useRef<HTMLDivElement | null>(null);
    const overlayCopyRef = useRef<HTMLDivElement | null>(null);

    const musicRef = useRef<HTMLAudioElement | null>(null);
    const laserSoundRef = useRef<HTMLAudioElement | null>(null);
    const xblastSoundRef = useRef<HTMLAudioElement | null>(null);
    const bulletSfxRef = useRef<HTMLAudioElement | null>(null);
    const explosionSfxRef = useRef<HTMLAudioElement | null>(null);
    const deathSfxRef = useRef<HTMLAudioElement | null>(null);
    const pickupSfxRef = useRef<HTMLAudioElement | null>(null);
    const laserPlayingRef = useRef(false);

    const sendWorkerMessage = (message: WorkerControlMessage): void => {
        workerRef.current?.postMessage(message);
    };

    const playOneShot = (audio: HTMLAudioElement | null): void => {
        if (!audio) {
            return;
        }
        audio.currentTime = 0;
        audio.play().catch(() => {});
    };

    const applyCoreByteToElement = (element: HTMLSpanElement, value: string): void => {
        element.textContent = value;
        element.className = `mainframe-game__core-byte${HEX_BYTE_PATTERN.test(value) ? "" : " mainframe-game__core-byte--corrupted"}`;
    };

    const prepareCoreContext = (): CanvasRenderingContext2D | null => {
        const canvas = coreCanvasRef.current;
        const core = coreRef.current;
        if (!canvas || !core) {
            return null;
        }

        const context = canvas.getContext("2d");
        if (!context) {
            return null;
        }

        const computedStyle = window.getComputedStyle(core);
        const fontSize = Number.parseFloat(computedStyle.fontSize) || 16;
        const lineHeight = Number.parseFloat(computedStyle.lineHeight) || fontSize;
        const canvasFontSize = Math.min(fontSize, lineHeight * 1.08);
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        context.font = `${computedStyle.fontStyle} ${computedStyle.fontWeight} ${canvasFontSize}px ${computedStyle.fontFamily}`;
        context.textAlign = "left";
        context.textBaseline = "top";
        context.shadowBlur = 0;
        return context;
    };

    const drawCoreOffsetAt = (rowIndex: number, context = prepareCoreContext()): void => {
        if (!context) {
            return;
        }
        const position = coreOffsetPositionsRef.current[rowIndex];
        const row = coreRows[rowIndex];
        if (!position || !row) {
            return;
        }

        context.clearRect(position.x - 1, position.y - 1, position.width + 2, position.height + 2);
        context.shadowBlur = 0;
        context.fillStyle = CORE_OFFSET_COLOR;
        context.fillText(row.offset, position.x, position.y + 1);
    };

    const drawCoreByteAt = (byteIndex: number, context = prepareCoreContext()): void => {
        if (!context) {
            return;
        }
        const position = coreBytePositionsRef.current[byteIndex];
        const value = coreBytesRef.current[byteIndex];
        if (!position || typeof value !== "string") {
            return;
        }

        context.clearRect(position.x - 1, position.y - 1, position.width + 2, position.height + 2);
        if (HEX_BYTE_PATTERN.test(value)) {
            context.shadowBlur = 0;
            context.fillStyle = CORE_BYTE_COLOR;
        } else {
            context.shadowColor = "rgba(255, 116, 133, 0.38)";
            context.shadowBlur = 8;
            context.fillStyle = CORE_CORRUPTED_BYTE_COLOR;
        }
        context.fillText(value, position.x, position.y + 1);
        context.shadowBlur = 0;
    };

    const drawCoreMemory = (): void => {
        const canvas = coreCanvasRef.current;
        const context = prepareCoreContext();
        if (!canvas || !context) {
            return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        for (let rowIndex = 0; rowIndex < coreRows.length; rowIndex += 1) {
            drawCoreOffsetAt(rowIndex, context);
        }
        for (let byteIndex = 0; byteIndex < coreBytesRef.current.length; byteIndex += 1) {
            drawCoreByteAt(byteIndex, context);
        }
    };

    const syncCoreCanvas = (): void => {
        const core = coreRef.current;
        const layout = coreLayoutRef.current;
        const canvas = coreCanvasRef.current;
        if (!core || !layout || !canvas) {
            return;
        }

        const coreRect = core.getBoundingClientRect();
        const layoutRect = layout.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.ceil(Math.max(core.clientWidth, layoutRect.right - coreRect.left)));
        const height = Math.max(1, Math.ceil(Math.max(core.clientHeight, layoutRect.bottom - coreRect.top)));
        const nextCanvasWidth = Math.max(1, Math.round(width * dpr));
        const nextCanvasHeight = Math.max(1, Math.round(height * dpr));
        if (canvas.width !== nextCanvasWidth) {
            canvas.width = nextCanvasWidth;
        }
        if (canvas.height !== nextCanvasHeight) {
            canvas.height = nextCanvasHeight;
        }
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        coreOffsetPositionsRef.current = coreOffsetElementsRef.current.map((element) => {
            if (!element) {
                return null;
            }
            const rect = element.getBoundingClientRect();
            return {
                x: rect.left - coreRect.left,
                y: rect.top - coreRect.top,
                width: rect.width,
                height: rect.height,
            };
        });
        coreBytePositionsRef.current = coreByteElementsRef.current.map((element) => {
            if (!element) {
                return null;
            }
            const rect = element.getBoundingClientRect();
            return {
                x: rect.left - coreRect.left,
                y: rect.top - coreRect.top,
                width: rect.width,
                height: rect.height,
            };
        });

        drawCoreMemory();
    };

    const drawScene = (snapshot: RenderSnapshot): void => {
        const canvas = canvasRef.current;
        const context = canvasContextRef.current;
        const metrics = metricsRef.current;
        if (!canvas || !context || !metrics) {
            return;
        }

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
        context.textBaseline = "middle";
        context.font = `${metrics.fontScale}px Vga, Menlo, Monaco, Consolas, monospace`;

        if (snapshot.laserActive && snapshot.status === "running") {
            context.strokeStyle = LASER_COLOR;
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(snapshot.player.x * metrics.xScale, snapshot.player.y * metrics.yScale);
            context.lineTo(snapshot.player.x * metrics.xScale, 0);
            snapshot.wingmen.forEach((wingman) => {
                if (!wingman.active) {
                    return;
                }
                const x = getWingmanX(snapshot.player.x, wingman.side) * metrics.xScale;
                context.moveTo(x, snapshot.player.y * metrics.yScale);
                context.lineTo(x, 0);
            });
            context.stroke();
        }

        context.textAlign = "center";
        const playerVisible = snapshot.player.invulnerableMs <= 0 || Math.floor(snapshot.player.invulnerableMs / 90) % 2 === 0;
        if (playerVisible) {
            context.fillStyle = PLAYER_COLOR;
            context.fillText("<^>", snapshot.player.x * metrics.xScale, snapshot.player.y * metrics.yScale);
        }

        snapshot.wingmen.forEach((wingman) => {
            if (!wingman.active) {
                return;
            }
            const visible = wingman.invulnerableMs <= 0 || Math.floor(wingman.invulnerableMs / 90) % 2 === 0;
            if (!visible) {
                return;
            }
            context.fillStyle = wingman.hp === 1 ? PLAYER_DAMAGED_COLOR : WINGMAN_COLOR;
            context.fillText("<^>", getWingmanX(snapshot.player.x, wingman.side) * metrics.xScale, snapshot.player.y * metrics.yScale);
        });

        snapshot.bullets.forEach((bullet) => {
            context.fillStyle = bullet.kind === "explosive" ? EXPLOSIVE_BULLET_COLOR : BULLET_COLOR;
            context.fillText(bullet.kind === "explosive" ? "*" : "|", bullet.x * metrics.xScale, bullet.y * metrics.yScale);
        });

        context.fillStyle = ENEMY_SHOT_COLOR;
        snapshot.enemyShots.forEach((shot) => {
            context.fillText("v", shot.x * metrics.xScale, shot.y * metrics.yScale);
        });

        snapshot.powerUps.forEach((powerUp) => {
            context.fillStyle = POWER_UP_COLORS[powerUp.kind];
            context.fillText(POWER_UP_LABELS[powerUp.kind], powerUp.x * metrics.xScale, powerUp.y * metrics.yScale);
        });

        context.textAlign = "left";
        snapshot.enemies.forEach((enemy) => {
            context.fillStyle = getEnemyFill(enemy.kind);
            enemy.lines.forEach((line, index) => {
                const lineY = enemy.y + ((enemy.height / enemy.lines.length) * (index + 0.5));
                context.fillText(line, enemy.x * metrics.xScale, lineY * metrics.yScale);
            });
        });

        if (snapshot.phase === "boss" && snapshot.boss) {
            const pixelX = snapshot.boss.x * metrics.xScale;
            const pixelY = snapshot.boss.y * metrics.yScale;
            const pixelWidth = BOSS_WIDTH * metrics.xScale;
            const pixelHeight = BOSS_HEIGHT * metrics.yScale;

            context.strokeStyle = BOSS_OUTLINE_COLOR;
            context.lineWidth = 2;
            context.strokeRect(pixelX, pixelY, pixelWidth, pixelHeight);
            context.fillStyle = BOSS_FILL_COLOR;
            context.fillRect(pixelX, pixelY, pixelWidth, pixelHeight);
            context.fillStyle = BOSS_TEXT_COLOR;
            context.textAlign = "center";
            context.fillText("APHELION PRIME", pixelX + (pixelWidth * 0.5), pixelY + (pixelHeight * 0.33));
            const attackLabel = BOSS_ATTACK_LABELS[snapshot.boss.attackMode];
            context.fillText(
                `${attackLabel} // HP ${String(snapshot.boss.health).padStart(3, "0")}`,
                pixelX + (pixelWidth * 0.5),
                pixelY + (pixelHeight * 0.68)
            );
        }
    };

    const applyUiSnapshot = (snapshot: UiSnapshot): void => {
        if (snapshot.coreBytes) {
            coreBytesRef.current = [...snapshot.coreBytes];
            drawCoreMemory();
        } else if (snapshot.coreUpdates?.length) {
            const context = prepareCoreContext();
            for (let index = 0; index < snapshot.coreUpdates.length; index += 1) {
                const update = snapshot.coreUpdates[index];
                coreBytesRef.current[update.index] = update.value;
                drawCoreByteAt(update.index, context);
            }
        }

        const integrityPercent = Math.max(0, Math.round(((CORE_BYTE_COUNT - snapshot.corruptedBytes) / CORE_BYTE_COUNT) * 100));
        const bossIntegrityPercent = snapshot.bossMaxHealth > 0
            ? Math.max(0, Math.round((snapshot.bossHealth / snapshot.bossMaxHealth) * 100))
            : 0;
        const wingStatus = snapshot.wingmanHealths.some((health) => health > 0)
            ? `[WINGS ${snapshot.wingmanHealths.map((health, index) => `${index === 0 ? "L" : "R"}:${health}`).join(" ")}]`
            : "[WINGS OFFLINE]";
        const coreStageLabel = CORE_STAGE_LABELS[Math.max(0, Math.min(CORE_STAGE_LABELS.length - 1, snapshot.coreStage - 1))];
        const bossAttackLabel = snapshot.bossAttackMode ? BOSS_ATTACK_LABELS[snapshot.bossAttackMode] : null;
        const activeEffects = [
            snapshot.effects.dualMs > 0 ? `DUAL ${Math.ceil(snapshot.effects.dualMs / 1000)}S` : null,
            snapshot.effects.laserMs > 0 ? `LASER ${Math.ceil(snapshot.effects.laserMs / 1000)}S` : null,
            snapshot.effects.slowMs > 0 ? `SLOW ${Math.ceil(snapshot.effects.slowMs / 1000)}S` : null,
            snapshot.effects.explosiveMs > 0 ? `BURST ${Math.ceil(snapshot.effects.explosiveMs / 1000)}S` : null,
        ].filter(Boolean).join(" | ");

        phaseLabelRef.current && (phaseLabelRef.current.textContent = snapshot.phase === "boss"
            ? "[APHELION_MAINFRAME//FINAL SHELL]"
            : `[APHELION_MAINFRAME//STAGE ${snapshot.coreStage}/${snapshot.coreStageCount} ${coreStageLabel}]`);
        integrityLabelRef.current && (integrityLabelRef.current.textContent = snapshot.phase === "boss"
            ? `[BOSS SHELL ${String(bossIntegrityPercent).padStart(3, "0")}%]`
            : `[HOSTILE CORE INTEGRITY ${String(integrityPercent).padStart(3, "0")}%]`);
        livesLabelRef.current && (livesLabelRef.current.textContent = `[LIVES ${String(snapshot.lives).padStart(2, "0")}/03]`);
        bottomStatusRef.current && (bottomStatusRef.current.textContent = activeEffects
            ? `[POWERUPS ${activeEffects}] ${wingStatus}`
            : snapshot.phase === "boss"
                ? `[BOSS PATTERN ${bossAttackLabel || "VOLLEY"}] ${wingStatus}`
                : `[CORE STAGE ${snapshot.coreStage}/${snapshot.coreStageCount} ${coreStageLabel}]`);
        bottomObjectiveRef.current && (bottomObjectiveRef.current.textContent = snapshot.phase === "boss"
            ? `[SURVIVE ${bossAttackLabel || "VOLLEY"} // BURN DOWN ${String(snapshot.bossMaxHealth).padStart(3, "0")} HP]`
            : snapshot.coreStage < snapshot.coreStageCount
                ? `[ESCALATE TO STAGE ${snapshot.coreStage + 1} TO UNLOCK NEW HOSTILES]`
                : "[DEPLETING THE CORE SUMMONS APHELION PRIME]");

        if (overlayRef.current) {
            overlayRef.current.hidden = snapshot.status === "running";
        }
        if (overlayTitleRef.current) {
            overlayTitleRef.current.textContent = snapshot.status === "victory" ? "APHELION DOWN" : "PILOT LOST";
        }
        if (overlayCopyRef.current) {
            overlayCopyRef.current.textContent = snapshot.status === "victory"
                ? "The memory core and final command shell have both been purged."
                : "A hostile code shard breached the cockpit frame.";
        }
    };

    const applyRenderSnapshot = (snapshot: RenderSnapshot): void => {
        latestRenderRef.current = snapshot;
        drawScene(snapshot);
    };

    const handleReset = (): void => {
        if (laserSoundRef.current) {
            laserSoundRef.current.pause();
            laserSoundRef.current.currentTime = 0;
        }
        laserPlayingRef.current = false;
        sendWorkerMessage({ type: "reset" });
    };

    const setDirection = (direction: InputDirection, active: boolean): void => {
        sendWorkerMessage({ type: "setDirection", direction, active });
    };

    const setFire = (active: boolean): void => {
        sendWorkerMessage({ type: "setFire", active });
    };

    const pulseFire = (): void => {
        sendWorkerMessage({ type: "pulseFire" });
    };

    useEffect(() => {
        const music = new Audio(gameMusicSrc);
        music.loop = true;
        music.volume = 0.2;
        musicRef.current = music;

        const laser = new Audio(laserSoundSrc);
        laser.loop = true;
        laser.volume = 0.15;
        laserSoundRef.current = laser;

        const xblast = new Audio(xblastSoundSrc);
        xblast.volume = 0.15;
        xblastSoundRef.current = xblast;

        const bullet = new Audio(bulletSoundSrc);
        bullet.volume = 0.15;
        bulletSfxRef.current = bullet;

        const explosion = new Audio(explosionSoundSrc);
        explosion.volume = 0.15;
        explosionSfxRef.current = explosion;

        const death = new Audio(deathSoundSrc);
        death.volume = 0.15;
        deathSfxRef.current = death;

        const pickup = new Audio(pickupSoundSrc);
        pickup.volume = 0.15;
        pickupSfxRef.current = pickup;

        const tryPlayMusic = (): void => {
            music.play().catch(() => {});
        };
        tryPlayMusic();
        document.addEventListener("click", tryPlayMusic, { once: true });
        document.addEventListener("keydown", tryPlayMusic, { once: true });

        return () => {
            music.pause();
            laser.pause();
            document.removeEventListener("click", tryPlayMusic);
            document.removeEventListener("keydown", tryPlayMusic);
            musicRef.current = null;
            laserSoundRef.current = null;
            xblastSoundRef.current = null;
            bulletSfxRef.current = null;
            explosionSfxRef.current = null;
            deathSfxRef.current = null;
            pickupSfxRef.current = null;
        };
    }, []);

    useEffect(() => {
        onRendered && onRendered();
    }, [onRendered]);

    useEffect(() => {
        const core = coreRef.current;
        if (!core) {
            return;
        }

        let animationFrameId = 0;
        const scheduleCoreSync = (): void => {
            if (animationFrameId) {
                return;
            }
            animationFrameId = window.requestAnimationFrame(() => {
                animationFrameId = 0;
                syncCoreCanvas();
            });
        };

        scheduleCoreSync();
        void document.fonts?.ready.then(scheduleCoreSync);

        let resizeObserver: ResizeObserver | null = null;
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(scheduleCoreSync);
            resizeObserver.observe(core);
        }

        return () => {
            if (animationFrameId) {
                window.cancelAnimationFrame(animationFrameId);
            }
            resizeObserver && resizeObserver.disconnect();
        };
    }, []);

    useEffect(() => {
        const playfield = playfieldRef.current;
        const canvas = canvasRef.current;
        if (!playfield || !canvas) {
            return;
        }

        document.body.classList.add("mainframe-game--performance");
        const worker = new Worker(new URL("./mainframeGame.worker.ts", import.meta.url), { type: "module" });
        workerRef.current = worker;
        const supportsOffscreenCanvas = typeof canvas.transferControlToOffscreen === "function";
        let offscreenCanvas: OffscreenCanvas | null = null;
        if (supportsOffscreenCanvas) {
            offscreenCanvas = canvas.transferControlToOffscreen();
            renderInWorkerRef.current = true;
        }

        const syncCanvasMetrics = (): void => {
            const nextMetrics = buildPlayfieldMetrics(playfield);
            if (!playfieldMetricsChanged(metricsRef.current, nextMetrics)) {
                return;
            }
            metricsRef.current = nextMetrics;
            canvas.style.width = `${nextMetrics.width}px`;
            canvas.style.height = `${nextMetrics.height}px`;
            if (renderInWorkerRef.current) {
                sendWorkerMessage({
                    type: "resize",
                    width: nextMetrics.width,
                    height: nextMetrics.height,
                    dpr: nextMetrics.dpr,
                });
                return;
            }

            canvas.width = Math.max(1, Math.round(nextMetrics.width * nextMetrics.dpr));
            canvas.height = Math.max(1, Math.round(nextMetrics.height * nextMetrics.dpr));
            canvasContextRef.current = canvas.getContext("2d");
            if (latestRenderRef.current) {
                drawScene(latestRenderRef.current);
            }
        };

        const handleFrame = (event: MessageEvent<WorkerFrameMessage>): void => {
            const data = event.data;
            if (!data || data.type !== "frame") {
                return;
            }

            if (data.sounds) {
                for (const sound of data.sounds) {
                    if (sound === "bullet") {
                        playOneShot(bulletSfxRef.current);
                    } else if (sound === "explosion") {
                        playOneShot(explosionSfxRef.current);
                    } else if (sound === "death") {
                        playOneShot(deathSfxRef.current);
                    } else if (sound === "pickuppowerup") {
                        playOneShot(pickupSfxRef.current);
                    } else if (sound === "xblast") {
                        playOneShot(xblastSoundRef.current);
                    }
                }
            }

            if (data.gameState) {
                const gameOver = data.gameState.status !== "running";

                const wantsLaser = data.gameState.laserFiring && !gameOver;
                if (wantsLaser && !laserPlayingRef.current) {
                    laserSoundRef.current?.play().catch(() => {});
                    laserPlayingRef.current = true;
                } else if (!wantsLaser && laserPlayingRef.current) {
                    if (laserSoundRef.current) {
                        laserSoundRef.current.pause();
                        laserSoundRef.current.currentTime = 0;
                    }
                    laserPlayingRef.current = false;
                }
            }

            if (data.render) {
                applyRenderSnapshot(data.render);
            }

            data.ui && applyUiSnapshot(data.ui);
        };

        worker.addEventListener("message", handleFrame);
        const initialMetrics = buildPlayfieldMetrics(playfield);
        metricsRef.current = initialMetrics;
        canvas.style.width = `${initialMetrics.width}px`;
        canvas.style.height = `${initialMetrics.height}px`;
        if (renderInWorkerRef.current && offscreenCanvas) {
            worker.postMessage({
                type: "init",
                canvas: offscreenCanvas,
                width: initialMetrics.width,
                height: initialMetrics.height,
                dpr: initialMetrics.dpr,
                renderInWorker: true,
            } satisfies WorkerControlMessage, [offscreenCanvas]);
        } else {
            syncCanvasMetrics();
            worker.postMessage({
                type: "init",
                width: initialMetrics.width,
                height: initialMetrics.height,
                dpr: initialMetrics.dpr,
                renderInWorker: false,
            } satisfies WorkerControlMessage);
        }

        let resizeObserver: ResizeObserver | null = null;
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(() => {
                syncCanvasMetrics();
            });
            resizeObserver.observe(playfield);
        }

        return () => {
            resizeObserver && resizeObserver.disconnect();
            worker.removeEventListener("message", handleFrame);
            worker.postMessage({ type: "dispose" } satisfies WorkerControlMessage);
            worker.terminate();
            workerRef.current = null;
            renderInWorkerRef.current = false;
            canvasContextRef.current = null;
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

    return (
        <div className={containerClassName}>
            <div className="mainframe-game__topline">
                <span ref={phaseLabelRef}>[APHELION_MAINFRAME//FIXED PROCESS]</span>
                <span ref={integrityLabelRef}>[HOSTILE CORE INTEGRITY 100%]</span>
                <span ref={livesLabelRef}>[LIVES {String(PLAYER_START_LIVES).padStart(2, "0")}/03]</span>
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

                        <div ref={overlayRef} className="mainframe-game__overlay" hidden>
                            <div className="mainframe-game__overlay-box">
                                <div ref={overlayTitleRef} className="mainframe-game__overlay-title">PILOT LOST</div>
                                <div ref={overlayCopyRef} className="mainframe-game__overlay-copy">A hostile code shard breached the cockpit frame.</div>
                                <button
                                    type="button"
                                    className="mainframe-game__button"
                                    onClick={handleReset}
                                >
                                    RESTART BREACH
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="mainframe-game__panel mainframe-game__panel--core">
                    <header className="mainframe-game__panel-header">
                        <span>AI MEMORY CORE</span>
                        <span>{CORE_BYTE_COUNT} BYTES</span>
                        <span>[##########]</span>
                    </header>

                    <div ref={coreRef} className="mainframe-game__core">
                        <canvas ref={coreCanvasRef} className="mainframe-game__core-canvas" aria-hidden="true" />
                        <div ref={coreLayoutRef} className="mainframe-game__core-layout" aria-hidden="true">
                            {coreRowBanks.map((bank, bankIndex) => (
                                <div key={`bank-${bankIndex}`} className="mainframe-game__core-bank">
                                    {bank.map((row) => (
                                        <div key={row.offset} className="mainframe-game__core-row">
                                            <span
                                                className="mainframe-game__core-offset"
                                                ref={(element) => {
                                                    coreOffsetElementsRef.current[row.rowIndex] = element;
                                                }}
                                            >
                                                {row.offset}
                                            </span>
                                            <span className="mainframe-game__core-bytes">
                                                {row.indices.map((byteIndex) => (
                                                    <span
                                                        key={`${row.offset}-${byteIndex}`}
                                                        className="mainframe-game__core-byte"
                                                        ref={(element) => {
                                                            coreByteElementsRef.current[byteIndex] = element;
                                                            if (element) {
                                                                applyCoreByteToElement(element, coreBytesRef.current[byteIndex]);
                                                            }
                                                        }}
                                                    >
                                                        {coreBytesRef.current[byteIndex]}
                                                    </span>
                                                ))}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </div>

            <div className="mainframe-game__bottomline">
                <span ref={bottomStatusRef}>[SALVAGE POWERUPS TO STACK ADVANTAGES]</span>
                <span ref={bottomObjectiveRef}>[DEPLETING THE CORE SUMMONS THE BOSS SHELL]</span>
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
