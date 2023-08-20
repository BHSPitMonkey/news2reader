import got from "got";
import jsdom from "jsdom";
import { Express, Request, Response } from "express";
import { OPDSFeed } from "../opds.js";

/**
 * Internal description of a Tildes-specific catalog feed
 */
interface FeedDescription {
    name: string,
    id: string,
    description: string,
}

export default class TildesProvider {
    private readonly FEEDS: FeedDescription[] = [
        {
          name: "Front Page",
          id: "front",
          description: "Stories from the Tildes front page",
        },
    ];

    public constructor(app: Express, configDir: string) {
        this.registerRoutes(app);
    }

    private registerRoutes(app: Express) {
        // Navigation Feed
        app.get("/opds/provider/tildes", (req: Request, res: Response) => {
          const feed = new OPDSFeed({
            id: "tildes",
            links: {
              self: "/opds/provider/tildes",
              start: "/opds",
              up: "/opds",
            },
            title: "Hacker News",
          });
          feed.addEntries(
            this.FEEDS.map((entry) => {
              return {
                title: entry.name,
                id: `tildes-${entry.id}`,
                link: `/opds/provider/tildes/${entry.id}`,
                content: entry.description,
              };
            })
          );
          res.type('application/xml').send(feed.toXmlString());
        });
    
        // Acquisition feeds
        for (const entry of this.FEEDS) {
          app.get(
            `/opds/provider/tildes/${entry.id}`,
            async (req: Request, res: Response) => {
              const feed = new OPDSFeed({
                id: `tildes-${entry.id}`,
                links: {
                  self: `/opds/provider/tildes/${entry.id}`,
                  start: "/opds",
                  up: "/opds/provider/tildes",
                },
                title: entry.name,
              });
    
              // Fetch stories
              const stories = await this.getStories();
              for (const story of stories) {
                if (story.url != null && story.title != null) {
                  feed.addArticleAcquisitionEntry(story.url, story.title);
                }
              }
              res.type('application/xml').send(feed.toXmlString());
            }
          );
        }
      }

    private async getStories() {
        // Fetch stories

        if (process.env.VERBOSE) {
          console.log("Searching Tildes for articles");
        }
        
        const searchUrl = `https://tildes.net/`;
        const response = await got(searchUrl).text();
        const virtualConsole = new jsdom.VirtualConsole();
        const dom = new jsdom.JSDOM(response, { url: searchUrl, virtualConsole });
        const document = dom.window.document;
        const nodeList : NodeList = document.querySelectorAll(".topic");
        const topics = Array.from(nodeList) as HTMLElement[];
        
        if (process.env.VERBOSE) {
          console.log(topics);
        }

        let results = topics
        .filter(topic => {
          let contentType = topic?.querySelector('.topic-content-type') as HTMLElement;
          if (process.env.VERBOSE) {
            console.log("Topic has contentType:", contentType);
          }
          return contentType?.textContent == 'Article';
        })
        .map(topic => {
          const a = topic.querySelector('h1.topic-title > a') as HTMLElement;
          const title = a.textContent;
          const url = a.getAttribute("href");
          return { title, url };
        });
        
        return results;
      }
}