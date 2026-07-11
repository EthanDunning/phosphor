import { CSSProperties, ReactNode } from "react";

type InlineTokenType = "link" | "bold" | "underline" | "italic" | "strikethrough";

interface InlineTokenMatch {
    kind: InlineTokenType;
    index: number;
    raw: string;
    content: string;
    href?: string;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const BULLET_PATTERN = /^\s*[-*+]\s+(.+)$/;
const HORIZONTAL_RULE_PATTERN = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const BULLET_MARKER = "• ";
const HORIZONTAL_RULE_TEXT = "----------------";

export interface MarkdownHeadingMatch {
    level: number;
    text: string;
}

export type MarkdownLineKind = "empty" | "rule" | "heading" | "bullet" | "quote" | "line";

export interface MarkdownLine {
    kind: MarkdownLineKind;
    level: number; // heading level or blockquote depth; 0 for everything else
    text: string; // plain-text form of the line, bullet marker included
    content: string; // text only, so a renderer can supply its own bullet/quote decoration
}

interface BlockquoteLine {
    level: number;
    text: string;
}

const parseBlockquoteLine = (line: string): BlockquoteLine | null => {
    const length = line.length;
    let index = 0;

    while (index < length && (line[index] === " " || line[index] === "\t")) {
        index++;
    }

    // Allow escaping blockquote markdown with "\>" for literal ">" text.
    if (line[index] === "\\" && line[index + 1] === ">") {
        return null;
    }

    let level = 0;
    while (index < length && line[index] === ">") {
        level++;
        index++;
        while (index < length && (line[index] === " " || line[index] === "\t")) {
            index++;
        }
    }

    if (!level) {
        return null;
    }

    return {
        level,
        text: line.slice(index),
    };
};

const decodeEscapedMarkdown = (value: string): string => {
    return value.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, "$1");
};

export const parseMarkdownHeading = (value: string): MarkdownHeadingMatch | null => {
    const trimmed = (value || "").trim();
    const headingMatch = HEADING_PATTERN.exec(trimmed);
    if (!headingMatch) {
        return null;
    }

    return {
        level: Math.min(6, headingMatch[1].length),
        text: headingMatch[2],
    };
};

const sanitizeHref = (value: string): string | null => {
    const href = value.trim();
    if (!href.length) {
        return null;
    }

    const schemeMatch = href.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (schemeMatch) {
        const scheme = schemeMatch[1].toLowerCase();
        if (scheme !== "http" && scheme !== "https" && scheme !== "mailto" && scheme !== "tel") {
            return null;
        }
        return href;
    }

    if (
        href.startsWith("#")
        || href.startsWith("/")
        || href.startsWith("./")
        || href.startsWith("../")
    ) {
        return href;
    }

    return href;
};

const isEscapedAt = (value: string, index: number): boolean => {
    let slashCount = 0;
    let cursor = index - 1;

    while (cursor >= 0 && value[cursor] === "\\") {
        slashCount++;
        cursor--;
    }

    return slashCount % 2 === 1;
};

const findFirstUnescapedMatch = (value: string, regex: RegExp): RegExpExecArray | null => {
    const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
    const pattern = new RegExp(regex.source, flags);
    let match = pattern.exec(value);

    while (match) {
        if (typeof match.index === "number" && !isEscapedAt(value, match.index)) {
            return match;
        }
        match = pattern.exec(value);
    }

    return null;
};

