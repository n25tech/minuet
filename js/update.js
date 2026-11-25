/*
 * "A new version is available" notice. An installed app on a phone is usually resumed rather than
 * reloaded, so it can keep running old code for days after a deploy.
 *
 * The build (scripts/build.js) stamps a version into the page (<meta name="minuet-version">) and into
 * /version.json. When the app comes back into view, and every half hour while it is open, this fetches
 * /version.json; if it differs from the page's, it offers a Refresh. It never reloads on its own, so
 * nobody loses their place mid-sentence (an open note is saved on pagehide anyway).
 *
 * Without the meta (the page served straight from the source, unbuilt) it does nothing.
 */
(function () {
	const CHECK_EVERY_MS = 30 * 60 * 1000;
	const MIN_GAP_MS = 60 * 1000;   // switching apps back and forth shouldn't fetch each time

	const meta = document.querySelector('meta[name="minuet-version"]');
	const running = meta && meta.content;
	if (!running) return;

	let lastCheck = 0;
	let notice = null;

	async function latestVersion() {
		try {
			const response = await fetch("/version.json", { cache: "no-store" });
			if (!response.ok) return null;
			const body = await response.json();
			return typeof body.version === "string" ? body.version : null;
		} catch {
			return null;   // offline, or a deploy in progress: try again next time
		}
	}

	async function check() {
		if (notice || document.visibilityState !== "visible") return;
		const now = Date.now();
		if (now - lastCheck < MIN_GAP_MS) return;
		lastCheck = now;
		const latest = await latestVersion();
		if (latest && latest !== running && !notice) show();
	}

	function show() {
		notice = el("div", { id: "update-notice", class: "toast update-notice", role: "status", popover: "manual" },
			el("div", {}, el("p", {}, "A new version of Minuet is available.")),
			el("button", { type: "button", class: "primary", onclick: () => location.reload() }, "Refresh"),
			el("button", { type: "button", class: "icon-button", "aria-label": "Not now", title: "Not now", onclick: hide }, "×"));
		document.body.append(notice);
		// As a popover it sits above an open note (a modal dialog); without popovers it is a fixed box.
		if (typeof notice.showPopover === "function") notice.showPopover();
	}

	/* "Not now" hides it until the next check finds the update again. */
	function hide() {
		if (!notice) return;
		notice.remove();
		notice = null;
		lastCheck = Date.now();
	}

	document.addEventListener("visibilitychange", check);
	setInterval(check, CHECK_EVERY_MS);
	check();
})();
