/*
 * Light / dark theme. Loaded in <head> without "defer" so the theme is set before the page is
 * drawn, avoiding a flash of the wrong colours. The choice ("system", "light" or "dark") is kept
 * per device in localStorage; "system" follows the operating system and updates when it changes.
 */
(function () {
	const KEY = "theme";
	const CHOICES = ["system", "light", "dark"];
	const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

	function read() {
		try {
			const saved = localStorage.getItem(KEY);
			return CHOICES.includes(saved) ? saved : "system";
		} catch {
			return "system";
		}
	}

	const resolve = choice => choice === "system" ? (media && media.matches ? "dark" : "light") : choice;

	let choice = read();

	// The view being opened, so its colours are right from the first paint (app.js keeps it up to date).
	document.documentElement.dataset.page = location.hash.replace(/^#\/?/, "") || "pomodoro";

	function apply() {
		const theme = resolve(choice);
		document.documentElement.dataset.theme = theme;
		document.dispatchEvent(new CustomEvent("minuet:theme", { detail: { choice, theme } }));
	}

	if (media) {
		const onSystemChange = () => { if (choice === "system") apply(); };
		if (media.addEventListener) media.addEventListener("change", onSystemChange);
		else if (media.addListener) media.addListener(onSystemChange);
	}

	// Another tab changed the choice.
	window.addEventListener("storage", event => {
		if (event.key === KEY) { choice = read(); apply(); }
	});

	window.minuetTheme = {
		CHOICES,
		get choice() { return choice; },
		get theme() { return resolve(choice); },
		set(next) {
			if (!CHOICES.includes(next)) return;
			choice = next;
			try {
				if (next === "system") localStorage.removeItem(KEY);
				else localStorage.setItem(KEY, next);
			} catch { /* storage blocked: the choice still applies for this visit */ }
			apply();
		},
	};

	apply();

	// The System / Light / Dark buttons on the Settings page.
	document.addEventListener("DOMContentLoaded", () => {
		const group = document.getElementById("settings-theme");
		if (!group) return;
		const buttons = [...group.querySelectorAll("[data-theme-choice]")];
		const show = () => buttons.forEach(button =>
			button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice)));
		buttons.forEach(button => button.addEventListener("click", () => window.minuetTheme.set(button.dataset.themeChoice)));
		document.addEventListener("minuet:theme", show);
		show();
	});
})();
