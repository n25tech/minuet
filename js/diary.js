/*
 * The Pomodoro page's distraction diary. It shows one plain note from the notebook (see notebook.js):
 * the default "Distraction diary" note, or any other plain note labelled "pomodoro", picked above the
 * box (the choice is kept per device). So it can also be opened under Notes.
 * Typing is saved to the note after a short pause, and at once when the box loses focus, the page is
 * hidden or another note is picked.
 */
const POMODORO_DIARY_KEY = "pomodoro_diary";

class Diary {
	constructor(textareaId = "notes-area", pickerId = "diary-note", debounceMs = 800) {
		this.textarea = document.getElementById(textareaId);
		this.picker = document.getElementById(pickerId);
		this.debounceMs = debounceMs;
		this.timer = null;   // set while there is typing that hasn't been saved to the note yet
		try {
			this.noteId = localStorage.getItem(POMODORO_DIARY_KEY) || DIARY_NOTE_ID;
		} catch {
			this.noteId = DIARY_NOTE_ID;
		}
	}

	/* The plain notes that can be used here, the default one first. */
	get notes() {
		return pomodoroNotes(notebook.store.items, "text");
	}

	/* The note shown; back to the default one if the chosen one was deleted or lost its label. */
	get note() {
		const notes = this.notes;
		return notes.find(note => note.id === this.noteId) || notes[0];
	}

	select(id) {
		this.flush();   // what was typed belongs to the note shown until now
		this.noteId = id;
		try {
			localStorage.setItem(POMODORO_DIARY_KEY, id);
		} catch { /* the choice just isn't remembered */ }
		this._show();
	}

	init() {
		if (!this.textarea) return this;
		this.textarea.addEventListener("input", () => {
			clearTimeout(this.timer);
			this.timer = setTimeout(() => this.flush(), this.debounceMs);
		});
		this.textarea.addEventListener("blur", () => this.flush());
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") this.flush();
		});
		window.addEventListener("pagehide", () => this.flush());
		// Sign-out and background refreshes must not lose or overwrite unsaved typing.
		notebook.unsaved.push({ isBusy: () => this.timer !== null, flush: () => this.flush() });
		if (this.picker) this.picker.addEventListener("change", () => this.select(this.picker.value));
		document.addEventListener("minuet:notes", () => this._show());
		this._show();
		return this;
	}

	/* The note picker only appears once there is more than one pomodoro plain note. */
	_renderPicker() {
		if (!this.picker) return;
		const notes = this.notes;
		const shown = this.shownId;
		this.picker.hidden = notes.length < 2;
		this.picker.replaceChildren(...notes.map(note => el("option", { value: note.id, selected: note.id === shown }, noteHeading(note))));
		this.picker.value = shown;
	}

	_show() {
		if (this.timer !== null) return;   // the unsaved typing is newer; it is saved over this shortly
		const note = this.note;
		this.shownId = note.id;
		this._renderPicker();
		const text = note.text || "";
		if (this.textarea.value === text) return;
		const { selectionStart, selectionEnd } = this.textarea;
		this.textarea.value = text;
		if (document.activeElement === this.textarea) this.textarea.setSelectionRange(selectionStart, selectionEnd);
	}

	flush() {
		if (this.timer === null) return;
		clearTimeout(this.timer);
		this.timer = null;
		// Saved to the note the typing was done in, never to a different one.
		const note = this.shownId === DIARY_NOTE_ID ? notebook.defaultNote(DIARY_NOTE_ID) : notebook.store.get(this.shownId);
		if (!note) return;   // deleted on another device meanwhile
		if (note.text !== this.textarea.value) notebook.store.upsert({ ...note, text: this.textarea.value });
	}
}

const diary = new Diary().init();
