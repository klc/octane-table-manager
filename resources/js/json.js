// JSON text helpers that never go through JSON.parse + JSON.stringify for output: that would round
// integers above 2^53 and rewrite numbers like 1.50 or 1e3, and the app that stored the string reads it back.

export function isJson(value) {
    if (typeof value !== 'string' || !/^\s*[[{]/.test(value)) {
        return false;
    }

    try {
        JSON.parse(value);
        return true;
    } catch {
        return false;
    }
}

// Re-indents JSON text by 'indent' spaces, or minifies it with indent 0. Only whitespace outside strings changes.
export function formatJson(text, indent) {
    let out = '';
    let depth = 0;
    let inString = false;
    const newline = () => (indent ? '\n' + ' '.repeat(indent * depth) : '');

    for (let i = 0; i < text.length; i++) {
        const c = text[i];

        if (inString) {
            out += c;
            if (c === '\\') {
                out += text[++i];
            } else if (c === '"') {
                inString = false;
            }
        } else if (c === '"') {
            out += c;
            inString = true;
        } else if (c === '{' || c === '[') {
            const close = c === '{' ? '}' : ']';
            const next = text.slice(i + 1).search(/\S/) + i + 1;
            if (text[next] === close) {
                out += c + close;
                i = next;
            } else {
                depth++;
                out += c + newline();
            }
        } else if (c === '}' || c === ']') {
            depth--;
            out += newline() + c;
        } else if (c === ',') {
            out += c + newline();
        } else if (c === ':') {
            out += indent ? ': ' : ':';
        } else if (!/\s/.test(c)) {
            out += c;
        }
    }

    return out;
}
