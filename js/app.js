
// In app.js (Your Router)
function LoadPage(pageTemplate) {
    const template = document.getElementById(pageTemplate);
    const clone = template.content.cloneNode(true);
    const app = document.getElementById('app');
    console.log(app);
    app.innerHTML = '';
    app.appendChild(clone);
}

const LoadSigninPage = () => {
    LoadPage('signin-page-template');
}

const LoadMainPage = () => {
    LoadPage('main-page-template');
}

LoadMainPage();
//LoadSigninPage();

const routes = {
    "/": {
        title: "Metrics Dashboard",
        requiresShell: true,
        render: () => `<h2>Live Operational Status</h2>`
    },
    "/login": {
        title: "Secure Gate - Login",
        requiresShell: false, // Hide the dashboard layout entirely
        render: () => `
            <div class="auth-card">
                <h2>System Entry</h2>
                <div id="google-signin-btn"></div>
            </div>
        `,
    }
}

const router = () => {
    const path = window.location.pathname;
    const route = routes[path] || routes["/"];
    
    document.title = route.title;

    // Toggle the visual state of the entire HTML document body based on layout needs
    const body = document.body;
    if (route.requiresShell) {
        body.classList.remove("minimal-layout");
        body.classList.add("full-shell-layout");
    } else {
        body.classList.remove("full-shell-layout");
        body.classList.add("minimal-layout");
    }

    // Inject content into the viewport
    document.getElementById("app").innerHTML = route.render();

    if (route.init) route.init();
};
