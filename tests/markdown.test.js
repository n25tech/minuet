import test from 'node:test';
import assert from 'node:assert';
import { markdownToHtml, hasMarkdown, useHighlighter, whenHighlightNeeded } from '../src/markdown/core.js';

const html = text => markdownToHtml(text).trim();

test('plain text keeps its line breaks and paragraphs', () => {
    assert.strictEqual(html('one\ntwo\n\nthree'), '<p>one<br>\ntwo</p>\n<p>three</p>');
    assert.strictEqual(hasMarkdown('just a note\nwith lines'), false);
    assert.strictEqual(hasMarkdown(''), false);
});

test('headings, emphasis, tables and links', () => {
    assert.strictEqual(html('# Title'), '<h1>Title</h1>');
    assert.strictEqual(html('**b** *i* ~~s~~ `c`'), '<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code></p>');
    assert.match(html('| a | b |\n|---|---|\n| 1 | 2 |'), /<table>[\s\S]*<th>a<\/th>[\s\S]*<td>2<\/td>[\s\S]*<\/table>/);
    assert.strictEqual(html('[site](https://example.com)'),
        '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a></p>');
    assert.match(html('see https://example.com.'), /<a href="https:\/\/example.com" target="_blank"/);
    assert.strictEqual(hasMarkdown('some **bold**'), true);
    assert.strictEqual(hasMarkdown('- a list'), true);
});

test('task lines become read-only checkboxes', () => {
    assert.strictEqual(html('- [ ] todo\n- [x] done\n- plain'), [
        '<ul>',
        '<li class="md-task"><input type="checkbox" disabled> todo</li>',
        '<li class="md-task done"><input type="checkbox" disabled checked> done</li>',
        '<li>plain</li>',
        '</ul>',
    ].join('\n'));
    // Only at the start of a list item.
    assert.strictEqual(html('[ ] not a list'), '<p>[ ] not a list</p>');
});

test('HTML and unsafe links stay as text', () => {
    assert.strictEqual(html('<img src=x onerror=alert(1)> <script>x</script>'),
        '<p>&lt;img src=x onerror=alert(1)&gt; &lt;script&gt;x&lt;/script&gt;</p>');
    assert.strictEqual(html('[bad](javascript:alert(1))'), '<p>[bad](javascript:alert(1))</p>');
    assert.doesNotMatch(html('```"><script>\nx\n```'), /<script>/);
});

test('code is plain until highlighting is loaded, then coloured', async () => {
    let asked = 0;
    whenHighlightNeeded(() => { asked += 1; });
    assert.strictEqual(html('```js\nconst a = 1;\n```'), '<pre class="hljs" data-language="js"><code>const a = 1;\n</code></pre>');
    assert.ok(asked > 0, 'the page is told to load highlighting');

    useHighlighter((await import('../src/markdown/highlight.js')).default);
    assert.match(html('```js\nconst a = 1;\n```'), /<span class="hljs-keyword">const<\/span>/);
    assert.match(html('```python\ndef f():\n    return 1\n```'), /<span class="hljs-keyword">def<\/span>/);
    // An unknown language is shown as plain, escaped text.
    assert.strictEqual(html('```nope\n<b>\n```'), '<pre class="hljs" data-language="nope"><code>&lt;b&gt;\n</code></pre>');
});

test('long notes render', () => {
    const long = Array.from({ length: 5000 }, (_, i) => `line ${i} with **bold**`).join('\n');
    assert.ok(html(long).startsWith('<p>line 0 with <strong>bold</strong><br>'));
});