const findFirstInlineToken = (value: string): InlineTokenMatch | null => {
    const patterns: Array<{ kind: InlineTokenType; regex: RegExp }> = [
        { kind: "link", regex: /\[([^\]\n]+)\]\(([^)\n]+)\)/ },
        { kind: "bold", regex: /\*\*([^*\n]+)\*\*/ },
        { kind: "underline", regex: /__([^_\n]+)__/ },
        { kind: "underline", regex: /\+\+([^+\n]+)\+\+/ }, // legacy support
        { kind: "strikethrough", regex: /~~([^~\n]+)~~/ },
        { kind: "italic", regex: /\*([^*\n]+)\*/ },
    ];

    let best: InlineTokenMatch | null = null;

    patterns.forEach((pattern) => {
        const match = findFirstUnescapedMatch(value, pattern.regex);
        if (!match || typeof match.index !== "number") {
            return;
        }

        const candidate: InlineTokenMatch = {
            kind: pattern.kind,
            index: match.index,
            raw: match[0],
            content: match[1] || "",
            href: pattern.kind === "link" ? (match[2] || "") : undefined,
        };

        if (!best || candidate.index < best.index) {
            best = candidate;
        }
    });

    return best;
};

const renderInlineMarkdown = (value: string, keyPrefix: string): ReactNode[] => {
    if (!value.length) {
        return [""];
    }

    const output: ReactNode[] = [];
    let rest = value;
    let keyIndex = 0;

    while (rest.length) {
        const match = findFirstInlineToken(rest);
        if (!match) {
            output.push(decodeEscapedMarkdown(rest));
            break;
        }

        if (match.index > 0) {
            output.push(decodeEscapedMarkdown(rest.slice(0, match.index)));
        }

        const key = `${keyPrefix}-${keyIndex++}`;

        if (match.kind === "link") {
            const href = sanitizeHref(match.href || "");
            if (href) {
                output.push(
                    <a
                        key={key}
                        className="__md-link"
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {renderInlineMarkdown(match.content, `${key}-label`)}
                    </a>
                );
            } else {
                output.push(decodeEscapedMarkdown(match.raw));
            }
        } else if (match.kind === "bold") {
            output.push(
                <strong key={key}>
                    {renderInlineMarkdown(match.content, `${key}-bold`)}
                </strong>
            );
        } else if (match.kind === "underline") {
            output.push(
                <span key={key} className="__md-underline">
                    {renderInlineMarkdown(match.content, `${key}-underline`)}
                </span>
            );
        } else if (match.kind === "strikethrough") {
            output.push(
                <del key={key}>
                    {renderInlineMarkdown(match.content, `${key}-strikethrough`)}
                </del>
            );
        } else {
            output.push(
                <em key={key}>
                    {renderInlineMarkdown(match.content, `${key}-italic`)}
                </em>
            );
        }

        rest = rest.slice(match.index + match.raw.length);
    }

    return output;
};

