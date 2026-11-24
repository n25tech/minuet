/*
 * The note text editor: CodeMirror with Markdown, so headings show at their sizes and the
 * formatting marks (#, **, >) are greyed out while typing. Loaded in the background after the page
 * (see loadNoteEditor in src/markdown/browser.js); until it arrives the plain text box is used.
 *
 * createEditor() returns the same small interface the notes page uses for the text box:
 * value, focus(), selection, replace(), plus the element to show and the one that scrolls.
 */
import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, Language, defineLanguageFacet } from '@codemirror/language';
import { parser, GFM } from '@lezer/markdown';
import { tags } from '@lezer/highlight';

const markdownLanguage = new Language(defineLanguageFacet(), parser.configure([GFM]), [], 'markdown');

// Sizes follow the formatted view (assets/css/notebook.css), a little smaller.
const markdownStyle = HighlightStyle.define([
    { tag: tags.heading1, fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
    { tag: tags.heading2, fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3' },
    { tag: tags.heading3, fontSize: '1.2em', fontWeight: '700' },
    { tag: tags.heading4, fontSize: '1.05em', fontWeight: '700' },
    { tag: tags.heading5, fontWeight: '700', letterSpacing: '0.04em' },
    { tag: tags.heading6, fontWeight: '600', color: 'var(--text-muted)' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: 'var(--btn-primary-strong)' },
    { tag: tags.url, color: 'var(--text-muted)' },
    { tag: tags.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.9em' },
    { tag: tags.quote, color: 'var(--text-muted)' },
    // The marks themselves: #, **, -, >, ``` and so on.
    { tag: tags.processingInstruction, color: 'var(--text-muted)', fontWeight: '400' },
    { tag: tags.contentSeparator, color: 'var(--text-muted)' },
]);

const theme = EditorView.theme({
    '&': { color: 'inherit', backgroundColor: 'transparent', fontSize: 'inherit' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.45' },
    '.cm-content': { padding: '0.15rem 0', caretColor: 'var(--text-main)' },
    '.cm-line': { padding: '0' },
    '.cm-placeholder': { color: 'var(--text-muted)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--bg-selected)' },
    '.cm-cursor': { borderLeftColor: 'var(--text-main)' },
});

/*
 * parent: element to mount in. onChange(text) after each edit; onShortcut(kind) for Ctrl+B / I / K.
 */
export function createEditor(parent, { placeholder = '', onChange, onShortcut }) {
    const shortcut = kind => () => { onShortcut(kind); return true; };
    const extensions = [
        history(),
        keymap.of([
            { key: 'Mod-b', run: shortcut('bold') },
            { key: 'Mod-i', run: shortcut('italic') },
            { key: 'Mod-k', run: shortcut('link') },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
        ]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Note', spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
        markdownLanguage,
        syntaxHighlighting(markdownStyle),
        placeholderText(placeholder),
        theme,
        EditorView.updateListener.of(update => { if (update.docChanged) onChange(update.state.doc.toString()); }),
    ];
    const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) });

    return {
        element: parent,
        scroller: view.scrollDOM,
        get value() {
            return view.state.doc.toString();
        },
        // A new note (or one changed elsewhere): a fresh state, so undo doesn't reach into another note.
        set value(text) {
            view.setState(EditorState.create({ doc: text, extensions }));
        },
        get selection() {
            const { from, to } = view.state.selection.main;
            return [from, to];
        },
        replace(start, end, insert, selStart, selEnd) {
            view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: selStart, head: selEnd }, scrollIntoView: true });
        },
        focus() {
            view.focus();
        },
    };
}
