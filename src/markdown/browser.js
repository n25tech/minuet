/*
 * Browser entry, bundled by scripts/build.js into public/bundles/markdown-<hash>.js. The app's other
 * scripts are plain scripts, so this hands them renderMarkdown() and hasMarkdown() as globals.
 */
import DOMPurify from 'dompurify';
import { markdownToHtml, hasMarkdown, useHighlighter, whenHighlightNeeded } from './core.js';

// Code colouring is loaded the first time a note with code is shown; then everything formatted
// is drawn again ("minuet:markdown-ready").
let highlighterLoading = false;
whenHighlightNeeded(() => {
    if (highlighterLoading) return;
    highlighterLoading = true;
    import('./highlight.js').then(module => {
        useHighlighter(module.default);
        cache.clear();
        document.dispatchEvent(new CustomEvent('minuet:markdown-ready'));
    }, error => {
        console.error('Could not load code highlighting', error);
        highlighterLoading = false;
    });
});

// Every note card is redrawn whenever a note changes, so recent results are kept.
const cache = new Map();
const CACHE_SIZE = 300;

/* The note text, formatted, as a DocumentFragment ready to append. */
function renderMarkdown(text) {
    let template = cache.get(text);
    if (template) {
        cache.delete(text);   // re-added below as the most recently used
    } else {
        template = document.createElement('template');
        // Belt and braces: markdown-it already escapes HTML; this makes sure nothing unsafe gets through.
        // (Content parsed into a <template> is inert.)
        template.innerHTML = DOMPurify.sanitize(markdownToHtml(text), { ADD_ATTR: ['target'] });
        if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
    }
    cache.set(text, template);
    return template.content.cloneNode(true);
}

window.renderMarkdown = renderMarkdown;
window.hasMarkdown = hasMarkdown;
