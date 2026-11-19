import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Runs the real js/pomodoro.js with a fake clock, localStorage and the card's elements.
function loadPomodoro(saved = {}) {
    const store = new Map(Object.entries(saved));
    const button = minutes => ({
        dataset: { minutes: String(minutes) }, disabled: false, attrs: {}, onClick: null,
        setAttribute(name, value) { this.attrs[name] = value; },
        addEventListener(type, fn) { this.onClick = fn; },
    });
    const durations = [2, 5, 15, 25, 45, 60].map(button);
    const display = { textContent: '' };
    const toggle = { textContent: '' };
    const elements = {
        'pomodoro-timer-display': display,
        'pomodoro-toggle-button': toggle,
        'pomodoro-durations': { querySelectorAll: () => durations },
    };
    const clock = { now: 1_000_000 };
    const sandbox = {
        console: { log() {}, error() {} },
        JSON, Number, String, Math,
        Date: { now: () => clock.now },
        setInterval: () => 1, clearInterval() {},
        alert() {},
        localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
        document: { getElementById: id => elements[id] ?? null, addEventListener() {} },
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(readFileSync('js/pomodoro.js', 'utf8'), context);
    const timer = vm.runInContext('new PomodoroTimer().init()', context);
    const pressed = () => durations.filter(b => b.attrs['aria-pressed'] === 'true').map(b => Number(b.dataset.minutes));
    const click = minutes => durations.find(b => b.dataset.minutes === String(minutes)).onClick();
    return { timer, display, durations, store, clock, pressed, click };
}

test('defaults to 25 minutes', () => {
    const p = loadPomodoro();
    assert.equal(p.display.textContent, '25:00');
    assert.deepEqual(p.pressed(), [25]);
});

test('picking a length updates the timer and is remembered', () => {
    const p = loadPomodoro();
    p.click(2);
    assert.equal(p.display.textContent, '02:00');
    p.click(45);
    assert.equal(p.display.textContent, '45:00');
    assert.deepEqual(p.pressed(), [45]);
    assert.equal(p.store.get('pomodoro_duration'), '45');
    p.timer.start();
    p.clock.now += 60_000;
    p.timer.updateUI();
    assert.equal(p.display.textContent, '44:00');

    const again = loadPomodoro({ pomodoro_duration: '45' });
    assert.equal(again.display.textContent, '45:00');
});

test('ignores lengths that are not offered', () => {
    assert.equal(loadPomodoro({ pomodoro_duration: '7' }).display.textContent, '25:00');
    const p = loadPomodoro();
    assert.equal(p.timer.setDuration(7), false);
    assert.equal(p.display.textContent, '25:00');
});

test('the length is locked during a session and reset returns to the chosen one', () => {
    const p = loadPomodoro();
    p.click(15);
    p.timer.start();
    assert.ok(p.durations.every(b => b.disabled));
    p.click(60);
    assert.deepEqual(p.pressed(), [15]);
    p.timer.reset();
    assert.ok(p.durations.every(b => !b.disabled));
    assert.equal(p.display.textContent, '15:00');
});

test('a session saved with another length shows that length, then reset goes back to the choice', () => {
    const running = { status: 'running', time: { duration: 45, startTime: 1_000_000, endTime: 1_000_000 + 45 * 60_000, remainingSeconds: null } };
    const p = loadPomodoro({ pomodoro_duration: '25', pomodoro_state: JSON.stringify(running) });
    assert.equal(p.display.textContent, '45:00');
    assert.deepEqual(p.pressed(), [45]);
    p.timer.reset();
    assert.equal(p.display.textContent, '25:00');
    p.timer.start();
    assert.equal(p.timer.timeObj.endTime - p.clock.now, 25 * 60_000);
});
