/**
 * Just enough JavaScript and JSX lexing to find a call and its closing parenthesis.
 *
 * The plugins need two things from a module's source: where a reporting call
 * starts, and where its argument list ends. A regular expression can find the
 * first but never the second — arguments nest, and a `)` can sit inside a
 * string, a comment, a regular expression, or a nested call. Worse, a regex
 * would happily match a reporting call written inside a comment or a string
 * and corrupt it.
 *
 * So this walks the source once and emits only the tokens that matter,
 * skipping over anything that isn't code. It is not a parser: it does not
 * build a tree, know about scope, or validate syntax. It knows where code is.
 *
 * JSX is handled explicitly rather than tolerated. Without that, `</div>` reads
 * as the start of a regular expression — the `/` follows a `<`, where a value
 * is expected — and everything up to the next `/` is swallowed as its body.
 * Since a component's markup spans many lines, that runs past a newline and
 * aborts the file, which would silently skip every React component in a project.
 */

/** The token kinds the call matcher needs to tell apart. */
export type TokenKind = 'ident' | 'punct' | 'value';

export interface Token {
    kind: TokenKind;
    /** Identifier name, or the punctuation character. Empty for `value`. */
    value: string;
    start: number;
    end: number;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;
/** JSX names admit `.`, `:` and `-`: `<Foo.Bar>`, `<svg:rect>`, `<my-element>`. */
const JSX_NAME_PART = /[\w$.:-]/;
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

/**
 * Keywords after which a value is expected, so a following `/` begins a regular
 * expression and a following `<` begins JSX. `return /re/.test(x)` is a regex
 * and `return <div/>` is JSX; `count / total` and `a < b` are operators, and the
 * only difference is the token before them.
 */
const VALUE_EXPECTED_KEYWORDS = new Set([
    'return',
    'typeof',
    'instanceof',
    'in',
    'of',
    'new',
    'delete',
    'void',
    'throw',
    'case',
    'do',
    'else',
    'yield',
    'await',
]);

/**
 * Whether a value — rather than an operator — is expected at this point.
 *
 * After something that *is* a value (an identifier, a literal, a closing
 * bracket) the next `/` must be division and the next `<` must be a comparison.
 * This is the standard heuristic every fast scanner uses; it needs no parse
 * tree, and the cases it cannot decide are vanishingly rare in real source.
 */
function expectsValue(previous: Token | undefined): boolean {
    if (!previous) return true;
    if (previous.kind === 'value') return false;
    if (previous.kind === 'ident') return VALUE_EXPECTED_KEYWORDS.has(previous.value);

    return previous.value !== ')' && previous.value !== ']';
}

/**
 * Tokenize `code`, dropping whitespace, comments, and the contents of strings,
 * regular expressions, and JSX markup.
 *
 * Template literals and JSX are not opaque: `${…}` and `{…}` hold real code that
 * can contain a reporting call, so those are tokenized while the literal text
 * around them is skipped.
 *
 * Returns `undefined` if the source ends inside a string, comment, template, or
 * JSX element — the file is either not JavaScript or is truncated, and callers
 * must not edit a file this cannot read.
 */
export function tokenize(code: string): Token[] | undefined {
    const tokens: Token[] = [];
    let i = 0;
    let failed = false;

    const previous = (): Token | undefined => tokens[tokens.length - 1];

    const push = (kind: TokenKind, value: string, start: number, end: number): void => {
        tokens.push({ kind, value, start, end });
    };

    /** Abandon the file: something is unterminated and nothing here can be trusted. */
    const fail = (): void => {
        failed = true;
        i = code.length;
    };

    /** Advance past whitespace and comments. Used where JSX allows both. */
    function skipTrivia(): void {
        for (;;) {
            while (i < code.length && WHITESPACE.test(code[i]!)) i++;

            if (code[i] === '/' && code[i + 1] === '/') {
                const end = code.indexOf('\n', i);
                i = end === -1 ? code.length : end + 1;
                continue;
            }
            if (code[i] === '/' && code[i + 1] === '*') {
                const end = code.indexOf('*/', i + 2);
                if (end === -1) return fail();
                i = end + 2;
                continue;
            }
            return;
        }
    }

    /** Consume a quoted string. `allowNewline` is true only for JSX attributes. */
    function readString(allowNewline: boolean): void {
        const quote = code[i]!;
        const start = i;
        i++;

        while (i < code.length) {
            const char = code[i]!;
            if (char === '\\') {
                i += 2;
                continue;
            }
            if (char === quote) {
                i++;
                push('value', '', start, i);
                return;
            }
            // An unescaped newline cannot appear in a JS string; treat it as a
            // lexing failure rather than swallowing the rest of the file looking
            // for a quote that will never come.
            if (char === '\n' && !allowNewline) return fail();
            i++;
        }

        fail();
    }

    /** Consume a template literal, tokenizing each `${…}` as code. */
    function readTemplate(): void {
        const start = i;
        i++; // opening backtick

        while (i < code.length) {
            const char = code[i]!;
            if (char === '\\') {
                i += 2;
                continue;
            }
            if (char === '`') {
                i++;
                push('value', '', start, i);
                return;
            }
            if (char === '$' && code[i + 1] === '{') {
                i += 2;
                lexCode(true);
                if (failed) return;
                if (code[i] !== '}') return fail();
                i++;
                continue;
            }
            i++;
        }

        fail();
    }

    /** Consume a regular expression literal, including flags. */
    function readRegex(): void {
        const start = i;
        i++;

        let inClass = false;
        while (i < code.length) {
            const char = code[i]!;
            if (char === '\\') {
                i += 2;
                continue;
            }
            if (char === '\n') return fail();
            if (char === '[') inClass = true;
            else if (char === ']') inClass = false;
            else if (char === '/' && !inClass) {
                i++;
                while (i < code.length && IDENT_PART.test(code[i]!)) i++;
                push('value', '', start, i);
                return;
            }
            i++;
        }

        fail();
    }

    /**
     * Consume a JSX element from its `<`, returning false if this turns out not
     * to be JSX after all — a TypeScript generic (`<T,>(x) => x`) opens exactly
     * the same way, and only the contents tell them apart. On false, the caller
     * restores its position and treats the `<` as an operator.
     */
    function readJsxElement(): boolean {
        const start = i;
        const tokenMark = tokens.length;

        const abandon = (): boolean => {
            i = start;
            tokens.length = tokenMark;
            return false;
        };

        i++; // '<'
        skipTrivia();
        if (failed) return false;

        // A fragment, `<>…</>`, has no name.
        if (code[i] !== '>') {
            if (!IDENT_START.test(code[i] ?? '')) return abandon();
            while (i < code.length && JSX_NAME_PART.test(code[i]!)) i++;
        }

        // Attributes, until the tag closes.
        for (;;) {
            skipTrivia();
            if (failed) return false;
            if (i >= code.length) return abandon();

            const char = code[i]!;

            if (char === '/' && code[i + 1] === '>') {
                i += 2;
                push('value', '', start, i);
                return true;
            }
            if (char === '>') {
                i++;
                if (!readJsxChildren()) return failed ? false : abandon();
                push('value', '', start, i);
                return true;
            }
            if (char === '{') {
                // A spread attribute: `{...rest}`.
                i++;
                push('punct', '{', i - 1, i);
                lexCode(true);
                if (failed) return false;
                if (code[i] !== '}') return abandon();
                push('punct', '}', i, i + 1);
                i++;
                continue;
            }
            if (IDENT_START.test(char)) {
                while (i < code.length && JSX_NAME_PART.test(code[i]!)) i++;
                skipTrivia();
                if (failed) return false;

                if (code[i] !== '=') continue; // a bare boolean attribute
                i++;
                skipTrivia();
                if (failed) return false;

                const value = code[i];
                if (value === '"' || value === "'") {
                    // JSX attribute strings may span lines.
                    readString(true);
                    if (failed) return false;
                    // The string is markup, not a value in the surrounding
                    // expression; drop it so it cannot affect `expectsValue`.
                    tokens.pop();
                    continue;
                }
                if (value === '{') {
                    i++;
                    push('punct', '{', i - 1, i);
                    lexCode(true);
                    if (failed) return false;
                    if (code[i] !== '}') return abandon();
                    push('punct', '}', i, i + 1);
                    i++;
                    continue;
                }
                return abandon();
            }

            // Anything else — a comma from a generic parameter list, an
            // operator — means this was never a JSX tag.
            return abandon();
        }
    }

    /**
     * Consume element children up to and including the closing tag. Text is
     * skipped wholesale; `{…}` is real code and is tokenized.
     */
    function readJsxChildren(): boolean {
        for (;;) {
            if (i >= code.length) return false;

            const char = code[i]!;

            if (char === '{') {
                i++;
                push('punct', '{', i - 1, i);
                lexCode(true);
                if (failed) return false;
                if (code[i] !== '}') return false;
                push('punct', '}', i, i + 1);
                i++;
                continue;
            }

            if (char === '<') {
                // The closing tag ends this element.
                if (code[i + 1] === '/') {
                    const end = code.indexOf('>', i);
                    if (end === -1) return false;
                    i = end + 1;
                    return true;
                }
                const mark = tokens.length;
                if (!readJsxElement()) {
                    if (failed) return false;
                    // Not a nested element; treat the `<` as text and move on.
                    tokens.length = mark;
                    i++;
                }
                continue;
            }

            i++; // ordinary text
        }
    }

    /**
     * The main loop. When `insideExpression`, it returns on the `}` that closes
     * the template substitution or JSX expression it was entered for, leaving
     * that character for the caller to consume.
     */
    function lexCode(insideExpression: boolean): void {
        let braceDepth = 0;

        while (i < code.length && !failed) {
            const char = code[i]!;

            if (WHITESPACE.test(char)) {
                i++;
                continue;
            }

            if (char === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) {
                skipTrivia();
                continue;
            }

            if (char === "'" || char === '"') {
                readString(false);
                continue;
            }

            if (char === '`') {
                readTemplate();
                continue;
            }

            if (char === '/' && expectsValue(previous())) {
                readRegex();
                continue;
            }

            if (char === '<' && expectsValue(previous())) {
                const next = code[i + 1] ?? '';
                if (next === '>' || IDENT_START.test(next)) {
                    if (readJsxElement()) continue;
                    if (failed) continue;
                }
            }

            if (IDENT_START.test(char)) {
                const start = i;
                while (i < code.length && IDENT_PART.test(code[i]!)) i++;
                push('ident', code.slice(start, i), start, i);
                continue;
            }

            // Numbers, including `1_000`, `0x1f`, `1.5e3`, and `10n`.
            if (DIGIT.test(char) || (char === '.' && DIGIT.test(code[i + 1] ?? ''))) {
                const start = i;
                while (i < code.length && /[\w.]/.test(code[i]!)) {
                    // An exponent sign is part of the number; any other is not.
                    if (/[eE]/.test(code[i]!) && /[+-]/.test(code[i + 1] ?? '')) i++;
                    i++;
                }
                push('value', '', start, i);
                continue;
            }

            if (char === '{') braceDepth++;
            if (char === '}') {
                if (insideExpression && braceDepth === 0) return;
                braceDepth--;
            }

            push('punct', char, i, i + 1);
            i++;
        }

        if (insideExpression) fail();
    }

    lexCode(false);

    return failed ? undefined : tokens;
}
