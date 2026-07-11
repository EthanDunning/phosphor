import React, { Component, CSSProperties, ReactElement, ReactNode } from "react";
import { MarkdownLine, markdownToPlainText, parseMarkdownHeading, parseMarkdownLines } from "../../utils/markdown";

// css
import "./style.scss";

interface TeletypeProps {
    text: string; // text to animate
    className?: string; // css class
    markdown?: boolean; // treat text as markdown and type into rendered blocks? default = false
    headingLevel?: number; // optional markdown heading level for styled typing
    autostart?: boolean; // start animating immediately? default = true
    autocomplete?: boolean; // skip animating and instead fully render? default = false
    speed?: number; // optional animation speed in ms; default = 20

    onComplete: () => void; // event called on completion
    onNewLine?: () => void; // event called when the cursor is moved to a new line
    onCharDrawn?: (char: string, index: number) => void; // event called when a new char is drawn
}

interface TeletypeState {
    index: number;
    char: number;
    active: boolean;
    done: boolean;
    paused: boolean;
}

// a markdown line plus its span in the typed text; end is exclusive and excludes
// the newline that follows the line
interface TypedLine extends MarkdownLine {
    start: number;
    end: number;
}

class Teletype extends Component<TeletypeProps, TeletypeState> {
    private _cursorInterval = 15;
    private _charsPerTick = 1;
    private _animateTimerId: number = null;
    private _completeTimerId: number = null;
    private _completionScheduled = false;
    private _cursorRef: React.RefObject<HTMLElement> = null;
    private _cursorY: number = null;
    private _markdownSource: string = null;
    private _markdownLines: TypedLine[] = null;
    private _markdownText: string = null;

    constructor(props: TeletypeProps) {
        super(props);

        this._cursorRef = React.createRef<HTMLElement>();
        this._cursorY = 0;

        const done = !!props.autocomplete;
        const paused = props.autostart === false;

        const configuredSpeed = typeof props.speed === "number" && Number.isFinite(props.speed)
            ? props.speed
            : null;

        if (configuredSpeed && configuredSpeed > 0) {
            if (configuredSpeed < 1) {
                // Browsers clamp very small timers; draw multiple chars per tick for true fast-forward.
                this._cursorInterval = 1;
                this._charsPerTick = Math.max(1, Math.ceil(1 / configuredSpeed));
            } else {
                this._cursorInterval = configuredSpeed;
            }
        }

        this.state = {
            index: 0,
            char: 0,
            active: false,
            done,
            paused,
        };

        this._animate = this._animate.bind(this);
        this._updateState = this._updateState.bind(this);
    }

    public render(): ReactElement {
        const { className } = this.props;
        const { char, done, active, } = this.state;

        if (!active || done) {
            return null;
        }

        const css = ["__teletype__", className ? className : null].join(" ").trim();
        const lines = this._getMarkdownLines();

        // markdown text types into the same blocks the finished text renders as,
        // so bullets, headings and quotes don't jump around on the last character
        if (lines) {
            return <div className={css}>{this._renderMarkdownBlocks(lines, char)}</div>;
        }

        const text = this._getDisplayText();
        const content = this._renderTypedLine(text, 0, text.length, char);
        const headingLevel = this._getHeadingLevel();

        if (headingLevel) {
            return (
                <div className={css}>
                    <div className={`__md-heading __md-heading--h${headingLevel}`}>
                        {content}
                    </div>
                </div>
            );
        }

        return <div className={css}>{content}</div>;
    }

    public componentDidMount(): void {
        const { paused, done } = this.state;

        // if autocomplete is on, we can skip to the end
        if (done) {
            this._scheduleComplete();
            return;
        }

        // ready to go
        if (!paused) {
            this.setState({
                active: true,
            }, () => this._animate());
        }
    }

