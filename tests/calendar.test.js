import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Runs the real browser scripts' pure logic (calendar-core.js, and mergeById from sync.js) in a sandbox.
const source = file => readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const sandbox = { window: { APP_CONFIG: { BACKEND_API_URL: '' } } };
vm.createContext(sandbox);
vm.runInContext(source('calendar-core.js') + source('sync.js')
    + '\nglobalThis.api = { expandEvents, layoutDay, parseLocal, toLocalISO, toYMD, mergeById };', sandbox);
const { expandEvents, layoutDay, parseLocal, toLocalISO, mergeById } = sandbox.api;

// Occurrences of one event in [from, to), as "start>end" strings.
const occurrences = (event, from, to) => Array.from(expandEvents([{ id: 'e', ...event }], parseLocal(from), parseLocal(to)),
    o => `${toLocalISO(o.start)}>${toLocalISO(o.end)}`);
const starts = (event, from, to) => Array.from(expandEvents([{ id: 'e', ...event }], parseLocal(from), parseLocal(to)), o => o.key);
const plain = value => JSON.parse(JSON.stringify(value));

test('A single timed event appears only in ranges it overlaps', () => {
    const event = { start: '2026-11-17T15:00', end: '2026-11-17T16:00' };
    assert.deepStrictEqual(occurrences(event, '2026-11-17', '2026-11-18'), ['2026-11-17T15:00>2026-11-17T16:00']);
    assert.deepStrictEqual(occurrences(event, '2026-11-18', '2026-11-19'), []);
    assert.deepStrictEqual(occurrences(event, '2026-11-17T16:00', '2026-11-18'), []);
});

test('An all-day event covers its last day and ends at the following midnight', () => {
    const event = { allDay: true, start: '2026-11-17', end: '2026-11-18' };
    assert.deepStrictEqual(occurrences(event, '2026-11-18', '2026-11-19'), ['2026-11-17T00:00>2026-11-19T00:00']);
    assert.deepStrictEqual(occurrences(event, '2026-11-19', '2026-11-20'), []);
});

