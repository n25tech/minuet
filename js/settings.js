/*
 * Settings page (signed-in only): the user's time zone, access tokens that let an AI assistant
 * use Minuet through the MCP server (/api/mcp), and the record of what was changed through
 * those tokens, each change with an Undo.
 */
const ACCESS_LEVELS = {
	read: { scopes: ["read"], label: "View only", detail: "See notes, to-dos and the calendar." },
	suggest: { scopes: ["read", "suggest"], label: "View and suggest", detail: "Also add and change notes, to-dos and suggested tasks. Can't commit tasks to fixed times or delete anything." },
	manage: { scopes: ["read", "suggest", "manage"], label: "Full control", detail: "Also commit tasks to fixed times, change committed tasks, delete, and undo." },
};
const levelOf = scopes => scopes.includes("manage") ? "manage" : scopes.includes("suggest") ? "suggest" : "read";
const formatWhen = time => new Date(time).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const formatDay = time => new Date(time).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

class SettingsView {
	constructor() {
		this.api = window.APP_CONFIG.BACKEND_API_URL;
		this.mcpUrl = `${this.api || location.origin}/api/mcp`;
		this.shownFor = null;   // user id whose tokens and history are on the page
	}

	part(id) {
		return document.getElementById(`settings-${id}`);
	}

	init() {
		this.part("token-form").addEventListener("submit", event => {
			event.preventDefault();
			this.createToken();
		});
		this.part("timezone").addEventListener("change", event => this.saveTimezone(event.target.value));
		this.part("levels").replaceChildren(...Object.entries(ACCESS_LEVELS).map(([value, level]) => el("label", { class: "level" },
			el("input", { type: "radio", name: "settings-level", value, checked: value === "suggest" }),
			el("span", {}, el("strong", {}, level.label), el("small", {}, level.detail)))));
		this.part("history-refresh").addEventListener("click", () => this.loadHistory());
		this._fillTimezones();
		document.addEventListener("minuet:auth", () => this.load());
		document.addEventListener("minuet:view", event => { if (event.detail === "settings") this.load(); });
		(window.minuetAuth.ready || Promise.resolve()).then(() => this.load());
		return this;
	}