    public componentDidUpdate(prevProps: TeletypeProps, prevState: TeletypeState): void {
        if (!prevState.done && this.state.done) {
            this._scheduleComplete();
        }

        if (!prevProps.autocomplete && this.props.autocomplete && !this.state.done) {
            this._clearAnimateTimer();
            this.setState({
                char: this._getDisplayText().length,
                active: false,
                done: true,
                paused: false,
            });
            return;
        }


        if (this.state.done) {
            return;
        }

        this._animate();
    }

    public componentWillUnmount(): void {
        this._clearAnimateTimer();
        this._clearCompleteTimer();
    }

    private _animate(): void {
        this._clearAnimateTimer();

        if (this.state.paused) {
            return;
        }

        // track the current active line
        this._getCursorPosition();

        // setTimeout is preferred over requestAnimationFrame so the interval
        // can be specified -- we can control how janky it looked; requestAnimationFrame
        // results in animation that's much to smooth for our purposes.
        this._animateTimerId = window.setTimeout(this._updateState, this._cursorInterval);
    }

    private _getCursorPosition(): void {
        const { onNewLine } = this.props;
        // get the cursorRef
        const ref = this._cursorRef;
        let y = this._cursorY;

        if (ref && ref.current) {
            const node = ref.current;
            const top = node.offsetTop;
            if (y !== top) {
                // new line
                this._cursorY = top;
                onNewLine && onNewLine();
            }
        }
    }

    private _clearAnimateTimer(): void {
        if (this._animateTimerId !== null) {
            window.clearTimeout(this._animateTimerId);
            this._animateTimerId = null;
        }
    }

    private _scheduleComplete(): void {
        if (this._completionScheduled) {
            return;
        }

        this._completionScheduled = true;
        this._completeTimerId = window.setTimeout(() => {
            this._completionScheduled = false;
            this._completeTimerId = null;
            this._onComplete();
        }, 0);
    }

    private _clearCompleteTimer(): void {
        if (this._completeTimerId !== null) {
            window.clearTimeout(this._completeTimerId);
            this._completeTimerId = null;
        }

        this._completionScheduled = false;
    }

    private _updateState(): void {
        const { onCharDrawn, } = this.props;
        const text = this._getDisplayText();
        const {
            char,
            active,
            done,
            paused,
        } = this.state;

        if (done) {
            return;
        }

        // let nextIndex = index;
        let nextChar = char;
        let nextActive = active;
        let nextDone = done;
        let nextPaused = paused;

        // if we're not active, we are now!
        if (!nextActive) {
            nextActive = true;
        }

        // if char is less that the current string, increment it
        if (char < text.length) {
            const count = Math.max(1, this._charsPerTick);
            let drawn = 0;

            while (nextChar < text.length && drawn < count) {
                onCharDrawn && onCharDrawn(text.charAt(nextChar), nextChar);
                nextChar++;
                drawn++;
            }

            if (nextChar >= text.length) {
                nextActive = false;
                nextDone = true;
            }
        } else {
            nextActive = false;
            nextDone = true;
        }

        // update state
        this.setState({
            // index: nextIndex,
            char: nextChar,
            active: nextActive,
            done: nextDone,
            paused: nextPaused,
        });
    }

    // parse (and cache) the markdown source into lines, each holding the range of
    // the typed text it covers
    private _getMarkdownLines(): TypedLine[] | null {
        if (!this.props.markdown) {
            return null;
        }

        const source = this.props.text || "";

        if (this._markdownSource !== source) {
            let offset = 0;

            this._markdownSource = source;
            this._markdownLines = parseMarkdownLines(source).map((line) => {
                const start = offset;
                const end = start + line.content.length;
                offset = end + 1; // the newline between lines is typed but never drawn
                return { ...line, start, end };
            });
            this._markdownText = this._markdownLines.map((line) => line.content).join("\n");
        }

        return this._markdownLines;
    }