test('Daily, weekly, monthly and yearly events repeat on the right dates', () => {
    const at = { start: '2026-01-05T09:00', end: '2026-01-05T10:00' };
    assert.deepStrictEqual(starts({ ...at, repeat: { freq: 'daily' } }, '2026-03-01', '2026-03-04'), ['2026-03-01', '2026-03-02', '2026-03-03']);
    assert.deepStrictEqual(starts({ ...at, repeat: { freq: 'weekly' } }, '2026-11-01', '2026-11-30'), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
    assert.deepStrictEqual(starts({ ...at, repeat: { freq: 'monthly' } }, '2027-01-01', '2027-04-01'), ['2027-01-05', '2027-02-05', '2027-03-05']);
    assert.deepStrictEqual(starts({ ...at, repeat: { freq: 'yearly' } }, '2030-01-01', '2033-01-01'), ['2030-01-05', '2031-01-05', '2032-01-05']);
    // Nothing before the first occurrence.
    assert.deepStrictEqual(starts({ ...at, repeat: { freq: 'daily' } }, '2026-01-01', '2026-01-07'), ['2026-01-05', '2026-01-06']);
});

test('Monthly on the 31st skips shorter months; yearly on 29 Feb skips non-leap years', () => {
    const monthly = { allDay: true, start: '2026-01-31', end: '2026-01-31', repeat: { freq: 'monthly' } };
    assert.deepStrictEqual(starts(monthly, '2026-01-01', '2026-06-01'), ['2026-01-31', '2026-03-31', '2026-05-31']);
    const yearly = { allDay: true, start: '2024-02-29', end: '2024-02-29', repeat: { freq: 'yearly' } };
    assert.deepStrictEqual(starts(yearly, '2025-01-01', '2029-01-01'), ['2028-02-29']);
});

test('"Until" is inclusive and removed occurrences (exdates) are skipped', () => {
    const event = { start: '2026-11-16T09:00', end: '2026-11-16T09:30', repeat: { freq: 'daily', until: '2026-11-19' }, exdates: ['2026-11-18'] };
    assert.deepStrictEqual(starts(event, '2026-11-01', '2026-12-01'), ['2026-11-16', '2026-11-17', '2026-11-19']);
});

test('A repeating event that runs past midnight is found from the day it ends on', () => {
    const event = { start: '2026-11-16T23:00', end: '2026-11-17T01:00', repeat: { freq: 'daily' } };
    assert.deepStrictEqual(occurrences(event, '2026-11-20', '2026-11-21'),
        ['2026-11-19T23:00>2026-11-20T01:00', '2026-11-20T23:00>2026-11-21T01:00']);
});

test('Far-future ranges of an old repeating event are still found', () => {
    const event = { start: '2000-01-01T09:00', end: '2000-01-01T10:00', repeat: { freq: 'daily' } };
    assert.deepStrictEqual(starts(event, '2026-11-16', '2026-11-18'), ['2026-11-16', '2026-11-17']);
    const monthly = { ...event, repeat: { freq: 'monthly' } };
    assert.deepStrictEqual(starts(monthly, '2026-11-01', '2026-12-01'), ['2026-11-01']);
});

test('Overlapping events share the width; separate ones keep the full width', () => {
    const laid = plain(layoutDay([
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 570, endMin: 630 },
        { id: 'c', startMin: 600, endMin: 660 },
        { id: 'd', startMin: 720, endMin: 780 },
    ]));
    const byId = Object.fromEntries(laid.map(s => [s.id, [s.col, s.cols]]));
    assert.deepStrictEqual(byId, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
});

test('mergeById keeps additions and edits from both devices and applies deletions', () => {
    const base = [{ id: 'keep', v: 1 }, { id: 'mineEdit', v: 1 }, { id: 'theirEdit', v: 1 }, { id: 'mineDel', v: 1 }, { id: 'theirDel', v: 1 }];
    const mine = [{ id: 'keep', v: 1 }, { id: 'mineEdit', v: 2, updatedAt: 5 }, { id: 'theirEdit', v: 1 }, { id: 'theirDel', v: 1 }, { id: 'mineNew', v: 1 }];
    const theirs = [{ id: 'keep', v: 1 }, { id: 'mineEdit', v: 1 }, { id: 'theirEdit', v: 3, updatedAt: 6 }, { id: 'mineDel', v: 1 }, { id: 'theirNew', v: 1 }];
    assert.deepStrictEqual(plain(mergeById(base, mine, theirs)), [
        { id: 'keep', v: 1 },
        { id: 'mineEdit', v: 2, updatedAt: 5 },
        { id: 'theirEdit', v: 3, updatedAt: 6 },
        { id: 'theirNew', v: 1 },
        { id: 'mineNew', v: 1 },
    ]);
});

test('mergeById: the newer edit wins when both devices edit, and an edit beats a deletion', () => {
    const base = [{ id: 'both', v: 1, updatedAt: 1 }, { id: 'editedHere', v: 1 }, { id: 'editedThere', v: 1 }];
    const mine = [{ id: 'both', v: 'mine', updatedAt: 10 }, { id: 'editedHere', v: 2, updatedAt: 3 }];
    const theirs = [{ id: 'both', v: 'theirs', updatedAt: 20 }, { id: 'editedThere', v: 2, updatedAt: 3 }];
    assert.deepStrictEqual(plain(mergeById(base, mine, theirs)), [
        { id: 'both', v: 'theirs', updatedAt: 20 },
        { id: 'editedThere', v: 2, updatedAt: 3 },
        { id: 'editedHere', v: 2, updatedAt: 3 },
    ]);
});

test('mergeById: a checklist edited on both devices is merged item by item', () => {
    const todo = items => ({ id: 'pomodoro-todo', title: 'To-do list', items });
    const base = [todo([{ id: '1', text: 'a', done: false }, { id: '2', text: 'b', done: false }])];
    const mine = [{ ...todo([{ id: '1', text: 'a', done: true }, { id: '2', text: 'b', done: false }, { id: '3', text: 'mine', done: false }]), updatedAt: 10 }];
    const theirs = [{ ...todo([{ id: '1', text: 'a', done: false }, { id: '4', text: 'theirs', done: false }]), updatedAt: 20 }];
    assert.deepStrictEqual(plain(mergeById(base, mine, theirs)), [{
        id: 'pomodoro-todo', title: 'To-do list', updatedAt: 20,
        items: [{ id: '1', text: 'a', done: true }, { id: '4', text: 'theirs', done: false }, { id: '3', text: 'mine', done: false }],
    }]);
});

test('mergeById: text changed on both devices keeps both versions; changed on one keeps that one', () => {
    const base = [{ id: 'd', text: 'start', color: 'default' }];
    const both = mergeById(base, [{ id: 'd', text: 'start mine', color: 'default', updatedAt: 30 }], [{ id: 'd', text: 'start theirs', color: 'default', updatedAt: 20 }]);
    assert.strictEqual(both[0].text, 'start mine\n\n--- From another device ---\nstart theirs');
    // The other device only changed the colour (more recently): its colour and our text both survive.
    const one = mergeById(base, [{ id: 'd', text: 'typed here', color: 'default', updatedAt: 10 }], [{ id: 'd', text: 'start', color: 'red', updatedAt: 20 }]);
    assert.deepStrictEqual(plain(one), [{ id: 'd', text: 'typed here', color: 'red', updatedAt: 20 }]);
});
