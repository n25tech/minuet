import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Runs the real js/markdown.js (a plain browser script) in a sandbox.
const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../js/markdown.js', import.meta.url), 'utf8'), context);
const { parseMarkdown, hasMarkdown } = context.module.exports;

// The parse tree as compact HTML-ish text, to compare against.
function html(nodes) {
    return nodes.map(node => {
        if (typeof node === 'string') return node.replace(/</g, '&lt;');
        const attrs = Object.entries(node.attrs || {}).map(([key, value]) => ` ${key}="${value}"`).join('');
        if (node.tag === 'br' || node.tag === 'hr' || node.tag === 'input') return `<${node.tag}${attrs}>`;
        return `<${node.tag}${attrs}>${html(node.children)}</${node.tag}>`;
    }).join('');
}
const md = text => html(parseMarkdown(text));

test('plain text keeps its line breaks and paragraphs', () => {
    assert.strictEqual(md('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>');
    assert.strictEqual(hasMarkdown('just a note\nwith lines'), false);
});

test('headings, emphasis, code and strikethrough', () => {
    assert.strictEqual(md('# Title\n## Sub'), '<h1>Title</h1><h2>Sub</h2>');
    assert.strictEqual(md('**bold** *it* _it_ ~~gone~~ `x*y`'), '<p><strong>bold</strong> <em>it</em> <em>it</em> <del>gone</del> <code>x*y</code></p>');
    assert.strictEqual(md('snake_case_name and 2 * 3 * 4'), '<p>snake_case_name and 2 * 3 * 4</p>');
    assert.strictEqual(hasMarkdown('some **bold**'), true);
});

test('lists, nesting, numbering and task lines', () => {
    assert.strictEqual(md('- a\n- b\n  - c\n- d'), '<ul><li>a</li><li>b<ul><li>c</li></ul></li><li>d</li></ul>');
    assert.strictEqual(md('3. x\n4. y'), '<ol start="3"><li>x</li><li>y</li></ol>');
    assert.strictEqual(md('- [ ] todo\n- [x] done'),
        '<ul><li class="md-task"><input type="checkbox" checked="false" disabled="true">todo</li>'
        + '<li class="md-task done"><input type="checkbox" checked="true" disabled="true">done</li></ul>');
    assert.strictEqual(md('intro\n- item'), '<p>intro</p><ul><li>item</li></ul>');
});

test('quotes, rules and code blocks', () => {
    assert.strictEqual(md('> quoted\n> **more**'), '<blockquote><p>quoted<br><strong>more</strong></p></blockquote>');
    assert.strictEqual(md('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>');
    assert.strictEqual(md('```\n# not a heading\n**raw**\n```'), '<pre><code># not a heading\n**raw**</code></pre>');
});

test('links are limited to safe addresses and markup is never interpreted', () => {
    assert.strictEqual(md('[site](https://example.com)'), '<p><a href="https://example.com">site</a></p>');
    assert.strictEqual(md('see https://example.com/a.'), '<p>see <a href="https://example.com/a">https://example.com/a</a>.</p>');
    assert.strictEqual(md('[bad](javascript:alert(1))'), '<p>[bad](javascript:alert(1))</p>');
    // HTML in a note stays text: the tree only ever holds strings and the renderer's own tags.
    const tree = parseMarkdown('<img src=x onerror=alert(1)> <script>x</script>');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(tree)), [{ tag: 'p', children: ['<img src=x onerror=alert(1)> <script>x</script>'] }]);
});

test('backslash escapes and long notes', () => {
    assert.strictEqual(md('\\*not italic\\*'), '<p>*not italic*</p>');
    const long = Array.from({ length: 5000 }, (_, i) => `line ${i} with **bold**`).join('\n');
    assert.strictEqual(parseMarkdown(long).length, 1);
});
