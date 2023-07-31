var _a;
/**
 * This application generates OPDS feeds (https://specs.opds.io/opds-1.2)
 * based on items fetched from link aggregators, and EPUBs based on
 * those links upon request.
 */
import fs from "node:fs";
import express from "express";
import xdg from "@folder/xdg";
import { OPDSFeed } from "./opds.js";
import { articleToEpub } from "./epub.js";
import PocketProvider from "./provider/pocket.js";
import HackerNewsProvider from "./provider/hacker-news.js";
//import dotenv from 'dotenv';
//dotenv.config();
const dirs = xdg({
    subdir: "news2reader",
});
const configDir = dirs.config;
fs.mkdirSync(configDir, { recursive: true });
const app = express();
const port = (_a = process.env.PORT) !== null && _a !== void 0 ? _a : 8080;
const catalogAuthor = {
    name: "news2reader",
    uri: "https://github.com/BHSPitMonkey/news2reader",
};
// Initialize providers;
const hackerNewsProvider = new HackerNewsProvider(app, configDir);
const pocketProvider = new PocketProvider(app, configDir);
// Catalog Root
app.get("/opds", (req, res) => {
    const feed = new OPDSFeed({
        id: "foo",
        links: {
            self: "/opds",
            start: "/opds",
        },
        title: "News2Reader Catalog Root",
        author: catalogAuthor,
    });
    feed.addEntries([
        {
            title: "Hacker News",
            id: "hn",
            link: "/opds/provider/hackernews",
            content: "Stories from Hacker News",
        },
        {
            title: "Pocket",
            id: "pocket",
            link: "/opds/provider/pocket",
            content: "Saved articles from your Pocket account",
        },
    ]);
    res.type('application/xml').send(feed.toXmlString());
});
// Generate and serve an epub based on the 'url' query param
app.get("/content.epub", async (req, res) => {
    const url = req.query.url;
    if (typeof url !== "string") {
        console.error("Query string did not contain a string as the URL");
        res.status(400).send("Could not retrieve this article");
        return;
    }
    const title = typeof req.query.title === "string" ? req.query.title : null;
    try {
        const epubFilePath = await articleToEpub(url, title);
        res.sendFile(epubFilePath);
    }
    catch (error) {
        console.error("Failed to create EPUB from article URL");
        console.error(error);
        res.status(404).send("Could not retrieve this article");
        return;
    }
});
// Generate and serve an epub based on the 'url' query param
app.get("/", async (req, res) => {
    let pocketHtml;
    if (pocketProvider.isConnected()) {
        pocketHtml = `<p>Connected! <a href="/pocket/setup">Switch to another Pocket account</a></p>`;
    }
    else {
        pocketHtml = `<p>Not connected. <a href="/pocket/setup">Connect to Pocket</a></p>`;
    }
    const body = `
  <html>
  <head>
    <title>news2reader server</title>
    <style>
      html { background: #ddd; }
      body { background: #eee; font-family:sans-serif; max-width: 800px; margin: 22px auto; padding: 22px; }
    </style>
  </head>
  <body>
    <h1>news2reader server</h1>
    <p>Learn more on GitHub: <a href="https://github.com/BHSPitMonkey/news2reader">BHSPitMonkey/news2reader</a></p>
    <h2>Add to your e-reader</h2>
    <p>
      Add this server as an OPDS Catalog in supported e-reader software (such as koreader)
      using the <code>/opds</code> URI.
    </p>
    <p>For example, <code>http://localhost:8080/opds</code> 
      (substitute <code>localhost:8080</code> if you are using a different host or port.)
    </p>
    <h2>Connected accounts</h2>
    <h3>Hacker News</h3>
    <p>Not yet supported</h3>
    <h3>Pocket</h3>
    ${pocketHtml}
  </body>
  `;
    res.send(body);
});
app.use((req, res, next) => {
    res.status(404).send("Sorry can't find that!");
});
app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});