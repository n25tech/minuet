import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { versionOf, stampVersion } from '../scripts/build.js';

// Runs the real js/update.js with a fake page, fetch, clock and timers.
function loadUpdate({ running = 'v1', latest = 'v1', fetchFails = false, popover = true } = {}) {
    const state = { latest, fetches: 0, now: 1_000_000, reloads: 0, body: [], visibility: 'visible' };
    const listeners = {};
    const intervals = [];
    const makeNode = (tag, props, children) => ({
        tag, props, children,
        removed: false,
        popoverShown: false,
        remove() { this.removed = true; state.body = state.body.filter(node => node !== this); },
        ...(popover ? { showPopover() { this.popoverShown = true; } } : {}),
    });
    const sandbox = {
        document: {
            get visibilityState() { return state.visibility; },
            querySelector: selector => (selector === 'meta[name="minuet-version"]' && running ? { content: running } : null),
            addEventListener: (type, fn) => { listeners[type] = fn; },
            body: { append: node => state.body.push(node) },
        },
        location: { reload: () => { state.reloads++; } },
        Date: { now: () => state.now },
        setInterval: (fn, ms) => intervals.push({ fn, ms }),
        fetch: async (url, options) => {
            state.fetches++;
            assert.strictEqual(url, '/version.json');
            assert.strictEqual(options.cache, 'no-store');
            if (fetchFails) throw new Error('offline');
            return { ok: true, json: async () => ({ version: state.latest }) };
        },
        el: (tag, props = {}, ...children) => makeNode(tag, props, children.flat()),
    };
    vm.runInNewContext(readFileSync('js/update.js', 'utf8'), sandbox);
    const settle = () => new Promise(resolve => setImmediate(resolve));
    const notice = () => state.body.find(node => node.props.id === 'update-notice');
    const button = label => notice().children.find(child => child.tag === 'button' && (child.children.includes(label) || child.props['aria-label'] === label));
    return { state, listeners, intervals, settle, notice, button };
}

test('no notice when the deployed version is the one running', async () => {
    const page = loadUpdate({ running: 'v1', latest: 'v1' });
    await page.settle();
    assert.strictEqual(page.state.fetches, 1);
    assert.strictEqual(page.notice(), undefined);
});

test('offers a refresh when a newer version is deployed, and Refresh reloads', async () => {
    const page = loadUpdate({ running: 'v1', latest: 'v2' });
    await page.settle();
    const notice = page.notice();
    assert.ok(notice, 'notice shown');
    assert.strictEqual(notice.props.popover, 'manual');
    assert.ok(notice.popoverShown, 'shown as a popover, above an open note');
    page.button('Refresh').props.onclick();
    assert.strictEqual(page.state.reloads, 1);
});

test('never reloads on its own', async () => {
    const page = loadUpdate({ running: 'v1', latest: 'v2' });
    await page.settle();
    page.state.now += 10 * 60 * 60 * 1000;
    page.listeners.visibilitychange();
    page.intervals[0].fn();
    await page.settle();
    assert.strictEqual(page.state.reloads, 0);
});

test('checks again when the app comes back into view, but not more than once a minute', async () => {
    const page = loadUpdate({ running: 'v1', latest: 'v1' });
    await page.settle();
    page.state.now += 30 * 1000;
    page.listeners.visibilitychange();
    await page.settle();
    assert.strictEqual(page.state.fetches, 1, 'too soon after the last check');

    page.state.latest = 'v2';
    page.state.now += 60 * 1000;
    page.listeners.visibilitychange();
    await page.settle();
    assert.strictEqual(page.state.fetches, 2);
    assert.ok(page.notice());
});

test('does not check while the app is in the background', async () => {
    const page = loadUpdate({ running: 'v1', latest: 'v2' });
    await page.settle();
    page.button('Not now').props.onclick();
    page.state.visibility = 'hidden';
    page.state.now += 60 * 60 * 1000;
    page.listeners.visibilitychange();
    page.intervals[0].fn();
    await page.settle();
    assert.strictEqual(page.state.fetches, 1);
});

test('checks every half hour while open', async () => {
    const page = loadUpdate();
    await page.settle();
    assert.strictEqual(page.intervals.length, 1);
    assert.strictEqual(page.intervals[0].ms, 30 * 60 * 1000);
});

test('"Not now" hides the notice until a later check finds the update again', async () => {
    const page = loadUpdate({ running: 'v1', latest: 'v2' });
    await page.settle();
    page.button('Not now').props.onclick();
    assert.strictEqual(page.notice(), undefined);

    page.listeners.visibilitychange();
    await page.settle();
    assert.strictEqual(page.notice(), undefined, 'not straight back');

    page.state.now += 60 * 1000;
    page.listeners.visibilitychange();
    await page.settle();
    assert.ok(page.notice());
});

test('shows only one notice however many checks find the update', async () => {
    const page = loadUpdate({ running: 'v1', latest: 'v2' });
    await page.settle();
    page.state.now += 60 * 60 * 1000;
    page.listeners.visibilitychange();
    page.intervals[0].fn();
    await page.settle();
    assert.strictEqual(page.state.body.length, 1);
    assert.strictEqual(page.state.fetches, 1, 'no checks while the notice is up');
});

test('offline: no notice and no error', async () => {
    const page = loadUpdate({ running: 'v1', fetchFails: true });
    await page.settle();
    assert.strictEqual(page.notice(), undefined);
});

test('without popover support the notice is still shown', async () => {
    const page = loadUpdate({ running: 'v1', latest: 'v2', popover: false });
    await page.settle();
    assert.ok(page.notice());
});

test('does nothing on a page without a version (served unbuilt)', async () => {
    const page = loadUpdate({ running: null, latest: 'v2' });
    await page.settle();
    assert.strictEqual(page.state.fetches, 0);
    assert.strictEqual(page.intervals.length, 0);
});

test('the version changes with any built file and not with their order', () => {
    const files = [['index.html', '<html>'], ['js/app.js', 'a()']];
    const version = versionOf(files);
    assert.match(version, /^[0-9a-f]{12}$/);
    assert.strictEqual(versionOf([...files].reverse()), version);
    assert.notStrictEqual(versionOf([['index.html', '<html>'], ['js/app.js', 'b()']]), version);
    assert.notStrictEqual(versionOf([['index.html', '<html>'], ['js/app2.js', 'a()']]), version);
});

test('the version is stamped into the page head', () => {
    const html = '<head>\n  <meta charset="UTF-8">\n  <title>Minuet</title>';
    assert.strictEqual(stampVersion(html, 'abc123'),
        '<head>\n  <meta charset="UTF-8">\n  <meta name="minuet-version" content="abc123">\n  <title>Minuet</title>');
    assert.throws(() => stampVersion('<head></head>', 'abc123'), /charset/);
});

test('index.html loads update.js after app.js, which provides el()', () => {
    const html = readFileSync('index.html', 'utf8');
    const app = html.indexOf('src="js/app.js');
    const update = html.indexOf('src="js/update.js');
    assert.ok(app !== -1 && update > app);
});
