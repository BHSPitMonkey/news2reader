/**
 * This application generates OPDS feeds (https://specs.opds.io/opds-1.2)
 * based on items fetched from link aggregators, and EPUBs based on
 * those links upon request.
 */
import fs from "node:fs";
import querystring from "node:querystring";
import express, { Express, Request, Response } from "express";
import xdg from "@folder/xdg";
import HackerNewsProvider, { getHackerNewsStories } from "./provider/hacker-news.js";
import { OPDSFeed } from "./opds.js";
import { articleToEpub } from "./epub.js";
import PocketProvider from "./provider/pocket.js";

//import dotenv from 'dotenv';
//dotenv.config();
const dirs = xdg({
  subdir: "news2reader",
});
const configDir = dirs.config;
fs.mkdirSync(configDir, {recursive: true});

const app: Express = express();
const port = process.env.PORT ?? 8080;

const catalogAuthor = {
  name: "news2reader",
  uri: "https://github.com/BHSPitMonkey/news2reader",
};

// Initialize providers;
const hackerNewsProvider = new HackerNewsProvider();
const pocketProvider = new PocketProvider(app, configDir);

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
  res.send(feed.toXmlString());
});

// HN Navigation Feeds
app.get("/opds/provider/hackernews", (req: Request, res: Response) => {
  const feed = new OPDSFeed({
    id: "hn",
    links: {
      self: "/opds/provider/hackernews",
      start: "/opds",
      up: "/opds",
    },
    title: "Hacker News",
    author: catalogAuthor,
  });
  feed.addEntries([
    {
      title: "Front Page",
      id: "hn-front",
      link: "/opds/provider/hackernews/front",
      content: "Front page stories from Hacker News",
    },
  ]);
  res.send(feed.toXmlString());
});

// HN Acquisition Feeds
app.get(
  "/opds/provider/hackernews/front",
  async (req: Request, res: Response) => {
    const feed = new OPDSFeed({
      id: "hn-front",
      links: {
        self: "/opds/provider/hackernews/front",
        start: "/opds",
        up: "/opds/provider/hackernews",
      },
      title: "Hacker News Front Page",
      author: catalogAuthor,
    }).feed;

    // Fetch stories
    const results = await getHackerNewsStories();
    console.log(results);

    for (const hit of results) {
      // Add story/URL to the feed
      const url = hit.url;
      const title = hit.title;
      const queryString = querystring.stringify({ url });

      // Simplistic webpage vs PDF detection
      let href: string;
      let type: string;
      if (url.endsWith(".pdf")) {
        href = url;
        type = "application/pdf";
      } else {
        href = `/content.epub?${queryString}`;
        type = "application/epub+zip";
      }

      feed
        .ele("entry")
          .ele("id").txt("foo").up()
          .ele("title").txt(title).up()
          //.ele('updated').txt('2023-07-27T07:26:26.954Z').up()
          .ele("link", {
            rel: "http://opds-spec.org/acquisition",
            href,
            type,
          })
        .up();
    }

    res.send(feed.doc().end({ prettyPrint: true }));
  }
);

// Generate and serve an epub based on the 'url' query param
app.get("/content.epub", async (req: Request, res: Response) => {
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
  } catch (error) {
    console.error("Failed to create EPUB from article URL");
    console.error(error);
    res.status(404).send("Could not retrieve this article");
    return;
  }
});

app.use((req, res, next) => {
  res.status(404).send("Sorry can't find that!");
});

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
