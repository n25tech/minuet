import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Runs the real tasks-core.js and todolist.js against an in-memory notebook and stub elements.
const source = file => readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');

function element(id) {
    return {
        id, hidden: false, value: '', checked: false, children: [], listeners: {}, classList: { add() {} },
        set innerHTML(_) { this.children = []; },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        appendChild(child) { this.children.push(child); },
        replaceChildren(...children) { this.children = children; },
    };
}

function load(notes, saved = {}) {
    const local = new Map(Object.entries(saved));
    const elements = Object.fromEntries(['pomodoro-task', 'pomodoro-list', 'todolist-table-container', 'new-item-input',
        'new-item-date', 'new-item-time', 'new-item-calendar', 'new-item-repeat', 'new-item-status', 'new-item-when', 'todo-form']
        .map(id => [id, element(id)]));
    const store = {
        items: notes,
        get(id) { return this.items.find(note => note.id === id); },
        upsert(...changed) {
            for (const note of changed) {
                const index = this.items.findIndex(other => other.id === note.id);
                if (index < 0) this.items.push(note); else this.items[index] = note;
            }
            return Promise.resolve();
        },
    };
    const settled = [];
    const sandbox = {
        console, JSON, Date, Math, Number, String,
        crypto: { randomUUID: () => `new-${settled.length}` },
        localStorage: { getItem: k => local.get(k) ?? null, setItem: (k, v) => local.set(k, v), removeItem: k => local.delete(k) },
        document: { getElementById: id => elements[id] ?? null, addEventListener() {} },
        el: (tag, props = {}, ...children) => ({ tag, ...props, children: children.flat() }),
        settleSchedule: ids => settled.push(...ids),
        calendarView: {},
    };
    vm.createContext(sandbox);
    vm.runInContext(source('calendar-core.js') + source('tasks-core.js')
        + '\nconst notebook = { store: globalThis.__store, defaultNote: id => globalThis.__store.get(id) || newDefaultNote(id) };\n'
        + source('todolist.js') + '\nglobalThis.api = { todoList, pomodoroNotes };', Object.assign(sandbox, { __store: store }));
    return { ...sandbox.api, store, elements, local, settled };
}

const todo = (items = [], extra = {}) => ({ id: 'pomodoro-todo', type: 'list', title: 'To-do list', labels: ['pomodoro'], items, ...extra });
const diary = { id: 'pomodoro-diary', type: 'text', title: 'Distraction diary', labels: ['pomodoro'], text: '' };
const entry = (id, extra = {}) => ({ id, text: id, done: false, ...extra });
const plain = value => JSON.parse(JSON.stringify(value));

test('pomodoroNotes lists the default note first, then other notes labelled pomodoro of that kind', () => {
    const notes = [
        todo(), diary,
        { id: 'b', type: 'list', title: 'Errands', labels: ['Pomodoro'], items: [] },
        { id: 'a', type: 'list', title: 'Chores', labels: [' pomodoro '], items: [] },
        { id: 'c', type: 'list', title: 'Shopping', labels: ['home'], items: [] },
        { id: 'd', type: 'text', title: 'Ideas', labels: ['pomodoro'], text: '' },
    ];
    const { pomodoroNotes } = load(notes);
    assert.deepStrictEqual(plain(pomodoroNotes(notes, 'list').map(n => n.id)), ['pomodoro-todo', 'a', 'b']);
    assert.deepStrictEqual(plain(pomodoroNotes(notes, 'text').map(n => n.id)), ['pomodoro-diary', 'd']);
    // The defaults stay even without the label, and are made up if not created yet.
    assert.deepStrictEqual(plain(pomodoroNotes([{ ...todo(), labels: [] }], 'list').map(n => n.id)), ['pomodoro-todo']);
    assert.deepStrictEqual(plain(pomodoroNotes([], 'text').map(n => n.id)), ['pomodoro-diary']);
});

test('the to-do panel shows the picked pomodoro checklist and adds to it', async () => {
    const notes = [todo([entry('t1')]), diary, { id: 'work', type: 'list', title: 'Work', labels: ['pomodoro'], items: [entry('w1')] }];
    const p = load(notes);
    const picker = p.elements['pomodoro-list'];
    assert.equal(picker.hidden, false);
    assert.deepStrictEqual(plain(picker.children.map(o => o.value)), ['pomodoro-todo', 'work']);
    assert.deepStrictEqual(plain(p.elements['todolist-table-container'].children.map(row => row.children[1].children[0])), ['t1']);

    picker.value = 'work';
    picker.listeners.change();
    assert.equal(p.local.get('pomodoro_list'), 'work');
    assert.deepStrictEqual(plain(p.elements['todolist-table-container'].children.map(row => row.children[1].children[0])), ['w1']);

    p.elements['new-item-input'].value = 'w2';
    await p.todoList.addItem();
    assert.deepStrictEqual(plain(p.store.get('work').items.map(i => i.text)), ['w1', 'w2']);
    assert.deepStrictEqual(plain(p.store.get('pomodoro-todo').items.map(i => i.text)), ['t1']);
    assert.deepStrictEqual(plain(p.settled), ['item:work:new-0']);
});

test('a checklist that loses its label falls back to the default one, and one list hides the picker', () => {
    const p = load([todo([entry('t1')]), { id: 'work', type: 'list', title: 'Work', labels: [], items: [entry('w1')] }],
        { pomodoro_list: 'work' });
    assert.equal(p.todoList.note.id, 'pomodoro-todo');
    assert.equal(p.elements['pomodoro-list'].hidden, true);
});

test('"Working on" offers open to-dos from every pomodoro checklist and keeps one choice', async () => {
    const notes = [todo([entry('t1'), entry('t2', { done: true })], { current: 't1' }),
        { id: 'work', type: 'list', title: 'Work', labels: ['pomodoro'], items: [entry('w1')] }];
    const p = load(notes);
    const select = p.elements['pomodoro-task'];
    const groups = select.children.slice(1);
    assert.deepStrictEqual(plain(groups.map(g => [g.label, g.children.map(o => o.children[0])])), [['To-do list', ['t1']], ['Work', ['w1']]]);
    assert.equal(select.value, JSON.stringify(['pomodoro-todo', 't1']));

    select.value = JSON.stringify(['work', 'w1']);
    await select.listeners.change();
    assert.equal(p.store.get('work').current, 'w1');
    assert.equal(p.store.get('pomodoro-todo').current, null);
    assert.deepStrictEqual(plain(p.todoList.current).item.id, 'w1');

    select.value = '';
    await select.listeners.change();
    assert.equal(p.store.get('work').current, null);
    assert.equal(p.todoList.current, null);
});

test('ticking off the to-do being worked on clears it', async () => {
    const p = load([todo([], {}), { id: 'work', type: 'list', title: 'Work', labels: ['pomodoro'], items: [entry('w1')], current: 'w1' }],
        { pomodoro_list: 'work' });
    await p.todoList.toggleComplete('w1');
    assert.equal(p.store.get('work').current, null);
    assert.equal(p.store.get('work').items[0].done, true);
});