    private _renderMarkdownBlocks(lines: TypedLine[], char: number): ReactNode[] {
        const blocks: ReactNode[] = [];
        let index = 0;

        while (index < lines.length) {
            const line = lines[index];
            const blockKey = `tt-block-${blocks.length}`;

            if (line.kind === "bullet") {
                const items: ReactNode[] = [];

                while (index < lines.length && lines[index].kind === "bullet") {
                    const item = lines[index];
                    items.push(
                        <li key={`tt-item-${index}`} className={this._getLineClassName("__md-list-item", item, char)}>
                            {this._renderTypedLine(item.content, item.start, item.end, char)}
                        </li>
                    );
                    index++;
                }

                blocks.push(<ul key={blockKey} className="__md-list">{items}</ul>);
                continue;
            }

            if (line.kind === "quote") {
                const quoteLines: ReactNode[] = [];

                while (index < lines.length && lines[index].kind === "quote") {
                    const quote = lines[index];
                    const quoteStyle = {
                        "--md-quote-level": String(quote.level),
                    } as CSSProperties;

                    quoteLines.push(
                        <div
                            key={`tt-quote-${index}`}
                            className={this._getLineClassName("__md-quote-line", quote, char)}
                            style={quoteStyle}
                        >
                            {this._renderTypedLine(quote.content, quote.start, quote.end, char)}
                        </div>
                    );
                    index++;
                }

                blocks.push(<blockquote key={blockKey} className="__md-blockquote">{quoteLines}</blockquote>);
                continue;
            }

            if (line.kind === "empty") {
                // the placeholder keeps the blank line at full height before and after it is typed
                blocks.push(
                    <div key={blockKey} className="__md-empty" aria-hidden="true">
                        {this._renderTypedLine(line.content, line.start, line.end, char, "\u00A0")}
                    </div>
                );
                index++;
                continue;
            }

            if (line.kind === "heading") {
                blocks.push(
                    <div key={blockKey} className={`__md-heading __md-heading--h${line.level}`}>
                        {this._renderTypedLine(line.content, line.start, line.end, char)}
                    </div>
                );
                index++;
                continue;
            }

            blocks.push(
                <div key={blockKey} className="__md-line">
                    {this._renderTypedLine(line.content, line.start, line.end, char)}
                </div>
            );
            index++;
        }

        return blocks;
    }

    // lines that haven't been reached are hidden rather than empty, so their
    // decoration (bullet marker, quote bar) doesn't show up ahead of the cursor
    private _getLineClassName(className: string, line: TypedLine, char: number): string {
        return char < line.start ? `${className} hidden` : className;
    }

    private _renderTypedLine(text: string, start: number, end: number, char: number, placeholder = ""): ReactNode {
        if (char > end) {
            return <span className="visible">{text.length ? text : placeholder}</span>;
        }

        if (char < start) {
            return <span className="hidden">{text.length ? text : placeholder}</span>;
        }

        const offset = char - start;
        const visible = text.substr(0, offset); // already rendered
        const cursor = text.substr(offset, 1) || " "; // " " ensures the curosr is briefly visible for line breaks
        const hidden = text.substr(offset + 1); // to be rendered

        return (
            <>
                <span className="visible">{visible}</span>
                <span className="cursor" ref={this._cursorRef}>{cursor}</span>
                <span className="hidden">{hidden}</span>
            </>
        );
    }

    private _getHeadingLevel(): number | null {
        if (typeof this.props.headingLevel === "number" && Number.isFinite(this.props.headingLevel)) {
            return Math.min(6, Math.max(1, Math.floor(this.props.headingLevel)));
        }

        if (this.props.text.includes("\n")) {
            return null;
        }

        const heading = parseMarkdownHeading(this.props.text);
        return heading ? heading.level : null;
    }

    private _getDisplayText(): string {
        // in markdown mode the blocks carry the formatting, so only the text is typed
        if (this._getMarkdownLines()) {
            return this._markdownText;
        }

        if (typeof this.props.headingLevel === "number" && Number.isFinite(this.props.headingLevel)) {
            return this.props.text;
        }

        const headingLevel = this._getHeadingLevel();
        if (headingLevel) {
            return markdownToPlainText(this.props.text);
        }

        return this.props.text;
    }

    private _onComplete(): void {
        const { onComplete, } = this.props;
        onComplete && onComplete();
    }
}

export default Teletype;
