const GOOGLE_CLIENT_ID = "939463706311-ji3do0uatdidaeodo6ipt6ec9dhur0kg.apps.googleusercontent.com";

let googleAuthInitialized = false;

const originDomain = window.location.origin; //https://minuet.n25tech.com

function handleCredentialResponse(response) {
    // Send the returned credential to the backend for verification.
    const resp = fetch(`${originDomain}/api/auth/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "credential=" + encodeURIComponent(response.credential)
    });
    console.log(resp);
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

// Toggle the navbar sign-in dropdown. Auth buttons render lazily on first open
// so the Google button isn't rendered into a hidden (zero-width) container.
function toggleSigninMenu() {
    const menu = document.getElementById("signin-menu");
    if (!menu) return;
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
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
