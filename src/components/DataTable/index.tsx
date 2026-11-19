import React, { FC, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { registerTerminalInput } from "../../lib/terminalInput";
import KeyboardProxy from "../KeyboardProxy";

import "./style.scss";

// A retro "database browser" table: the grid is drawn with DOS box-drawing
// characters in the monospace terminal font, prints line-by-line like a line
// printer, and once printed can be sorted, filtered, paged and navigated with
// the keyboard (rows can link to screens / actions just like a Link).

export type TableBorder = "single" | "double" | "ascii" | "none";
export type TableAlign = "left" | "right" | "center";

export interface TableColumn {
    key: string;
    label: string;
    align: TableAlign;
    width?: number; // fixed character width
}

export interface TableCell {
    text: string;
    className?: string;
}

export interface TableRow {
    cells: TableCell[];
    target?: any; // screen id (string) or LinkTarget[]
    className?: string;
}

export interface DataTableProps {
    title?: string;
    columns?: any[];
    rows?: any[];
    border?: string;
    sortable?: boolean;
    filter?: boolean;
    pageSize?: number;
    sort?: any; // { column: key | label | index, direction: "asc" | "desc" }
    emptyText?: string;
    footer?: boolean; // record-count footer; default true
    className?: string;

    printing?: boolean; // reveal line by line, then call onComplete
    speed?: number; // ms per printed line
    autocomplete?: boolean; // skip the print animation
    autoFocus?: boolean;

    onComplete?: () => void;
    onLineDrawn?: () => void;
    onRowSelect?: (target: any, shiftKey: boolean) => void;
}

// Hard caps so a hostile/broken script can't make the renderer do unbounded work.
const MAX_COLUMNS = 24;
const MAX_ROWS = 5000;
const MAX_CELL_CHARS = 160;
const MAX_TITLE_CHARS = 160;
const DEFAULT_MAX_COLUMN_WIDTH = 40;
const MAX_COLUMN_WIDTH = 120;
const MAX_QUERY_CHARS = 48;
const MAX_PAGE_SIZE = 200;
const DEFAULT_LINE_SPEED = 35;

interface BorderSet {
    tl: string; tr: string; bl: string; br: string;
    h: string; v: string;
    t: string; b: string; l: string; r: string; x: string;
    // header separator (heavier rule under the column labels)
    hh: string; hl: string; hr: string; hx: string; hb: string;
}

const BORDERS: Record<Exclude<TableBorder, "none">, BorderSet> = {
    single: {
        tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│",
        t: "┬", b: "┴", l: "├", r: "┤", x: "┼",
        hh: "═", hl: "╞", hr: "╡", hx: "╪", hb: "╧",
    },
    double: {
        tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║",
        t: "╦", b: "╩", l: "╠", r: "╣", x: "╬",
        hh: "═", hl: "╠", hr: "╣", hx: "╬", hb: "╩",
    },
    ascii: {
        tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|",
        t: "+", b: "+", l: "+", r: "+", x: "+",
        hh: "=", hl: "+", hr: "+", hx: "+", hb: "+",
    },
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// ---- string helpers (code-point aware so box glyphs/accents count as 1) ----

const charLength = (value: string): number => {
    let count = 0;
    for (const _ of value) {
        count++;
    }
    return count;
};

const sliceChars = (value: string, length: number): string => Array.from(value).slice(0, length).join("");

const fit = (value: string, width: number, align: TableAlign = "left"): string => {
    let text = value;
    let length = charLength(text);

    if (length > width) {
        text = width > 1 ? `${sliceChars(text, width - 1)}…` : sliceChars(text, width);
        length = width;
    }

    const pad = width - length;
    if (align === "right") {
        return " ".repeat(pad) + text;
    }
    if (align === "center") {
        const left = Math.floor(pad / 2);
        return " ".repeat(left) + text + " ".repeat(pad - left);
    }
    return text + " ".repeat(pad);
};

// newlines/tabs would break the character grid
const toPlainText = (value: any, max = MAX_CELL_CHARS): string => {
    if (value === null || value === undefined) {
        return "";
    }
    const text = typeof value === "string" ? value : String(value);
    return sliceChars(text.replace(/[\r\n\t]+/g, " "), max);
};

const toAlign = (value: any): TableAlign => {
    return value === "right" || value === "center" ? value : "left";
};

const toClassName = (value: any): string | undefined => {
    return typeof value === "string" && value.trim().length ? value.trim() : undefined;
};

const toTarget = (value: any): any => {
    if (typeof value === "string" && value.trim().length) {
        return value;
    }
    if (Array.isArray(value) && value.length) {
        return value;
    }
    return undefined;
};

// ---- normalization ---------------------------------------------------------

const isRowObject = (row: any): boolean => !!row && typeof row === "object" && !Array.isArray(row);

export const normalizeColumns = (columns: any, rows: any): TableColumn[] => {
    const source = Array.isArray(columns) ? columns : [];

    if (!source.length) {
        // infer from the first row: object keys, or "COL n" for array rows
        const firstRow = Array.isArray(rows) ? rows.find((row: any) => row !== null && row !== undefined) : undefined;
        if (isRowObject(firstRow) && !Array.isArray(firstRow.cells)) {
            return Object.keys(firstRow)
                .filter((key) => key !== "target" && key !== "className")
                .slice(0, MAX_COLUMNS)
                .map((key) => ({ key, label: key.toUpperCase(), align: "left" as TableAlign }));
        }
        const cells = Array.isArray(firstRow) ? firstRow : (isRowObject(firstRow) ? firstRow.cells : []);
        return (cells || []).slice(0, MAX_COLUMNS).map((_: any, index: number) => ({
            key: String(index),
            label: `COL ${index + 1}`,
            align: "left" as TableAlign,
        }));
    }

    return source.slice(0, MAX_COLUMNS).map((column: any, index: number) => {
        if (!isRowObject(column)) {
            const label = toPlainText(column, MAX_TITLE_CHARS);
            return { key: label || String(index), label, align: "left" as TableAlign };
        }

        const label = toPlainText(column.label ?? column.key ?? "", MAX_TITLE_CHARS);
        const key = toPlainText(column.key ?? column.label ?? index, MAX_TITLE_CHARS) || String(index);
        const width = typeof column.width === "number" && Number.isFinite(column.width)
            ? Math.max(1, Math.min(MAX_COLUMN_WIDTH, Math.floor(column.width)))
            : undefined;
        return { key, label, align: toAlign(column.align), width };
    });
};

const toCell = (value: any): TableCell => {
    if (isRowObject(value)) {
        return { text: toPlainText(value.text), className: toClassName(value.className) };
    }
    return { text: toPlainText(value) };
};

export const normalizeRows = (rows: any, columns: TableColumn[]): TableRow[] => {
    if (!Array.isArray(rows)) {
        return [];
    }

    return rows.slice(0, MAX_ROWS).map((row: any): TableRow => {
        let values: any[];
        let target: any;
        let className: string | undefined;

        if (Array.isArray(row)) {
            values = row;
        } else if (isRowObject(row)) {
            target = toTarget(row.target);
            className = toClassName(row.className);
            values = Array.isArray(row.cells)
                ? row.cells
                : columns.map((column, index) => {
                    // object rows are keyed by column key, falling back to the label / index
                    if (column.key in row) return row[column.key];
                    if (column.label in row) return row[column.label];
                    const lower = column.key.toLowerCase();
                    if (lower in row) return row[lower];
                    return row[index];
                });
        } else {
            values = [row];
        }

        const cells = columns.map((_, index) => toCell(values[index]));
        return { cells, target, className };
    });
};

const resolveSortColumn = (sort: any, columns: TableColumn[]): { column: number; direction: 1 | -1 } | null => {
    if (!sort) {
        return null;
    }

    const spec = isRowObject(sort) ? sort : { column: sort };
    let column = -1;
    if (typeof spec.column === "number" && Number.isFinite(spec.column)) {
        column = Math.floor(spec.column);
    } else if (typeof spec.column === "string") {
        const wanted = spec.column.toLowerCase();
        column = columns.findIndex((entry) => entry.key.toLowerCase() === wanted || entry.label.toLowerCase() === wanted);
    }

    if (column < 0 || column >= columns.length) {
        return null;
    }

    const direction = typeof spec.direction === "string" && spec.direction.toLowerCase().startsWith("desc") ? -1 : 1;
    return { column, direction };
};

// ---- layout -----------------------------------------------------------------

type LineKind = "rule" | "title" | "query" | "header" | "row" | "filler" | "empty" | "footer";

interface Line {
    kind: LineKind;
    text?: string; // pre-rendered rule text
    rowIndex?: number; // index into the visible (filtered/sorted) rows, for "row" lines
}

const repeat = (char: string, count: number): string => char.repeat(Math.max(0, count));

// ---- component ----------------------------------------------------------------

const DataTable: FC<DataTableProps> = (props) => {
    const {
        title,
        border,
        sortable = false,
        filter = false,
        emptyText,
        footer = true,
        className,
        printing = false,
        speed,
        autocomplete = false,
        autoFocus = false,
        onComplete,
        onLineDrawn,
        onRowSelect,
    } = props;

    const columns = useMemo(() => normalizeColumns(props.columns, props.rows), [props.columns, props.rows]);
    const rows = useMemo(() => normalizeRows(props.rows, columns), [props.rows, columns]);
    const borderStyle: TableBorder = border === "double" || border === "ascii" || border === "none" ? border : "single";
    const box = borderStyle === "none" ? null : BORDERS[borderStyle];
    const pageSize = typeof props.pageSize === "number" && Number.isFinite(props.pageSize) && props.pageSize >= 1
        ? Math.min(MAX_PAGE_SIZE, Math.floor(props.pageSize))
        : 0;
    const titleText = toPlainText(title, MAX_TITLE_CHARS);
    const emptyLabel = toPlainText(emptyText, MAX_TITLE_CHARS) || "NO MATCHING RECORDS";

    const initialSort = useMemo(() => resolveSortColumn(props.sort, columns), [props.sort, columns]);
    const [sortColumn, setSortColumn] = useState<number | null>(initialSort ? initialSort.column : null);
    const [sortDirection, setSortDirection] = useState<1 | -1>(initialSort ? initialSort.direction : 1);
    const [query, setQuery] = useState("");
    const [filtering, setFiltering] = useState(false);
    const [cursor, setCursor] = useState(0);
    const [focused, setFocused] = useState(false);
    const [pointerInside, setPointerInside] = useState(false);
    const [revealed, setRevealed] = useState(printing && !autocomplete ? 0 : Number.MAX_SAFE_INTEGER);

    const containerRef = useRef<HTMLDivElement>(null);
    const selectedRowRef = useRef<HTMLDivElement>(null);
    const scrollToCursorRef = useRef(false);
    const completedRef = useRef(false);

    // keep callbacks in refs so the print timer isn't reset by parent re-renders
    const onCompleteRef = useRef(onComplete);
    const onLineDrawnRef = useRef(onLineDrawn);
    onCompleteRef.current = onComplete;
    onLineDrawnRef.current = onLineDrawn;

    const interactive = !printing;
    const hasTargets = useMemo(() => rows.some((row) => row.target !== undefined), [rows]);

    // filter, then sort (stable; blanks sink to the bottom)
    const visibleRows = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const filtered = needle
            ? rows.filter((row) => row.cells.some((cell) => cell.text.toLowerCase().includes(needle)))
            : rows;

        if (sortColumn === null || sortColumn >= columns.length) {
            return filtered;
        }

        return filtered
            .map((row, index) => ({ row, index }))
            .sort((a, b) => {
                const left = a.row.cells[sortColumn].text;
                const right = b.row.cells[sortColumn].text;
                if (!left.length !== !right.length) {
                    return left.length ? -1 : 1;
                }
                return (collator.compare(left, right) * sortDirection) || (a.index - b.index);
            })
            .map((entry) => entry.row);
    }, [rows, query, sortColumn, sortDirection, columns.length]);

    const pageCount = pageSize ? Math.max(1, Math.ceil(visibleRows.length / pageSize)) : 1;
    const safeCursor = Math.max(0, Math.min(visibleRows.length - 1, cursor));
    const page = pageSize ? Math.floor(safeCursor / pageSize) : 0;
    const pageStart = page * pageSize;
    const pageRows = pageSize ? visibleRows.slice(pageStart, pageStart + pageSize) : visibleRows;

    // column widths are computed from ALL rows so sorting/filtering/paging never reflows the grid
    const widths = useMemo(() => {
        const indicator = sortable ? 2 : 0;
        const result = columns.map((column, index) => {
            if (column.width) {
                return column.width;
            }
            let width = charLength(column.label) + indicator;
            for (const row of rows) {
                width = Math.max(width, charLength(row.cells[index].text));
            }
            return Math.max(1, Math.min(DEFAULT_MAX_COLUMN_WIDTH, width));
        });

        if (!result.length) {
            return result;
        }

        // make sure full-width lines (title/footer) have enough room
        const gap = box ? 3 : 2;
        const interior = result.reduce((sum, width) => sum + width, 0) + gap * (result.length - 1);
        const wanted = Math.min(MAX_COLUMN_WIDTH, Math.max(
            titleText ? charLength(titleText) : 0,
            footer ? 24 : 0,
            filter ? 22 : 0,
            charLength(emptyLabel),
        ));
        if (interior < wanted) {
            result[result.length - 1] += wanted - interior;
        }
        return result;
    }, [columns, rows, sortable, box, titleText, footer, filter, emptyLabel]);

    // inner width of a full-width line (between the outer borders, excluding the 1-char padding)
    const fullWidth = box
        ? widths.reduce((sum, width) => sum + width + 2, 0) + (widths.length - 1) - 2
        : widths.reduce((sum, width) => sum + width, 0) + 2 * (widths.length - 1);

    const lines = useMemo((): Line[] => {
        const result: Line[] = [];
        const rowCount = pageRows.length;
        // a paged table keeps a fixed-height window (like a DOS record browser),
        // so filtering or a short last page doesn't make the box jump around
        const fillerCount = pageSize && rows.length > pageSize ? pageSize - Math.max(rowCount, 1) : 0;
        const hasTop = !!titleText || filter;
        const segments = (fill: string) => widths.map((width) => repeat(fill, width + 2));
        const full = (fill: string) => repeat(fill, fullWidth + 2);

        if (box) {
            result.push({ kind: "rule", text: hasTop ? box.tl + full(box.h) + box.tr : box.tl + segments(box.h).join(box.t) + box.tr });
            if (titleText) result.push({ kind: "title" });
            if (filter) result.push({ kind: "query" });
            if (hasTop) result.push({ kind: "rule", text: box.l + segments(box.h).join(box.t) + box.r });
            result.push({ kind: "header" });

            if (!rowCount) {
                result.push({ kind: "rule", text: box.hl + segments(box.hh).join(box.hb) + box.hr });
                result.push({ kind: "empty" });
                for (let i = 0; i < fillerCount; i++) result.push({ kind: "filler" });
                if (footer) {
                    result.push({ kind: "rule", text: box.l + full(box.h) + box.r });
                    result.push({ kind: "footer" });
                }
                result.push({ kind: "rule", text: box.bl + full(box.h) + box.br });
                return result;
            }

            result.push({ kind: "rule", text: box.hl + segments(box.hh).join(box.hx) + box.hr });
            pageRows.forEach((_, index) => result.push({ kind: "row", rowIndex: pageStart + index }));
            for (let i = 0; i < fillerCount; i++) result.push({ kind: "filler" });
            if (footer) {
                result.push({ kind: "rule", text: box.l + segments(box.h).join(box.b) + box.r });
                result.push({ kind: "footer" });
                result.push({ kind: "rule", text: box.bl + full(box.h) + box.br });
            } else {
                result.push({ kind: "rule", text: box.bl + segments(box.h).join(box.b) + box.br });
            }
            return result;
        }

        // borderless: plain columns with a rule under the header
        if (titleText) result.push({ kind: "title" });
        if (filter) result.push({ kind: "query" });
        result.push({ kind: "header" });
        result.push({ kind: "rule", text: widths.map((width) => repeat("─", width)).join("  ") });
        if (!rowCount) {
            result.push({ kind: "empty" });
        }
        pageRows.forEach((_, index) => result.push({ kind: "row", rowIndex: pageStart + index }));
        for (let i = 0; i < fillerCount; i++) result.push({ kind: "filler" });
        if (footer) {
            result.push({ kind: "rule", text: repeat("─", fullWidth) });
            result.push({ kind: "footer" });
        }
        return result;
    }, [box, widths, fullWidth, titleText, filter, footer, pageRows, pageStart, pageSize, rows.length]);

    // ---- print animation ----

    const finishPrinting = useCallback(() => {
        if (completedRef.current) {
            return;
        }
        completedRef.current = true;
        onCompleteRef.current && onCompleteRef.current();
    }, []);

    useEffect(() => {
        if (!printing) {
            return;
        }

        if (autocomplete || revealed >= lines.length) {
            if (revealed < lines.length) {
                setRevealed(Number.MAX_SAFE_INTEGER);
            }
            const timer = window.setTimeout(finishPrinting, 0);
            return () => window.clearTimeout(timer);
        }

        const interval = typeof speed === "number" && Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_LINE_SPEED;
        const timer = window.setTimeout(() => {
            onLineDrawnRef.current && onLineDrawnRef.current();
            setRevealed((value) => value + 1);
        }, interval);
        return () => window.clearTimeout(timer);
    }, [printing, autocomplete, revealed, lines.length, speed, finishPrinting]);

    // ---- focus / input registration ----

    useEffect(() => {
        if (interactive && autoFocus && containerRef.current) {
            containerRef.current.focus({ preventScroll: true });
        }
    }, [interactive, autoFocus]);

    // while typing a query, global letter shortcuts (e.g. Shift+H) must not fire
    useEffect(() => {
        if (!filtering) {
            return;
        }
        return registerTerminalInput();
    }, [filtering]);

    useEffect(() => {
        if (scrollToCursorRef.current && selectedRowRef.current) {
            scrollToCursorRef.current = false;
            selectedRowRef.current.scrollIntoView({ block: "nearest" });
        }
    });

    // ---- actions ----

    const moveCursor = useCallback((next: number) => {
        scrollToCursorRef.current = true;
        setCursor(Math.max(0, Math.min(visibleRows.length - 1, next)));
    }, [visibleRows.length]);

    const toggleSort = useCallback((column: number) => {
        if (!sortable || column < 0 || column >= columns.length) {
            return;
        }
        if (sortColumn === column) {
            setSortDirection((direction) => (direction === 1 ? -1 : 1));
        } else {
            setSortColumn(column);
            setSortDirection(1);
        }
        setCursor(0);
    }, [sortable, columns.length, sortColumn]);

    const goToPage = useCallback((nextPage: number) => {
        if (!pageSize) {
            return;
        }
        const clamped = Math.max(0, Math.min(pageCount - 1, nextPage));
        moveCursor(clamped * pageSize);
    }, [pageSize, pageCount, moveCursor]);

    const updateQuery = useCallback((next: string) => {
        setQuery(sliceChars(next, MAX_QUERY_CHARS));
        setCursor(0);
    }, []);

    const selectRow = useCallback((row: TableRow | undefined, shiftKey: boolean) => {
        if (row && row.target !== undefined && onRowSelect) {
            onRowSelect(row.target, shiftKey);
        }
    }, [onRowSelect]);

    const focusTable = () => {
        containerRef.current && containerRef.current.focus({ preventScroll: true });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!interactive || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        // keys typed into the QUERY line's keyboard input are handled by that input
        if (e.target !== e.currentTarget) {
            return;
        }

        let handled = true;
        const key = e.key;

        if (filtering && key.length === 1 && !(e.shiftKey && key === " ")) {
            updateQuery(query + key);
        } else if (filtering && key === "Backspace") {
            updateQuery(Array.from(query).slice(0, -1).join(""));
        } else if (filtering && key === "Enter") {
            setFiltering(false);
        } else {
            switch (key) {
                case "ArrowDown":
                case "Down":
                    moveCursor(safeCursor + 1);
                    break;
                case "ArrowUp":
                case "Up":
                    moveCursor(safeCursor - 1);
                    break;
                case "PageDown":
                case "ArrowRight":
                case "Right":
                    pageSize ? goToPage(page + 1) : (handled = false);
                    break;
                case "PageUp":
                case "ArrowLeft":
                case "Left":
                    pageSize ? goToPage(page - 1) : (handled = false);
                    break;
                case "Home":
                    moveCursor(0);
                    break;
                case "End":
                    moveCursor(visibleRows.length - 1);
                    break;
                case "Enter":
                    selectRow(visibleRows[safeCursor], e.shiftKey);
                    break;
                case "/":
                    filter ? setFiltering(true) : (handled = false);
                    break;
                case "Escape":
                case "Esc":
                    if (filtering || query) {
                        setFiltering(false);
                        updateQuery("");
                    } else {
                        containerRef.current && containerRef.current.blur();
                    }
                    break;
                default:
                    if (sortable && /^[1-9]$/.test(key) && Number(key) <= columns.length) {
                        toggleSort(Number(key) - 1);
                    } else {
                        handled = false;
                    }
            }
        }

        if (handled) {
            // keep the key away from document-level listeners (prompts, file-system nav)
            e.preventDefault();
            e.stopPropagation();
        }
    };

    // ---- rendering ----

    const v = box ? box.v : "";
    const showCursor = interactive && (focused || pointerInside) && visibleRows.length > 0;

    const borderSpan = (key: string) => <span key={key} className="__table-border">{v}</span>;

    const renderFullLine = (content: ReactNode, extraClassName?: string, onClick?: (e: React.MouseEvent) => void) => {
        if (!box) {
            return <span className={extraClassName} onClick={onClick}>{content}</span>;
        }
        return (
            <>
                {borderSpan("l")}
                <span className={extraClassName} onClick={onClick}>{" "}{content}{" "}</span>
                {borderSpan("r")}
            </>
        );
    };

    const renderCells = (cells: (index: number) => ReactNode) => {
        const nodes: ReactNode[] = [];
        widths.forEach((_, index) => {
            if (index > 0) {
                nodes.push(box ? borderSpan(`b${index}`) : <span key={`g${index}`}>{"  "}</span>);
            }
            nodes.push(cells(index));
        });
        return nodes;
    };

    const renderHeader = () => {
        const cells = renderCells((index) => {
            const column = columns[index];
            const width = widths[index];
            const indicator = sortColumn === index ? (sortDirection === 1 ? "▲" : "▼") : " ";
            const text = sortable
                ? `${fit(column.label, Math.max(0, width - 2), column.align)} ${indicator}`
                : fit(column.label, width, column.align);
            const css = ["__table-heading", sortable ? "is-sortable" : null, sortColumn === index ? "is-sorted" : null]
                .filter(Boolean).join(" ");
            return (
                <span
                    key={`h${index}`}
                    className={css}
                    title={sortable && index < 9 ? `Sort (key ${index + 1})` : undefined}
                    onClick={sortable && interactive ? () => { focusTable(); toggleSort(index); } : undefined}
                >
                    {box ? ` ${text} ` : text}
                </span>
            );
        });
        return box ? <>{borderSpan("l")}{cells}{borderSpan("r")}</> : cells;
    };

    const renderRow = (row: TableRow, rowIndex: number) => {
        const cells = renderCells((index) => {
            const cell = row.cells[index];
            const column = columns[index];
            const text = fit(cell.text, widths[index], column.align);
            return (
                <span key={`c${index}`} className={["__table-cell", cell.className].filter(Boolean).join(" ")}>
                    {box ? ` ${text} ` : text}
                </span>
            );
        });
        const bodyCss = ["__table-rowbody", row.className].filter(Boolean).join(" ");
        const handleClick = (e: React.MouseEvent) => {
            if (!interactive) return;
            focusTable();
            setCursor(rowIndex);
            selectRow(row, e.shiftKey);
        };
        const handleEnter = interactive ? () => setCursor(rowIndex) : undefined;
        const body = <span className={bodyCss}>{cells}</span>;
        return { body, handleClick, handleEnter };
    };

    const renderFooter = () => {
        const total = rows.length;
        const count = visibleRows.length;
        let left: string;
        if (!total) {
            left = "NO RECORDS";
        } else if (pageSize && pageCount > 1) {
            left = `RECORDS ${count ? pageStart + 1 : 0}-${Math.min(count, pageStart + pageSize)} OF ${count}`;
        } else {
            left = `${count} RECORD${count === 1 ? "" : "S"}`;
        }
        if (count !== total) {
            left += ` (${total} TOTAL)`;
        }

        if (!(pageSize && pageCount > 1)) {
            return fit(left, fullWidth);
        }

        const pageLabel = `PAGE ${page + 1}/${pageCount}`;
        const pager = `◄ ${pageLabel} ►`;
        const room = Math.max(0, fullWidth - charLength(pager) - 1);
        return (
            <>
                {fit(left, room)}{" "}
                <span className="__table-pager" onClick={interactive ? () => { focusTable(); goToPage(page - 1); } : undefined}>◄</span>
                {` ${pageLabel} `}
                <span className="__table-pager" onClick={interactive ? () => { focusTable(); goToPage(page + 1); } : undefined}>►</span>
            </>
        );
    };

    const renderQuery = () => {
        const prompt = "QUERY> ";
        const room = Math.max(0, fullWidth - prompt.length);
        if (filtering) {
            const visibleQuery = charLength(query) >= room ? Array.from(query).slice(-(room - 1)).join("") : query;
            return (
                <>
                    {prompt}{visibleQuery}<span className="__table-caret">█</span>
                    {" ".repeat(Math.max(0, room - charLength(visibleQuery) - 1))}
                </>
            );
        }
        if (query) {
            return prompt + fit(query, room);
        }
        return <>{prompt}<span className="__table-dim">{fit("PRESS / OR TAP TO SEARCH", room)}</span></>;
    };

    const renderLine = (line: Line, index: number) => {
        const hidden = index >= revealed;
        const lineCss = (extra?: string | null) => ["__table-line", extra, hidden ? "is-hidden" : null].filter(Boolean).join(" ");

        switch (line.kind) {
            case "rule":
                return <div key={index} className={lineCss("__table-rule")}><span className="__table-border">{line.text}</span></div>;
            case "title":
                return <div key={index} className={lineCss("__table-title")}>{renderFullLine(fit(titleText, fullWidth))}</div>;
            case "query":
                return (
                    <div key={index} className={lineCss("__table-query")}>
                        {renderFullLine(renderQuery(), "__table-query-text")}
                        {/* tapping the QUERY line focuses a real input so phones show their keyboard */}
                        {filter && interactive && !hidden && (
                            <KeyboardProxy
                                value={query}
                                label="Search table"
                                maxLength={MAX_QUERY_CHARS}
                                onFocus={() => setFiltering(true)}
                                onChange={updateQuery}
                                onEnter={() => {
                                    setFiltering(false);
                                    focusTable();
                                }}
                                onEscape={() => {
                                    setFiltering(false);
                                    updateQuery("");
                                    focusTable();
                                }}
                            />
                        )}
                    </div>
                );
            case "header":
                return <div key={index} className={lineCss("__table-header")}>{renderHeader()}</div>;
            case "empty":
                return <div key={index} className={lineCss("__table-empty")}>{renderFullLine(fit(emptyLabel, fullWidth, "center"), "__table-dim")}</div>;
            case "filler":
                return (
                    <div key={index} className={lineCss("__table-filler")} aria-hidden="true">
                        {pageRows.length
                            ? (box ? <>{borderSpan("l")}{renderCells((i) => <span key={`f${i}`}>{" ".repeat(widths[i] + 2)}</span>)}{borderSpan("r")}</> : " ")
                            : renderFullLine(" ".repeat(fullWidth))}
                    </div>
                );
            case "footer":
                return <div key={index} className={lineCss("__table-footer")}>{renderFullLine(renderFooter(), "__table-dim")}</div>;
            case "row": {
                const row = visibleRows[line.rowIndex];
                if (!row) return null;
                const selected = showCursor && line.rowIndex === safeCursor;
                const { body, handleClick, handleEnter } = renderRow(row, line.rowIndex);
                return (
                    <div
                        key={index}
                        ref={selected ? selectedRowRef : undefined}
                        className={lineCss(["__table-row", selected ? "is-selected" : null, row.target !== undefined ? "has-target" : null].filter(Boolean).join(" "))}
                        onClick={handleClick}
                        onMouseEnter={handleEnter}
                    >
                        {box && borderSpan("l")}
                        {body}
                        {box && borderSpan("r")}
                    </div>
                );
            }
            default:
                return null;
        }
    };

    if (!columns.length) {
        return null;
    }

    const hints: string[] = [];
    if (interactive) {
        if (visibleRows.length > 1) hints.push("↑↓ SELECT");
        if (hasTargets) hints.push("ENTER OPEN");
        if (sortable) hints.push(`1-${Math.min(9, columns.length)} SORT`);
        if (filter) hints.push(filtering ? "ENTER DONE" : "/ QUERY");
        if (filter && (filtering || query)) hints.push("ESC CLEAR");
        if (pageSize && pageCount > 1) hints.push("◄► PAGE");
    }

    const css = [
        "__table__",
        `__table--${borderStyle}`,
        interactive ? "is-interactive" : null,
        focused ? "is-focused" : null,
        className,
    ].filter(Boolean).join(" ");

    return (
        <div
            ref={containerRef}
            className={css}
            role="grid"
            aria-label={titleText || undefined}
            aria-rowcount={visibleRows.length}
            tabIndex={interactive ? 0 : undefined}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setFocused(false);
                    setFiltering(false);
                }
            }}
            onMouseEnter={interactive ? () => setPointerInside(true) : undefined}
            onMouseLeave={interactive ? () => setPointerInside(false) : undefined}
        >
            <div className="__table-grid">
                {lines.map(renderLine)}
                {interactive && hints.length > 0 && (
                    <div className={["__table-hint", focused ? "is-visible" : null].filter(Boolean).join(" ")}>
                        {hints.join("  ")}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DataTable;
