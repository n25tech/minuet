const GOOGLE_CLIENT_ID = "939463706311-ji3do0uatdidaeodo6ipt6ec9dhur0kg.apps.googleusercontent.com";

let googleAuthInitialized = false;

const originDomain = window.APP_CONFIG.BACKEND_API_URL;

/*
 * Auth state shared with the rest of the app.
 * window.minuetAuth.user is null when signed out, or { userId, email, name } when signed in.
 * A "minuet:auth" event is dispatched on document whenever it changes.
 * sessionExpired() is called by sync.js when the server rejects the session;
 * docs lists the SyncedDocs (sync.js) that must finish saving before sign-out.
 */
window.minuetAuth = { user: null, sessionExpired: () => setCurrentUser(null), docs: [] };

function setCurrentUser(user) {
    window.minuetAuth.user = user && user.userId ? user : null;
    renderAuthUI();
    document.dispatchEvent(new CustomEvent("minuet:auth", { detail: window.minuetAuth.user }));
}

async function refreshSession() {
    try {
        const response = await fetch(`${originDomain}/api/auth/session`, { credentials: "include" });
        const data = response.ok ? await response.json() : null;
        window.minuetAuth.user = data && data.userId ? data : null;
    } catch (error) {
        console.error("Failed to load session", error);
        window.minuetAuth.user = null;
    }
    renderAuthUI();
    return window.minuetAuth.user;
}

// Resolves once the initial session check has finished; data modules wait on this.
window.minuetAuth.ready = refreshSession();

async function handleCredentialResponse(response) {
    try {
        const resp = await fetch(`${originDomain}/api/auth/callback`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "credential=" + encodeURIComponent(response.credential)
        });
        if (!resp.ok) {
            console.error("Sign-in failed", resp.status, await resp.text());
            return;
        }
        closeSigninMenu();
        setCurrentUser(await resp.json());
    } catch (error) {
        console.error("Sign-in failed", error);
    }
}

// Every key holding this user's edits that the server hasn't confirmed yet (see sync.js).
function unsyncedKeys(user) {
    const suffix = `:unsynced:${user.userId}`;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.endsWith(suffix)) keys.push(key);
    }
    return keys;
}

async function signOut() {
    await Promise.all(window.minuetAuth.docs.map(doc => doc.settle()));
    const user = window.minuetAuth.user;
    const unsynced = user ? unsyncedKeys(user) : [];
    if (unsynced.length && !confirm("Some edits haven't synced to your account and will be lost on this device. Sign out anyway?")) return;
    unsynced.forEach(key => localStorage.removeItem(key));
    try {
        await fetch(`${originDomain}/api/auth/session`, { method: "DELETE", credentials: "include" });
    } catch (error) {
        console.error("Sign-out request failed", error);
    }
    if (typeof google !== "undefined" && google.accounts) google.accounts.id.disableAutoSelect();
    closeSigninMenu();
    setCurrentUser(null);
}

function renderAuthUI() {
    const user = window.minuetAuth.user;
    const toggle = document.getElementById("signin-toggle");
    const methods = document.getElementById("signin-methods");
    const account = document.getElementById("account-panel");
    if (!toggle || !methods || !account) return;

    methods.hidden = !!user;
    account.hidden = !user;
    toggle.classList.toggle("signed-in", !!user);

    if (user) {
        const label = user.email || user.name || "Signed in";
        toggle.innerHTML = "";
        const dot = document.createElement("span");
        dot.className = "signin-status-dot";
        dot.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.className = "signin-label";
        text.textContent = label;
        toggle.append(dot, text, document.createTextNode(" ▾"));
        toggle.title = `Signed in as ${label}`;
        toggle.setAttribute("aria-label", `Signed in as ${label}. Account menu`);
        document.getElementById("account-name").textContent = user.name || "";
        document.getElementById("account-email").textContent = user.email || "";
    } else {
        toggle.textContent = "Sign In ▾";
        toggle.removeAttribute("title");
        toggle.removeAttribute("aria-label");
    }
}

function initGoogleAuth() {
    if (googleAuthInitialized) return;
    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse
    });
    googleAuthInitialized = true;
}

function renderGoogleButton(container) {
    if (!container || typeof google === "undefined" || !google.accounts) return;
    initGoogleAuth();
    google.accounts.id.renderButton(container, {
        type: "standard",
        size: "medium",
        theme: "outline",
        text: "sign_in_with",
        shape: "rectangular",
        logo_alignment: "left"
    });
}

function closeSigninMenu() {
    const menu = document.getElementById("signin-menu");
    if (menu) menu.hidden = true;
}

// Toggle the navbar sign-in dropdown. Auth buttons render lazily on first open
// so the Google button isn't rendered into a hidden (zero-width) container.
function toggleSigninMenu() {
    const menu = document.getElementById("signin-menu");
    if (!menu) return;
    menu.hidden = !menu.hidden;
    if (!menu.hidden && !window.minuetAuth.user) {
        const googleContainer = document.getElementById("google-signin-button");
        if (googleContainer && googleContainer.childElementCount === 0) {
            renderGoogleButton(googleContainer);
        }
    }
}

// Close the dropdown when clicking outside of it.
document.addEventListener("click", (event) => {
    const wrapper = document.getElementById("navbar-signin");
    const menu = document.getElementById("signin-menu");
    if (!wrapper || !menu || menu.hidden) return;
    if (!wrapper.contains(event.target)) menu.hidden = true;
});

// Sign-in page: render the button into the page and show the One Tap prompt.
function googleSignIn() {
    renderGoogleButton(document.querySelector(".g_id_signin"));
    google.accounts.id.prompt();
}

// The Google Identity library calls this once it has finished loading.
window.onGoogleLibraryLoad = () => {
    initGoogleAuth();
};
