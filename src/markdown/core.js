/*
 * Note text to HTML, with markdown-it (CommonMark plus tables, strikethrough and links found in
 * plain text), "- [ ]" task lines, and code blocks coloured by highlight.js (see highlight.js).
 *
 * No browser APIs here, so the tests can run it in Node. Raw HTML typed into a note is shown as
 * text (html: false) and markdown-it refuses javascript:/vbscript:/file:/data: links; the browser
 * entry (browser.js) still passes the result through DOMPurify before it reaches the page.
 */
import MarkdownIt from 'markdown-it';

// Guessing the language of an unlabelled block is slow on big ones, so only small blocks are guessed.
const MAX_GUESS_LENGTH = 4000;

// highlight.js, once it has been loaded (useHighlighter); until then code shows uncoloured and
// onHighlightNeeded is told, so the page can load it and redraw.
let hljs = null;
let onHighlightNeeded = null;

export function useHighlighter(highlighter) {
    hljs = highlighter;
}

export function whenHighlightNeeded(callback) {
    onHighlightNeeded = callback;
}

function highlight(code, info) {
    const language = (info || '').trim().split(/\s+/)[0].toLowerCase();
    if (!hljs) {
        if (onHighlightNeeded) onHighlightNeeded();
        return '';
    }
    try {
        if (language && hljs.getLanguage(language)) {
            return hljs.highlight(code, { language, ignoreIllegals: true }).value;
        }
        if (!language && code.length <= MAX_GUESS_LENGTH) {
            const guess = hljs.highlightAuto(code);
            if (guess.relevance >= 5) return guess.value;
        }
    } catch { /* fall back to plain text */ }
    return '';   // markdown-it escapes it as plain text
}

const md = new MarkdownIt({
    html: false,       // HTML in a note stays text
    linkify: true,     // https://... and www... become links
    breaks: true,      // people type notes line by line, so single line breaks are kept
    highlight,
});

// The code's language as a class on <pre>, so the block can be labelled and styled.
md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0];
    const body = highlight(token.content, language) || md.utils.escapeHtml(token.content);
    const label = language ? ` data-language="${md.utils.escapeHtml(language)}"` : '';
    return `<pre class="hljs"${label}><code>${body}</code></pre>\n`;
};

md.renderer.rules.code_block = (tokens, index) => {
    const content = tokens[index].content;
    return `<pre class="hljs"><code>${highlight(content, '') || md.utils.escapeHtml(content)}</code></pre>\n`;
};

// Links open in a new tab, without giving that page a handle on this one.
const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, index, options, env, self);
};

// "- [ ] text" and "- [x] text" become (read-only) checkboxes.
const TASK = /^\[([ xX])\][  ]/;
md.core.ruler.after('inline', 'task_lists', state => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
        const inline = tokens[i];
        if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
        const first = inline.children[0];
        const match = first && first.type === 'text' && TASK.exec(first.content);
        if (!match) continue;
        const done = match[1] !== ' ';
        first.content = first.content.slice(match[0].length);
        const box = new state.Token('task_checkbox', 'input', 0);
        box.meta = { done };
        inline.children.unshift(box);
        tokens[i - 2].attrJoin('class', done ? 'md-task done' : 'md-task');
    }
});
md.renderer.rules.task_checkbox = (tokens, index) =>
    `<input type="checkbox" disabled${tokens[index].meta.done ? ' checked' : ''}> `;

export function markdownToHtml(text) {
    return md.render(String(text || ''));
}

/* Whether the text uses any formatting, so plain notes can open ready for typing rather than formatted. */
export function hasMarkdown(text) {
    const PLAIN_BLOCKS = new Set(['paragraph_open', 'paragraph_close', 'inline']);
    const PLAIN_INLINE = new Set(['text', 'softbreak', 'hardbreak']);
    return md.parse(String(text || ''), {}).some(token =>
        !PLAIN_BLOCKS.has(token.type) || (token.children || []).some(child => !PLAIN_INLINE.has(child.type)));
}
