/*
 * SyncedDoc keeps one per-user value in sync with the backend when signed in,
 * and in localStorage when signed out.
 *
 * The server stores a version number per document. Every save sends the version
 * it was based on; if another device saved first the server answers 409 with its
 * current value, which is merged with the local edits (3-way, using the last value
 * both sides agreed on) and saved again.
 *
 * Every signed-in save is also kept in localStorage ("<localKey>:unsynced:<userId>") until the
 * server confirms it; if it never does, it is merged back in and uploaded the next
 * time this device reaches the server.
 */
class SyncedDoc {
	constructor({ endpoint, field, localKey, empty, merge, isEmpty, onRemoteChange, isBusy, normalize, current, flushPending }) {
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
		this.flushPending = flushPending || (() => {});   // start saving any unsaved edits now
		this.value = empty();
		this.base = empty();   // last value known to match the server
		this.version = 0;
		this.remote = false;   // true while signed in and talking to the backend
		this.userId = null;   // account the remote value belongs to
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

	get unsyncedKey() {
		return `${this.localKey}:unsynced:${this.userId}`;
	}

	_loadUnsynced() {
		try {
			return JSON.parse(localStorage.getItem(this.unsyncedKey));
		} catch (error) {
			console.error(error);
			return null;
		}
	}

	_saveUnsynced() {
		try {
			localStorage.setItem(this.unsyncedKey, JSON.stringify({ value: this.value, base: this.base }));
		} catch (error) {
			console.error(error);
		}
	}

	/* Merge an earlier failed save into the server value just fetched, and start uploading it. */
	_applyUnsynced() {
		const unsynced = this._loadUnsynced();
		if (unsynced) this.save(this.merge(unsynced.base, unsynced.value, this.value));
	}

	/* The session ended on the server: show the user as signed out. */
	_sessionEnded() {
		if (this.signedIn) window.minuetAuth.sessionExpired();
	}

	async _fetchRemote() {
		const response = await fetch(this.endpointUrl, { credentials: "include" });
		if (response.status === 401) {
			this._sessionEnded();
			return null;
		}
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
			this.userId = window.minuetAuth.user.userId;
			this.version = data.version || 0;
			this.value = data[this.field] ?? this.empty();
			this.base = structuredClone(this.value);
			this._applyUnsynced();

			// First sign-in on this device with nothing on the server yet:
			// carry over whatever was written while signed out.
			const local = this._loadLocal();
			if (this.version === 0 && this.isEmpty(this.value) && !this.isEmpty(local)) {
				this.save(local).then(saved => { if (saved) localStorage.removeItem(this.localKey); });
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
		this._saveUnsynced();
		this.pending++;
		this.saving = this.saving
			.then(() => this._saveRemote())
			.then(
				() => {
					if (this.pending === 1) {
						localStorage.removeItem(this.unsyncedKey);
					} else {
						if (this._loadUnsynced()) this._saveUnsynced();
					}
					return true;
				},
				(error) => {
					console.error(error);
					if (error.status === 401) this._sessionEnded();
					return false;
				},
			)
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
				throw Object.assign(new Error(`Save failed: ${response.status} ${await response.text()}`), { status: response.status });
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

	/* Save any unsaved edits; resolves once every queued save has finished. */
	settle() {
		this.flushPending();
		return this.saving;
	}

	/* Pull changes made on other devices (called when the tab regains focus). */
	async refresh() {
		if (!this.remote || this.pending > 0 || this.isBusy()) return;
		try {
			const data = await this._fetchRemote();
			if (!data || this.pending > 0 || this.isBusy()) return;
			if (data.version === this.version && !this._loadUnsynced()) return;
			this.version = data.version;
			this.value = data[this.field] ?? this.empty();
			this.base = structuredClone(this.value);
			this._applyUnsynced();
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
	window.minuetAuth.docs.push(doc);
	const reload = async () => onLoaded(await doc.load());
	(window.minuetAuth.ready || Promise.resolve()).then(reload);
	document.addEventListener("minuet:auth", reload);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") doc.refresh();
	});
	window.addEventListener("focus", () => doc.refresh());
}

/*
 * 3-way merge of two edited lists of { id, updatedAt, ... } items against the last synced list.
 * Items added on either side are kept; an item edited on one side keeps that edit (even if the
 * other side deleted it); an item edited on both sides is combined by mergeEdited; an item
 * deleted on one side and untouched on the other is dropped.
 */
function mergeById(base, mine, theirs) {
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	const baseById = new Map(base.map(item => [item.id, item]));
	const mineById = new Map(mine.map(item => [item.id, item]));
	const theirIds = new Set(theirs.map(item => item.id));
	const merged = [];
	for (const item of theirs) {
		const local = mineById.get(item.id);
		const original = baseById.get(item.id);
		if (local) {
			if (original && same(local, original)) merged.push(item);
			else if (original && same(item, original)) merged.push(local);
			else merged.push(mergeEdited(original, local, item));
		} else if (!original || !same(item, original)) {
			merged.push(item); // added on another device, or edited there after being deleted here
		}
	}
	for (const item of mine) {
		if (theirIds.has(item.id)) continue;
		const original = baseById.get(item.id);
		if (!original || !same(item, original)) merged.push(item); // added here, or edited here after being deleted there
	}
	return merged;
}

const TEXT_CONFLICT_MARKER = "\n\n--- From another device ---\n";

/*
 * One item edited on both devices: the more recent edit wins, except that nothing typed is
 * dropped - a checklist ("items") is merged entry by entry, and when both sides changed the
 * "text" the older version is appended to the newer one.
 */
function mergeEdited(original, local, remote) {
	const localIsNewer = (local.updatedAt || 0) > (remote.updatedAt || 0);
	const [newer, older] = localIsNewer ? [local, remote] : [remote, local];
	const merged = { ...newer };
	if (Array.isArray(local.items) && Array.isArray(remote.items)) {
		merged.items = mergeById((original && original.items) || [], local.items, remote.items);
	}
	if (typeof local.text === "string" && typeof remote.text === "string" && local.text !== remote.text) {
		const baseText = (original && original.text) || "";
		if (local.text === baseText) merged.text = remote.text;
		else if (remote.text === baseText) merged.text = local.text;
		else merged.text = newer.text + TEXT_CONFLICT_MARKER + older.text;
	}
	return merged;
}

/*
 * A synced list of { id, updatedAt, ... } items (notes, calendar events).
 * onChange runs whenever the list changes, locally or from another device; onLoad runs after
 * each (re)load, i.e. at startup and on sign-in/out. isBusy and flushPending are passed to
 * SyncedDoc for edits that haven't reached the list yet.
 */
class SyncedList {
	constructor({ endpoint, field, localKey, onChange, onLoad, isBusy, flushPending }) {
		this.items = [];
		this.onChange = onChange;
		this.onLoad = onLoad;
		this.doc = new SyncedDoc({
			endpoint,
			field,
			localKey,
			empty: () => [],
			isEmpty: list => !Array.isArray(list) || list.length === 0,
			merge: mergeById,
			normalize: value => Array.isArray(value) ? value : [],
			onRemoteChange: list => this._set(list),
			isBusy,
			flushPending,
		});
	}

	init() {
		bindSyncedDoc(this.doc, list => {
			this._set(list);
			if (this.onLoad) this.onLoad();
		});
		return this;
	}

	_set(list) {
		this.items = Array.isArray(list) ? list : [];
		this.onChange();
	}

	get(id) {
		return this.items.find(item => item.id === id);
	}

	/* Add or replace items (matched by id) and save. */
	upsert(...changed) {
		for (const item of changed) {
			item.updatedAt = Date.now();
			const index = this.items.findIndex(existing => existing.id === item.id);
			if (index === -1) this.items.push(item);
			else this.items[index] = item;
		}
		return this._commit();
	}

	remove(id) {
		this.items = this.items.filter(item => item.id !== id);
		return this._commit();
	}

	_commit() {
		this.onChange();
		return this.doc.save(this.items);
	}
}
