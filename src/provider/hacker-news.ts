import querystring from "node:querystring";
import got from "got";
import { Express, Request, Response } from "express";
import { OPDSFeed } from "../opds.js";

interface HNSearchHit {
  author: string;
  created_at: string;
  objectId: string;
  points: number;
  title: string;
  url: string;
  _tags: string[];
}
interface HNSearchResults {
  hits: HNSearchHit[];
  hitsPerPage: number;
  nbHits: number;
  nbPages: number;
  page: number;
}

interface HNSearchParams {
    tags: string,
    numericFilters?: string,
}

/**
 * Internal description of a Hacker News catalog feed
 */
interface FeedDescription {
    name: string,
    id: string,
    description: string,
    searchParams: HNSearchParams,
    lookbackDays?: number
}

export default class HackerNewsProvider {
    private readonly FEEDS: FeedDescription[] = [
        {
          name: "Front Page",
          id: "front",
          description: "Stories from the Hacker News front page",
          searchParams: {
            tags: "story,front_page",
          },
        },
        {
            name: "Top Stories from Past Week",
            id: "top-week",
            description: "Top Hacker News stories from the past week",
            searchParams: {
              tags: "story",
              numericFilters: "created_at_i>TIMESTAMP"
            },
            lookbackDays: 7,
        },
        {
            name: "Top Stories from Past Month",
            id: "top-month",
            description: "Top Hacker News stories from the past month",
            searchParams: {
              tags: "story",
              numericFilters: "created_at_i>TIMESTAMP"
            },
            lookbackDays: 31
        },
        {
            name: "Top Stories from Past Year",
            id: "top-year",
            description: "Top Hacker News stories from the past year",
            searchParams: {
              tags: "story",
              numericFilters: "created_at_i>TIMESTAMP"
            },
            lookbackDays: 365,
        },
    ];

    public constructor(app: Express, configDir: string) {
        this.registerRoutes(app);
    }

    private registerRoutes(app: Express) {
        // Navigation Feed
        app.get("/opds/provider/hackernews", (req: Request, res: Response) => {
          const feed = new OPDSFeed({
            id: "hackernews",
            links: {
              self: "/opds/provider/hackernews",
              start: "/opds",
              up: "/opds",
            },
            title: "Hacker News",
          });
          feed.addEntries(
            this.FEEDS.map((entry) => {
              return {
                title: entry.name,
                id: `hackernews-${entry.id}`,
                link: `/opds/provider/hackernews/${entry.id}`,
                content: entry.description,
              };
            })
          );
          res.type('application/xml').send(feed.toXmlString());
        });
    
        // Acquisition feeds
        for (const entry of this.FEEDS) {
          app.get(
            `/opds/provider/hackernews/${entry.id}`,
            async (req: Request, res: Response) => {
              const feed = new OPDSFeed({
                id: `hackernews-${entry.id}`,
                links: {
                  self: `/opds/provider/hackernews/${entry.id}`,
                  start: "/opds",
                  up: "/opds/provider/hackernews",
                },
                title: entry.name,
              });
    
              // Fetch stories
              const stories = await this.getStories(entry.searchParams, entry.lookbackDays);
              console.log("Got stories:", stories);
              for (const story of stories) {
                feed.addArticleAcquisitionEntry(story.url, story.title);
              }
              res.type('application/xml').send(feed.toXmlString());
            }
          );
        }
      }

    private async getStories(searchParams: HNSearchParams, lookbackDays: number|undefined) {
        // Fetch stories
        const maxStories = 30;
        let queryString = querystring.stringify(searchParams);
        if (typeof lookbackDays === "number") {
            const currentTimestamp = Math.floor(Date.now() / 1000);
            const lookbackTimeStamp = currentTimestamp - (lookbackDays * 24 * 60 * 60);
            queryString = queryString.replace("TIMESTAMP", `${lookbackTimeStamp}`);
        }
        console.log("Searching HN with query", queryString);
        const searchUrl = `http://hn.algolia.com/api/v1/search?${queryString}`;
        const response = await got(searchUrl).json() as HNSearchResults;
        console.log(response);
        let results = response.hits
        .sort((a, b) => {
          let comparison = 0;
          if (a.points > b.points) {
            comparison = 1;
          } else if (a.points < b.points) {
            comparison = -1;
          }
          return comparison;
        })
        .slice(0, maxStories)
        .filter(hit => typeof hit.url === "string")
        .map((hit) => {
          return { title: hit.title, url: hit.url };
        });
        console.log(results);
        return results;
      }
}