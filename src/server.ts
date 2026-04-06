/**
 * This application generates OPDS feeds (https://specs.opds.io/opds-1.2)
 * based on items fetched from link aggregators, and EPUBs based on
 * those links upon request.
 */
import fs from "node:fs";
import express, { Express, Request, Response, urlencoded } from "express"; // Added urlencoded
import xdg from "@folder/xdg";
import { OPDSFeed } from "./opds.js";
import { articleToEpub } from "./epub.js";
import PocketProvider from "./provider/pocket.js";
import HackerNewsProvider from "./provider/hacker-news.js";
import TildesProvider from "./provider/tildes.js";
import RaindropProvider from "./provider/raindrop.js";

//import dotenv from 'dotenv';
//dotenv.config();
const dirs = xdg({
  subdir: "news2reader",
});
const configDir = dirs.config;
fs.mkdirSync(configDir, { recursive: true });

const app: Express = express();
const port = process.env.PORT ?? 8080;

// Basic request/response logging
app.use((req, res, next) => {
  res.on("finish", () => {
    const now = new Date().toISOString();
    console.log(`${now} ${req.method} ${req.url} (HTTP ${res.statusCode})`);
  });
  next();
});

const catalogAuthor = {
  name: "news2reader",
  uri: "https://github.com/BHSPitMonkey/news2reader",
};

// Initialize providers
const hackerNewsProvider = new HackerNewsProvider(app, configDir);
const pocketProvider = new PocketProvider(app, configDir);
const tildesProvider = new TildesProvider(app, configDir);
const raindropProvider = new RaindropProvider(app, configDir);

// Catalog Root
app.get("/opds", (req: Request, res: Response) => {
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
    // TODO: Make this more dynamic
    {
      title: "Hacker News",
      id: "hn",
      link: "/opds/provider/hackernews",
      content: "Stories from Hacker News",
    },
    {
      title: "Tildes",
      id: "tildes",
      link: "/opds/provider/tildes",
      content: "Articles from Tildes",
    },
    {
      title: "Pocket",
      id: "pocket",
      link: "/opds/provider/pocket",
      content: "Saved articles from your Pocket account",
    },
    {
      title: "Raindrop.io",
      id: "raindrop",
      link: "/opds/provider/raindrop",
      content: "Collections and bookmarks from Raindrop.io",
    },
  ]);
  res.type("application/xml").send(feed.toXmlString());
});

// Generate and serve an epub based on the 'url' query param
app.get("/content.epub", async (req: Request, res: Response) => {
  let url = req.query.url;
  if (typeof url !== "string") {
    console.error("Query string did not contain a string as the URL");
    res.status(400).send("Could not retrieve this article");
    return;
  }

  // URL may need to be base64 decoded
  if (!url.startsWith("http:") || !url.startsWith("https:")) {
    url = Buffer.from(url, "base64").toString();
  }

  const title = typeof req.query.title === "string" ? req.query.title : null;

  try {
    const epubFilePath = await articleToEpub(url, title);
    res.sendFile(epubFilePath);
  } catch (error) {
    console.error("Failed to create EPUB from article URL");
    console.error(error);
    res.status(404).send("Could not retrieve this article");
    return;
  }
});

// Middleware to parse URL-encoded bodies (form submissions)
const urlencodedParser = urlencoded({ extended: true });

// Route to handle Raindrop token submission from the index page
app.post("/configure/raindrop", urlencodedParser, (req: Request, res: Response) => {
  const token = req.body.raindropToken;
  if (typeof token === 'string' && token.trim() !== '') {
    raindropProvider.setAccessToken(token.trim());
    res.redirect("/"); // Redirect back to the index page
  } else {
    // Optional: redirect back with an error message, or just show a simple error
    res.status(400).send("Raindrop.io API token cannot be empty. <a href=\"/\">Go back</a>");
  }
});

// Generate and serve an epub based on the 'url' query param
app.get("/", async (req: Request, res: Response) => {
  let pocketHtml;
  if (pocketProvider.isConnected()) {
    pocketHtml = `<p>Connected! <a href="/pocket/setup">Switch to another Pocket account</a></p>`;
  } else {
    pocketHtml = `<p>Not connected. <a href="/pocket/setup">Connect to Pocket</a></p>`;
  }

  let raindropHtml;
  if (raindropProvider.isConnected()) {
    raindropHtml = `<p>Connected!</p>`; // Optionally, add a link to reconfigure or disconnect
  } else {
    raindropHtml = `
      <p>Not connected. Configure Raindrop.io:</p>
      <form action="/configure/raindrop" method="POST" style="margin-bottom: 20px;">
        <div>
          <label for="raindropToken" style="display: block; margin-bottom: 5px;">Raindrop.io API Token:</label>
          <input type="text" id="raindropToken" name="raindropToken" required style="width: 80%; padding: 8px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px;">
        </div>
        <button type="submit" style="background-color: #007bff; color: white; padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer;">Save Token</button>
      </form>
      <p><small>You can generate a test token from your Raindrop.io account: Settings -> Integrations -> Create new app.</small></p>
    `;
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
    <h3>Tildes.net</h3>
    <p>Not yet supported</h3>
    <h3>Pocket-compatible server at ${pocketProvider.BASE_URL}</h3>
    ${pocketHtml}
    <h3>Raindrop.io</h3>
    ${raindropHtml}
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
