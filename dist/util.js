import { URL } from "node:url";
export function nameFromUrlPath(url) {
    console.log("nameFromUrlPath:", url);
    const urlObj = new URL(url);
    console.log(urlObj.pathname);
    const parts = urlObj.pathname.split("/");
    console.log(parts);
    return decodeURI(parts[parts.length - 1]);
}