export const renderMarkdown = (text: string): ReactNode[] => {
    const normalized = (text || "").replace(/\0/g, "").replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    const blocks: ReactNode[] = [];
    let lineIndex = 0;
    let blockIndex = 0;

    while (lineIndex < lines.length) {
        const line = lines[lineIndex];
        const trimmed = line.trim();

        if (!trimmed.length) {
            blocks.push(
                <div key={`md-empty-${blockIndex++}`} className="__md-empty" aria-hidden="true">
                    {"\u00A0"}
                </div>
            );
            lineIndex++;
            continue;
        }

        if (HORIZONTAL_RULE_PATTERN.test(trimmed)) {
            blocks.push(<hr key={`md-hr-${blockIndex++}`} className="__md-hr" />);
            lineIndex++;
            continue;
        }

        const headingMatch = parseMarkdownHeading(trimmed);
        if (headingMatch) {
            blocks.push(
                <div
                    key={`md-heading-${blockIndex++}`}
                    className={`__md-heading __md-heading--h${headingMatch.level}`}
                >
                    {renderInlineMarkdown(headingMatch.text, `md-heading-inline-${lineIndex}`)}
                </div>
            );
            lineIndex++;
            continue;
        }

        const bulletMatch = BULLET_PATTERN.exec(line);
        if (bulletMatch) {
            const items: ReactNode[] = [];
            let bulletIndex = 0;

            while (lineIndex < lines.length) {
                const bulletLineMatch = BULLET_PATTERN.exec(lines[lineIndex]);
                if (!bulletLineMatch) {
                    break;
                }
                items.push(
                    <li key={`md-list-item-${blockIndex}-${bulletIndex++}`} className="__md-list-item">
                        {renderInlineMarkdown(bulletLineMatch[1], `md-list-inline-${lineIndex}`)}
                    </li>
                );
                lineIndex++;
            }

            blocks.push(
                <ul key={`md-list-${blockIndex++}`} className="__md-list">
                    {items}
                </ul>
            );
            continue;
        }

        const quoteMatch = parseBlockquoteLine(line);
        if (quoteMatch) {
            const quoteLines: ReactNode[] = [];
            let quoteIndex = 0;

            while (lineIndex < lines.length) {
                const quoteLineMatch = parseBlockquoteLine(lines[lineIndex]);
                if (!quoteLineMatch) {
                    break;
                }

                const quoteStyle = {
                    "--md-quote-level": String(Math.max(1, Math.floor(quoteLineMatch.level))),
                } as CSSProperties;

                quoteLines.push(
                    <div
                        key={`md-quote-line-${blockIndex}-${quoteIndex++}`}
                        className="__md-quote-line"
                        style={quoteStyle}
                    >
                        {renderInlineMarkdown(quoteLineMatch.text, `md-quote-inline-${lineIndex}`)}
                    </div>
                );
                lineIndex++;
            }

            blocks.push(
                <blockquote key={`md-quote-${blockIndex++}`} className="__md-blockquote">
                    {quoteLines}
                </blockquote>
            );
            continue;
        }

        blocks.push(
            <div key={`md-line-${blockIndex++}`} className="__md-line">
                {renderInlineMarkdown(line, `md-line-inline-${lineIndex}`)}
            </div>
        );
        lineIndex++;
    }

    return blocks.length ? blocks : [text];
};

const stripInlineMarkdown = (value: string): string => {
    let output = "";
    let rest = value;

    while (rest.length) {
        const match = findFirstInlineToken(rest);
        if (!match) {
            output += decodeEscapedMarkdown(rest);
            break;
        }

        if (match.index > 0) {
            output += decodeEscapedMarkdown(rest.slice(0, match.index));
        }

        output += stripInlineMarkdown(match.content);
        rest = rest.slice(match.index + match.raw.length);
    }

    return output;
};

// a line-by-line view of the source, so the teletype can type plain text while
// still rendering the same blocks renderMarkdown() produces
export const parseMarkdownLines = (text: string): MarkdownLine[] => {
    const normalized = (text || "").replace(/\0/g, "").replace(/\r\n?/g, "\n");

    return normalized.split("\n").map((line): MarkdownLine => {
        const trimmed = line.trim();

        if (!trimmed.length) {
            return { kind: "empty", level: 0, text: "", content: "" };
        }

        if (HORIZONTAL_RULE_PATTERN.test(trimmed)) {
            return {
                kind: "rule",
                level: 0,
                text: HORIZONTAL_RULE_TEXT,
                content: HORIZONTAL_RULE_TEXT,
            };
        }

        const headingMatch = parseMarkdownHeading(trimmed);
        if (headingMatch) {
            const content = stripInlineMarkdown(headingMatch.text);
            return { kind: "heading", level: headingMatch.level, text: content, content };
        }

        const bulletMatch = BULLET_PATTERN.exec(line);
        if (bulletMatch) {
            const content = stripInlineMarkdown(bulletMatch[1]);
            return { kind: "bullet", level: 0, text: `${BULLET_MARKER}${content}`, content };
        }

        const quoteMatch = parseBlockquoteLine(line);
        if (quoteMatch) {
            const content = stripInlineMarkdown(quoteMatch.text);
            return {
                kind: "quote",
                level: Math.max(1, Math.floor(quoteMatch.level)),
                text: content,
                content,
            };
        }

        const content = stripInlineMarkdown(line);
        return { kind: "line", level: 0, text: content, content };
    });
};

export const markdownToPlainText = (text: string): string => {
    return parseMarkdownLines(text).map((line) => line.text).join("\n");
};
