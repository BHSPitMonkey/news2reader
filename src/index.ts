/**
 * This application generates OPDS feeds (https://specs.opds.io/opds-1.2)
 * based on items fetched from link aggregators, and EPUBs based on
 * those links upon request.
 */
import querystring from "node:querystring";
import { URL } from "node:url";
import express, { Express, Request, Response } from "express";
//import { Feed } from "feed";
import { create } from "xmlbuilder2";
import Epub from "epub-gen";
import jsdom from "jsdom";
import { Readability } from "@mozilla/readability";
import got from "got";

//import dotenv from 'dotenv';
//dotenv.config();

const app: Express = express();
const port = process.env.PORT ?? 8080;

// Catalog Root
app.get("/opds", (req: Request, res: Response) => {
  const feed = create()
    .ele('feed', { xmlns: "http://www.w3.org/2005/Atom" })
    .ele('id').txt('foobar').up()
    .ele('link', { rel: 'self', href: '/opds', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
    .ele('link', { rel: 'start', href: '/opds', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
    .ele('title').txt('News 2 OPDS Root').up()
    .ele('updated').txt('2023-07-27T07:26:26.954Z').up()
    .ele('author')
    .ele('name').txt('news2opds').up()
    .ele('uri').txt('https://github.com/BHSPitMonkey/news2opds').up()
    .up();
  
  feed.ele('entry')
  .ele('id').txt('hn').up()
  .ele('title').txt('Hacker News').up()
  .ele('link', { rel: 'subsection', href: '/opds/provider/hackernews', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
  .ele('updated').txt('2023-07-27T07:26:26.954Z').up()
  .ele('content', {type: 'text'}).txt('Recent articles from Hacker News').up();

  res.send(feed.doc().end({ prettyPrint: true }));
});

// HN Navigation Feeds
app.get("/opds/provider/hackernews", (req: Request, res: Response) => {
  const feed = create()
    .ele('feed', { xmlns: "http://www.w3.org/2005/Atom" })
    .ele('id').txt('hn').up()
    .ele('link', { rel: 'self', href: '/opds/provider/hackernews', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
    .ele('link', { rel: 'start', href: '/opds', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
    .ele('link', { rel: 'up', href: '/opds', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
    .ele('title').txt('Hacker News').up()
    .ele('updated').txt('2023-07-27T07:26:26.954Z').up();
  
  feed.ele('entry')
  .ele('id').txt('hn').up()
  .ele('title').txt('Front Page').up()
  .ele('link', { rel: 'subsection', href: '/opds/provider/hackernews/front', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
  .ele('updated').txt('2023-07-27T07:26:26.954Z').up()
  .ele('content', {type: 'text'}).txt('Front page stories from Hacker News').up();

  res.send(feed.doc().end({ prettyPrint: true }));
});
// HN Acquisition Feeds
app.get("/opds/provider/hackernews/front", (req: Request, res: Response) => {
  const feed = create()
    .ele('feed', { xmlns: "http://www.w3.org/2005/Atom" })
    .ele('id').txt('hn').up()
    .ele('link', { rel: 'self', href: '/opds/provider/hackernews/front', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
    .ele('link', { rel: 'start', href: '/opds', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
    .ele('link', { rel: 'up', href: '/opds/provider/hackernews', type: 'application/atom+xml;profile=opds-catalog;kind=navigation' }).up()
    .ele('title').txt('Hacker News Front Page').up()
    .ele('updated').txt('2023-07-27T07:26:26.954Z').up();
  
  // Add story/URL to the feed
  const url = "https://factoryfactoryfactory.net/";
  const title = "Factory Factory Factory";
  const queryString = querystring.stringify({url});
  feed.ele('entry')
  .ele('id').txt('foo').up()
  .ele('title').txt(title).up()
  .ele('updated').txt('2023-07-27T07:26:26.954Z').up()
  .ele('link', { rel: 'http://opds-spec.org/acquisition', href: `/content.epub?${queryString}`, type: 'application/epub+zip' }).up()

  res.send(feed.doc().end({ prettyPrint: true }));
});

// Generate and serve an epub based on the 'url' query param
app.get("/content.epub", async (req: Request, res: Response) => {
  const url = req.query.url;
  if (typeof url !== "string") {
    console.error('Query string did not contain a string as the URL');
    res.status(400).send("Could not retrieve this article");
    return;
  }

  const urlObj = new URL(url);
  const urlHost = urlObj.hostname;

  // TODO: Read/write EPUB into a cache dir by URL hash
  const outputPath = '/tmp/news2opds-out.epub';
  const virtualConsole = new jsdom.VirtualConsole();

  console.log(`Processing article at URL ${url} to path ${outputPath}`);

  const { body } = await got(url);
  console.log(`Fetched ${body.length} chars from ${url}`);

  // Create a JSDOM
  const dom = new jsdom.JSDOM(body, { url, virtualConsole });
  //console.log(dom.window.document.querySelector("title")?.textContent);

  // Create Readable HTML
  let reader = new Readability(dom.window.document);
  let article = reader.parse();
  if (article === null) {
    console.error('Failed to parse article using Readability');
    res.status(404).send("Could not retrieve this article");
    return;
  }
  console.log(`Parsed article:`, {
    title: article.title,
    byline: article.byline,
    length: article.length,
  });

  const queryTitle = req.query.title;
  const title =
    (typeof queryTitle === "string" ? queryTitle : null)
    ?? article?.title
    ?? 'Title Missing';

  // Build the EPUB at output_path
  await new Epub({
    output: outputPath,
    title: title,
    author: article?.byline,
    publisher: urlHost,
    content: [
      {
        title: title,
        author: article?.byline,
        data: article.content,
        beforeToc: true,
      },
    ],
  }).promise;

  console.log(`EPUB saved to ${outputPath}`);
  res.sendFile(outputPath);
});

app.use((req, res, next) => {
  res.status(404).send("Sorry can't find that!")
})

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
