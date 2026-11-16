function LoadPage(pageTemplate) {
    const template = document.getElementById(pageTemplate);
    const app = document.getElementById('app');
    app.replaceChildren(template.content.cloneNode(true));
}

const LoadMainPage = () => {
    LoadPage('main-page-template');
}

LoadMainPage();

/* Small DOM builder: el("button", { class: "x", onclick: fn }, "Label", childNode). */
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "dataset") Object.assign(node.dataset, value);
        else if (key === "style") Object.assign(node.style, value);
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else if (key in node) node[key] = value;
        else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
    return node;
}

/* Brief messages about something the app did on its own (e.g. moving a task). */
function toast(lines) {
    if (!lines.length) return;
    let box = document.getElementById("toasts");
    if (!box) {
        box = el("div", { id: "toasts", class: "toasts", role: "status" });
        document.body.append(box);
    }
    const note = el("div", { class: "toast" },
        el("div", {}, lines.map(line => el("p", {}, line))),
        el("button", { type: "button", class: "icon-button", "aria-label": "Dismiss", onclick: () => note.remove() }, "×"));
    box.append(note);
    setTimeout(() => note.remove(), 12000);
}

/*
 * The app's three features (Pomodoro, Notes, Calendar) are sections of one page, switched by
 * the URL hash (#/pomodoro, #/notes, #/calendar). All of them stay in the DOM so the timer
 * keeps running while another feature is open. A "minuet:view" event announces each switch.
 */
const APP_VIEWS = ["pomodoro", "notes", "calendar"];

function currentView() {
    const name = location.hash.replace(/^#\/?/, "");
    return APP_VIEWS.includes(name) ? name : APP_VIEWS[0];
}

function showView() {
    const name = currentView();
    document.querySelectorAll("[data-view]").forEach(section => { section.hidden = section.dataset.view !== name; });
    document.querySelectorAll("[data-nav]").forEach(link => {
        if (link.dataset.nav === name) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
    document.dispatchEvent(new CustomEvent("minuet:view", { detail: name }));
}

window.addEventListener("hashchange", showView);
showView();