	async request(path, options = {}) {
		const response = await fetch(`${this.api}${path}`, {
			credentials: "include",
			...options,
			...(options.body ? { method: options.method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) } : {}),
		});
		const data = await response.json().catch(() => ({}));
		if (response.status === 401) window.minuetAuth.sessionExpired();
		if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
		return data;
	}

	_error(id, error) {
		const box = this.part(id);
		box.textContent = error ? error.message : "";
		box.hidden = !error;
	}

	/*
	 * Remove everything account-specific from the page. A freshly created token stays on screen
	 * until dismissed, so without this it would still be there for whoever signs in next in this tab.
	 */
	_clearAccountData() {
		const newToken = this.part("new-token");
		newToken.hidden = true;
		newToken.replaceChildren();
		this.part("tokens").replaceChildren();
		this.part("history").replaceChildren();
		this.part("token-name").value = "";
		for (const id of ["timezone-error", "token-error", "history-error"]) this._error(id, null);
	}

	async load() {
		const user = window.minuetAuth.user;
		const signedIn = !!user;
		const userId = signedIn ? user.userId : null;
		if (userId !== this.shownFor) this._clearAccountData();   // signed out, or a different account signed in
		this.shownFor = userId;
		this.part("signed-out").hidden = signedIn;
		this.part("signed-in").hidden = !signedIn;
		if (!signedIn) return;
		// The time zone is needed by assistants even if this page is never opened, so it is settled at sign-in.
		await Promise.all([this.loadTimezone(), ...(currentView() === "settings" ? [this.loadTokens(), this.loadHistory()] : [])]);
	}

	/* ---------- Time zone ---------- */

	get deviceTimezone() {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	}

	_fillTimezones(selected) {
		const zones = new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);
		for (const zone of [this.deviceTimezone, selected]) if (zone) zones.add(zone);
		this.part("timezone").replaceChildren(...[...zones].sort().map(zone => el("option", { value: zone, selected: zone === selected }, zone.replace(/_/g, " "))));
	}

	async loadTimezone() {
		try {
			let { timezone } = await this.request("/api/settings");
			// First sign-in: assume this device's zone; the user can change it here.
			if (!timezone && this.deviceTimezone) ({ timezone } = await this.request("/api/settings", { body: { timezone: this.deviceTimezone } }));
			this._fillTimezones(timezone);
			const differs = timezone && this.deviceTimezone && timezone !== this.deviceTimezone;
			this.part("timezone-note").textContent = differs ? `This device is currently in ${this.deviceTimezone.replace(/_/g, " ")}.` : "";
			this._error("timezone-error", null);
		} catch (error) {
			this._error("timezone-error", error);
		}
	}

	async saveTimezone(timezone) {
		try {
			await this.request("/api/settings", { body: { timezone } });
			await this.loadTimezone();
		} catch (error) {
			this._error("timezone-error", error);
		}
	}

	/* ---------- Access tokens ---------- */

	async loadTokens() {
		try {
			const { tokens } = await this.request("/api/tokens");
			this.part("tokens").replaceChildren(...(tokens.length ? tokens.map(token => this._tokenRow(token)) : [el("p", { class: "empty-state" }, "No tokens yet.")]));
			this._error("token-error", null);
		} catch (error) {
			this._error("token-error", error);
		}
	}

	_tokenRow(token) {
		return el("div", { class: "settings-row" },
			el("div", { class: "settings-row-main" },
				el("strong", {}, token.name),
				el("span", { class: "chip small" }, ACCESS_LEVELS[levelOf(token.scopes)].label),
				el("small", {}, [
					`Created ${formatDay(token.createdAt)}`,
					token.expiresAt ? `expires ${formatDay(token.expiresAt)}` : "never expires",
					token.lastUsedAt ? `last used ${formatWhen(token.lastUsedAt)}` : "never used",
				].join(" · "))),
			el("button", {
				type: "button", class: "danger",
				onclick: async () => {
					if (!confirm(`Revoke “${token.name}”? Anything using it will stop working immediately.`)) return;
					try {
						await this.request(`/api/tokens?id=${encodeURIComponent(token.id)}`, { method: "DELETE" });
					} catch (error) {
						this._error("token-error", error);
					}
					this.loadTokens();
				},
			}, "Revoke"));
	}

	async createToken() {
		const name = this.part("token-name").value.trim();
		const level = document.querySelector('input[name="settings-level"]:checked').value;
		const requestedFor = this.shownFor;
		try {
			const created = await this.request("/api/tokens", {
				body: { name, scopes: ACCESS_LEVELS[level].scopes, expiresInDays: Number(this.part("token-expiry").value) },
			});
			if (this.shownFor !== requestedFor) return;   // the account changed while the request was in flight
			this.part("token-name").value = "";
			this._showNewToken(created);
			this.loadTokens();
		} catch (error) {
			this._error("token-error", error);
		}
	}

	/* The one time the token is visible, with the ways to hand it to an assistant. */
	_showNewToken(created) {
		const copyable = (label, value, note) => {
			const button = el("button", {
				type: "button",
				onclick: async () => {
					try {
						await navigator.clipboard.writeText(value);
						button.textContent = "Copied";
					} catch {
						// No clipboard access (older browsers, insecure pages): select it for a manual copy.
						const range = document.createRange();
						range.selectNodeContents(code);
						getSelection().removeAllRanges();
						getSelection().addRange(range);
					}
				},
			}, "Copy");
			const code = el("code", {}, value);
			return el("div", { class: "settings-copy" }, el("strong", {}, label), note ? el("small", {}, note) : null, el("div", { class: "settings-copy-value" }, code, button));
		};
		const box = this.part("new-token");
		box.replaceChildren(
			el("h4", {}, `“${created.name}” is ready`),
			el("p", {}, "Copy what you need now. For your security the token is not shown again; if you lose it, revoke it and create another."),
			copyable("Token", created.token),
			copyable("Server address", this.mcpUrl, "For assistants that ask for an MCP server URL and a separate bearer token."),
			copyable("Address with the token included", `${this.mcpUrl}?token=${created.token}`,
				"For assistants that only accept a URL, such as a custom connector. Treat this whole address as a password."),
			copyable("Claude Code", `claude mcp add --transport http minuet ${this.mcpUrl} --header "Authorization: Bearer ${created.token}"`),
			el("button", { type: "button", class: "quiet", onclick: () => { box.hidden = true; box.replaceChildren(); } }, "Done, hide it"));
		box.hidden = false;
		box.scrollIntoView({ block: "nearest" });
	}

	/* ---------- History ---------- */

	async loadHistory() {
		try {
			const { changes } = await this.request("/api/history");
			this.part("history").replaceChildren(...(changes.length ? changes.map(change => this._historyRow(change)) : [
				el("p", { class: "empty-state" }, "Nothing has been changed through a token yet."),
			]));
			this._error("history-error", null);
		} catch (error) {
			this._error("history-error", error);
		}
	}

	_historyRow(change) {
		const others = change.items.length > 1 ? ` (${change.items.length} items affected)` : "";
		return el("div", { class: "settings-row" + (change.undone ? " undone" : "") },
			el("div", { class: "settings-row-main" },
				el("span", {}, change.summary + others),
				el("small", {}, `${change.actor} · ${formatWhen(change.at)}` + (change.undone ? " · undone" : ""))),
			change.undone ? null : el("button", {
				type: "button",
				onclick: async () => {
					try {
						await this.request("/api/history", { body: { undo: change.id } });
						// Bring the undone state into the app straight away.
						notebook.store.doc.refresh();
						calendarView.store.doc.refresh();
					} catch (error) {
						this._error("history-error", error);
					}
					this.loadHistory();
				},
			}, "Undo"));
	}
}

const settingsView = new SettingsView().init();
