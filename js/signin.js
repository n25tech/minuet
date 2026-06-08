function googleSignIn() {
    google.accounts.id.initialize({
      client_id: "939463706311-ji3do0uatdidaeodo6ipt6ec9dhur0kg.apps.googleusercontent.com",
      callback: "https://minuet.n25tech.com/api/auth/callback"
    });
    google.accounts.id.prompt();
}

googleSignIn();