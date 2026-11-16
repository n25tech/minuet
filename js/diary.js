/*
 * The Pomodoro page's distraction diary. It is a view of the default "Distraction diary" text
 * note (label "pomodoro") in the notebook (see notebook.js), so it can also be opened under Notes.
 * Typing is saved to the note after a short pause, and at once when the box loses focus or the
 * page is hidden.
 */
class Diary {
	constructor(textareaId = "notes-area", debounceMs = 800) {
		this.textarea = document.getElementById(textareaId);
		this.debounceMs = debounceMs;
		this.timer = null;   // set while there is typing that hasn't been saved to the note yet
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
		document.addEventListener("minuet:notes", () => this._show());
		this._show();
		return this;
	}

	_show() {
		if (this.timer !== null) return;   // the unsaved typing is newer; it is saved over this shortly
		const text = notebook.defaultNote(DIARY_NOTE_ID).text || "";
		if (this.textarea.value === text) return;
		const { selectionStart, selectionEnd } = this.textarea;
		this.textarea.value = text;
		if (document.activeElement === this.textarea) this.textarea.setSelectionRange(selectionStart, selectionEnd);
	}

	flush() {
		if (this.timer === null) return;
		clearTimeout(this.timer);
		this.timer = null;
		const note = notebook.defaultNote(DIARY_NOTE_ID);
		if (note.text !== this.textarea.value) notebook.store.upsert({ ...note, text: this.textarea.value });
	}
}

const diary = new Diary().init();
