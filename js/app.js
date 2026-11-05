function LoadPage(pageTemplate) {
    const template = document.getElementById(pageTemplate);
    const app = document.getElementById('app');
    app.replaceChildren(template.content.cloneNode(true));
}

const LoadMainPage = () => {
    LoadPage('main-page-template');
}

LoadMainPage();
