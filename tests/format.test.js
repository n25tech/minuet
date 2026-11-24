import test from 'node:test';
import assert from 'node:assert';
import { formatEdit } from '../src/markdown/format.js';

// Applies an edit and shows the selection as [ ]: "a [b] c".
function apply(kind, marked) {
    const start = marked.indexOf('['), end = marked.indexOf(']') - 1;
    const value = marked.replace('[', '').replace(']', '');
    const edit = formatEdit(kind, value, start, end);
    const text = value.slice(0, edit.start) + edit.insert + value.slice(edit.end);
    return text.slice(0, edit.selStart) + '[' + text.slice(edit.selStart, edit.selEnd) + ']' + text.slice(edit.selEnd);
}

test('wrapping a selection, or leaving the cursor between the markers', () => {
    assert.strictEqual(apply('bold', 'say [hello] now'), 'say **[hello]** now');
    assert.strictEqual(apply('italic', 'say [] now'), 'say *[]* now');
    assert.strictEqual(apply('strike', '[x]'), '~~[x]~~');
    assert.strictEqual(apply('code', 'run [ls]'), 'run `[ls]`');
    assert.strictEqual(apply('code', '[a\nb]'), '[```\na\nb\n```]');
});

test('line prefixes apply to every selected line, and come off again', () => {
    assert.strictEqual(apply('heading', 'ti[]tle'), '## title[]');
    assert.strictEqual(apply('heading', '## ti[]tle'), 'title[]');
    assert.strictEqual(apply('bullet', '[one\ntwo]'), '- one\n- two[]');
    assert.strictEqual(apply('number', '[one\n- two]'), '1. one\n2. two[]');
    assert.strictEqual(apply('task', 'x\n[buy milk]'), 'x\n- [ ] buy milk[]');
    assert.strictEqual(apply('quote', '# [Title]'), '> Title[]');
});

test('links select the address to paste over', () => {
    assert.strictEqual(apply('link', 'see [docs]'), 'see [docs]([https://])');
    assert.strictEqual(apply('link', '[]'), '[link text]([https://])');
    assert.strictEqual(formatEdit('nope', 'x', 0, 0), null);
});
