import querystring from "node:querystring";
import got from "got";
import { Express, Request, Response } from "express";
import { OPDSFeed } from "../opds.js";
import { OpenSearchDescription } from "../opensearch.js";

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
    [index: string]: string|number|null|undefined;

    tags: string,
    numericFilters?: string,
    query?: string
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
              search: "/opds/provider/hackernews/search.xml",
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

        // Search description document
        app.get(
          `/opds/provider/hackernews/search.xml`,
          async (req: Request, res: Response) => {
            const searchDescription = new OpenSearchDescription('/opds/provider/hackernews/search?q={searchTerms}');
            res.type('application/xml').send(searchDescription.toXmlString());
          }
        );

        // Search handler
        app.get(
          `/opds/provider/hackernews/search`,
          async (req: Request, res: Response) => {
            const feed = new OPDSFeed({
              id: `hackernews-search`,
              links: {
                self: `/opds/provider/hackernews/search`,
                start: "/opds",
                up: "/opds/provider/hackernews",
              },
              title: "Search",
            });

            // Fetch stories
            const query = req.query.q;
            if (typeof query !== "string") {
              console.error("Search endpoint called without a 'q' query param");
              res.status(400).send("Search query is required");
              return;
            }

            const stories = await this.getStories({
              tags: "story",
              query
            });
            for (const story of stories) {
              feed.addArticleAcquisitionEntry(story.url, story.title);
            }
            res.type('application/xml').send(feed.toXmlString());
          }
        );
    
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
              for (const story of stories) {
                feed.addArticleAcquisitionEntry(story.url, story.title);
              }
              res.type('application/xml').send(feed.toXmlString());
            }
          );
        }
      }

    private async getStories(searchParams: HNSearchParams, lookbackDays: number|undefined = undefined) {
        // Fetch stories
        const maxStories = 60;
        let queryString = querystring.stringify(searchParams);
        queryString += `&hitsPerPage=${maxStories}`;
        if (typeof lookbackDays === "number") {
            const currentTimestamp = Math.floor(Date.now() / 1000);
            const lookbackTimeStamp = currentTimestamp - (lookbackDays * 24 * 60 * 60);
            queryString = queryString.replace("TIMESTAMP", `${lookbackTimeStamp}`);
        }
        
        if (process.env.VERBOSE) {
          console.log("Searching HN with query", queryString);
        }
        
        const searchUrl = `http://hn.algolia.com/api/v1/search?${queryString}`;
        const response = await got(searchUrl).json() as HNSearchResults;
        
        if (process.env.VERBOSE) {
          console.log(response);
        }
        
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
        .filter(hit => typeof hit.url === "string")
        .map((hit) => {
          return { title: hit.title, url: hit.url };
        });

        if (process.env.VERBOSE) {
          console.log(results);
        }
        
        return results;
      }
}