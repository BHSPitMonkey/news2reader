import { URL } from "node:url";
export function nameFromUrlPath(url) {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split("/");
    return decodeURI(parts[parts.length - 1]);
}
