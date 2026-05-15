/** Prefix for API paths when mounted under a subpath (e.g. /calendar). */
window.APP_ROOT = window.APP_ROOT || "";

function appUrl(path) {
    const root = window.APP_ROOT || "";
    return root + (path.startsWith("/") ? path : `/${path}`);
}
