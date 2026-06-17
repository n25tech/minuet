function handleCredentialResponse(response) {
    // Send the returned credential to the backend for verification.
    fetch("https://minuet.n25tech.com/api/auth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "credential=" + encodeURIComponent(response.credential)
    });
}

function googleSignIn() {
    google.accounts.id.initialize({
        client_id: "939463706311-ji3do0uatdidaeodo6ipt6ec9dhur0kg.apps.googleusercontent.com",
        callback: handleCredentialResponse
    });
    google.accounts.id.prompt();
}
