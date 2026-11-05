/*
 * SyncedDoc keeps one per-user value in sync with the backend when signed in,
 * and in localStorage when signed out.
 *
 * The server stores a version number per document. Every save sends the version
 * it was based on; if another device saved first the server answers 409 with its
 * current value, which is merged with the local edits (3-way, using the last value
 * both sides agreed on) and saved again.
 */
class SyncedDoc {
	constructor({ endpoint, field, localKey, empty, merge, isEmpty, onRemoteChange, isBusy, normalize, current }) {
		this.endpointUrl = `${window.APP_CONFIG.BACKEND_API_URL}${endpoint}`;
		this.field = field;
		this.localKey = localKey;
		this.empty = empty;
		this.merge = merge;
		this.isEmpty = isEmpty;
		this.onRemoteChange = onRemoteChange;
		this.normalize = normalize || (value => value);
		this.isBusy = isBusy || (() => false);   // e.g. unsaved typing
		this.current = current || (() => this.value);   // newest local value, including unsaved edits
		this.value = empty();
		this.base = empty();   // last value known to match the server
		this.version = 0;
		this.remote = false;   // true while signed in and talking to the backend
		this.saving = Promise.resolve();
		this.pending = 0;
	}

	get signedIn() {
		return !!(window.minuetAuth && window.minuetAuth.user);
	}

	_loadLocal() {
		try {
			const raw = localStorage.getItem(this.localKey);
			if (raw !== null) return this.normalize(JSON.parse(raw));
		} catch (error) {
			console.error(error);
		}
		return this.empty();
	}

	_saveLocal(value) {
		try {
			localStorage.setItem(this.localKey, JSON.stringify(value));
		} catch (error) {
			console.error(error);
		}
	}

	async _fetchRemote() {
		const response = await fetch(this.endpointUrl, { credentials: "include" });
		if (response.status === 401) return null;
		if (!response.ok) throw new Error(`GET ${this.endpointUrl} failed: ${response.status}`);
		return response.json();
	}

	async _postRemote(value, version) {
		return fetch(this.endpointUrl, {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ [this.field]: value, version }),
		});
	}

	/* Load from the server when signed in, otherwise from localStorage. */
	async load() {
		await this._load();
		return structuredClone(this.value);
	}

	async _load() {
		if (!this.signedIn) {
			this.remote = false;
			this.value = this._loadLocal();
			return;
		}
		try {
			const data = await this._fetchRemote();
			if (!data) {
				this.remote = false;
				this.value = this._loadLocal();
				return;
			}
			this.remote = true;
			this.version = data.version || 0;
			this.value = data[this.field] ?? this.empty();
			this.base = structuredClone(this.value);

			// First sign-in on this device with nothing on the server yet:
			// carry over whatever was written while signed out.
			const local = this._loadLocal();
			if (this.version === 0 && this.isEmpty(this.value) && !this.isEmpty(local)) {
				if (await this.save(local)) localStorage.removeItem(this.localKey);
			}
		} catch (error) {
			console.error(error);
			this.remote = false;
			this.value = this._loadLocal();
		}
	}

	/*
	 * Save a new value. Saves are serialised so each one is based on the latest version.
	 * Resolves to true once the value is stored, false if the server write failed.
	 */
	save(value) {
		this.value = structuredClone(value);
		if (!this.remote) {
			this._saveLocal(value);
			return Promise.resolve(true);
		}
		this.pending++;
		this.saving = this.saving
			.then(() => this._saveRemote())
			.then(() => true, (error) => { console.error(error); return false; })
			.finally(() => { this.pending--; });
		return this.saving;
	}

	async _saveRemote() {
		for (let attempt = 0; attempt < 5; attempt++) {
			const value = this.value;
			const response = await this._postRemote(value, this.version);
			if (response.ok) {
				this.version = (await response.json()).version;
				this.base = structuredClone(value);
				return;
			}
			if (response.status !== 409) {
				throw new Error(`Save failed: ${response.status} ${await response.text()}`);
			}
			// Another device saved first: merge their changes with ours and retry.
			const server = await response.json();
			const theirs = server[this.field] ?? this.empty();
			this.value = this.merge(this.base, this.current(), theirs);
			this.base = structuredClone(theirs);
			this.version = server.version;
			if (this.onRemoteChange) this.onRemoteChange(structuredClone(this.value));
		}
		throw new Error("Save failed: too many conflicting updates");
	}

	/* Pull changes made on other devices (called when the tab regains focus). */
	async refresh() {
		if (!this.remote || this.pending > 0 || this.isBusy()) return;
		try {
			const data = await this._fetchRemote();
			if (!data || this.pending > 0 || this.isBusy() || data.version === this.version) return;
			this.version = data.version;
			this.value = data[this.field] ?? this.empty();
			this.base = structuredClone(this.value);
			if (this.onRemoteChange) this.onRemoteChange(structuredClone(this.value));
		} catch (error) {
			console.error(error);
		}
	}
}

/*
 * Keeps a document in step with sign-in state and other devices:
 * loads once the session is known, reloads on sign-in/out, and refreshes
 * whenever the tab becomes visible again.
 */
function bindSyncedDoc(doc, onLoaded) {
	const reload = async () => onLoaded(await doc.load());
	(window.minuetAuth.ready || Promise.resolve()).then(reload);
	document.addEventListener("minuet:auth", reload);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") doc.refresh();
	});
	window.addEventListener("focus", () => doc.refresh());
}
