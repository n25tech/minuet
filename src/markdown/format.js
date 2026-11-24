/*
 * What a toolbar button (or Ctrl+B / I / K) does to the note text, as one edit:
 * replace text[start, end) with `insert`, then select [selStart, selEnd). Pure, so it works the
 * same for the plain text box and the code editor, and can be tested.
 */
const WRAPS = { bold: '**', italic: '*', strike: '~~', code: '`' };
const PREFIXES = { heading: '## ', bullet: '- ', number: '1. ', task: '- [ ] ', quote: '> ' };
const ANY_PREFIX = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;

export function formatEdit(kind, value, start, end) {
    const selected = value.slice(start, end);
    const wrap = WRAPS[kind];
    const prefix = PREFIXES[kind];
    if (wrap) {
        if (kind === 'code' && selected.includes('\n')) {
            const insert = '```\n' + selected + '\n```';
            return { start, end, insert, selStart: start, selEnd: start + insert.length };
        }
        // With nothing selected, the cursor goes between the markers, ready to type.
        return { start, end, insert: wrap + selected + wrap, selStart: start + wrap.length, selEnd: end + wrap.length };
    }
    if (prefix) {
        // Applies to every line the selection touches; applying it again takes it off.
        const lineStart = start ? value.lastIndexOf('\n', start - 1) + 1 : 0;
        const lineEnd = value.indexOf('\n', end) < 0 ? value.length : value.indexOf('\n', end);
        const lines = value.slice(lineStart, lineEnd).split('\n');
        const marker = kind === 'number' ? /^\d+[.)] / : new RegExp('^' + prefix.replace(/[[\]]/g, '\\$&'));
        const remove = lines.every(line => marker.test(line));
        const insert = lines.map((line, index) => {
            if (remove) return line.replace(marker, '');
            return (kind === 'number' ? `${index + 1}. ` : prefix) + line.replace(ANY_PREFIX, '');
        }).join('\n');
        const caret = lineStart + insert.length;
        return { start: lineStart, end: lineEnd, insert, selStart: caret, selEnd: caret };
    }
    if (kind === 'link') {
        const label = selected || 'link text';
        // The address is selected, so it can be pasted over.
        const urlAt = start + label.length + 3;
        return { start, end, insert: `[${label}](https://)`, selStart: urlAt, selEnd: urlAt + 'https://'.length };
    }
    return null;
}
