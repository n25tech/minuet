/*
 * Notes / distraction diary textarea, synced to the backend when signed in
 * (see sync.js) and stored in localStorage otherwise.
 */

const NOTES_CONFLICT_MARKER = "\n\n--- From another device ---\n";

// Both devices edited since the last sync: keep this device's text and append
// the other device's version rather than silently dropping either.
function mergeNotes(base, mine, theirs) {
	if (mine === base || mine === theirs) return theirs;
	if (theirs === base) return mine;
	return mine + NOTES_CONFLICT_MARKER + theirs;
}

class Notes {
	constructor(textareaId = "notes-area", debounceMs = 800) {
		this.textarea = document.getElementById(textareaId);
		this.debounceMs = debounceMs;
		this.timer = null;
		this.doc = new SyncedDoc({
			endpoint: "/api/storage/notes",
			field: "content",
			localKey: "notes",
			empty: () => "",
			isEmpty: content => !content,
			merge: mergeNotes,
			isBusy: () => this.timer !== null,
			current: () => this.textarea.value,
			onRemoteChange: content => this._setText(content),
		});
	}

	init() {
		if (!this.textarea) return this;
		this.textarea.addEventListener("input", () => this._scheduleSave());
		this.textarea.addEventListener("blur", () => this.flush());
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") this.flush();
		});
		window.addEventListener("pagehide", () => this.flush());
		bindSyncedDoc(this.doc, content => this._setText(content));
		return this;
	}

	_setText(content) {
		if (this.textarea.value === content) return;
		const { selectionStart, selectionEnd } = this.textarea;
		this.textarea.value = content;
		if (document.activeElement === this.textarea) {
			this.textarea.setSelectionRange(selectionStart, selectionEnd);
		}
	}

	_scheduleSave() {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), this.debounceMs);
	}

	flush() {
		if (this.timer === null) return;
		clearTimeout(this.timer);
		this.timer = null;
		return this.doc.save(this.textarea.value);
	}
}

const notes = new Notes().init();
