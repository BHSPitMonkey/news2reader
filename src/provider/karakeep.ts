import fs from "node:fs";
import path from "node:path";
import querystring from "node:querystring";
import got from "got";
import { Express, Request, Response } from "express";
import { OPDSFeed } from "../opds.js";
import { OpenSearchDescription } from "../opensearch.js";

/**
 * Params accepted by the Karakeep's /get API (subset we care about)
 */
interface KarakeepApiBookmarksGetParams {
    archived?: "true" | "false",
    favourited?: "true" | "false",
    includeContent?: "true" | "false",
    limit?: number,
    state?: "all" | "unread",
}

/**
 * Params accepted by the Karakeep's /search API (subset we care about)
 */
interface KarakeepApiBookmarksSearchParams {
    includeContent?: "true" | "false",
    limit?: number,
    q: string,
}

interface KarakeepApiContentLink {
  type: "link",
  url: string,
  title?: string,
}

interface KarakeepApiBookmark {
  id: string,
  createdAt: string,
  modifiedAt?: string,
  title?: string,
  archived: boolean,
  favourited: boolean,
  summary?: string,
  content: KarakeepApiContentLink | any,
};

interface KarakeepApiBookmarkList { bookmarks: KarakeepApiBookmark[]; }

/**
 * Internal description of a Karakeep catalog feed
 */
interface FeedDescription {
    name: string,
    id: string,
    description: string,
    searchParams: KarakeepApiBookmarksGetParams,
}

export default class KarakeepProvider {
  public readonly BASE_URL = process.env.KARAKEEP_API_URL ?? null;
  private readonly CONSUMER_KEY = process.env.KARAKEEP_API_KEY ?? null;
  private readonly BASE_SEARCH_PARAMS = {
    limit: 60,
  };
  private readonly FEEDS: FeedDescription[] = [
    {
      name: "All Items",
      id: "all",
      description: "All saved items from Karakeep",
      searchParams: {},
    },
    {
      name: "Favorite Items",
      id: "favorite",
      description: "Favorite items from Karakeep",
      searchParams: {
        favourited: "true",
      },
    },
        {
      name: "Archived Items",
      id: "unread",
      description: "All unread items from Karakeep",
      searchParams: {
        archived: "true",
      },
    },
  ];

  public constructor(app: Express, configDir: string) {
    this.registerRoutes(app);
  }

  public isConnected() {
    return this.BASE_URL !== null && this.CONSUMER_KEY !== null;
  }

  private registerRoutes(app: Express) {
    // Navigation Feed
    app.get("/opds/provider/karakeep", (req: Request, res: Response) => {
      const feed = new OPDSFeed({
        id: "karakeep",
        links: {
          self: "/opds/provider/karakeep",
          start: "/opds",
          up: "/opds",
          search: "/opds/provider/karakeep/search.xml",
        },
        title: "Karakeep",
      });
      feed.addEntries(
        this.FEEDS.map((entry) => {
          return {
            title: entry.name,
            id: `karakeep-${entry.id}`,
            link: `/opds/provider/karakeep/${entry.id}`,
            content: entry.description,
          };
        })
      );
      res.type('application/xml').send(feed.toXmlString());
    });

    // Search description document
    app.get(
      `/opds/provider/karakeep/search.xml`,
      async (req: Request, res: Response) => {
        const searchDescription = new OpenSearchDescription('/opds/provider/karakeep/search?q={searchTerms}');
        res.type('application/xml').send(searchDescription.toXmlString());
      }
    );

    // Search handler
    app.get(
      `/opds/provider/karakeep/search`,
      async (req: Request, res: Response) => {
        const feed = new OPDSFeed({
          id: `karakeep-search`,
          links: {
            self: `/opds/provider/karakeep/search`,
            start: "/opds",
            up: "/opds/provider/karakeep",
          },
          title: "Search",
        });

        const query = req.query.q;
        if (typeof query !== "string") {
          console.error("Search endpoint called without a 'q' query param");
          res.status(400).send("Search query is required");
          return;
        }

        // Fetch stories
        const combinedSearchParams = {
          ...this.BASE_SEARCH_PARAMS,
          q: query,
        };
        const stories = await this.searchBookmarks(combinedSearchParams);
        for (const story of stories) {
          if (story.url === undefined || story.title === undefined) {
              console.warn("WARN: Search handler skipping story due to undefined url or title:", story);
              continue; // Skip this iteration
          }
          feed.addArticleAcquisitionEntry(story.url, story.title);
        }
        res.type('application/xml').send(feed.toXmlString());
      }
    );

    // Acquisition feeds
    for (const entry of this.FEEDS) {
      app.get(
        `/opds/provider/karakeep/${entry.id}`,
        async (req: Request, res: Response) => {
          const feed = new OPDSFeed({
            id: `karakeep-${entry.id}`,
            links: {
              self: `/opds/provider/karakeep/${entry.id}`,
              start: "/opds",
              up: "/opds/provider/karakeep",
            },
            title: entry.name,
          });

          // Fetch stories
          const combinedSearchParams = {
            ...this.BASE_SEARCH_PARAMS,
            ...entry.searchParams,
          };
          const stories = await this.getBookmarks(combinedSearchParams);
          for (const story of stories) {
            if (story.url === undefined || story.title === undefined) {
                console.warn("WARN: Skipping story due to undefined url or title:", story);
                continue; // Skip this iteration
            }
            feed.addArticleAcquisitionEntry(story.url, story.title);
          }
          res.type('application/xml').send(feed.toXmlString());
        }
      );
    }
  }

  private async getBookmarks(searchParams: KarakeepApiBookmarksGetParams) {
    const data = await got
      .get(`${this.BASE_URL}/api/v1/bookmarks`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.CONSUMER_KEY}`,
        },
        searchParams: {...searchParams},
      })
      .json() as KarakeepApiBookmarkList; // fixme: better type
    
    if (process.env.VERBOSE) {
      console.log("Using search params:", searchParams);
      console.log("Got Karakeep data:", data);
    }
    debugger;
    return data.bookmarks.sort((a , b) => {
      const itemA = a;
      const itemB = b;
      const timeA = parseInt(itemA.createdAt);
      const timeB = parseInt(itemB.createdAt);
      if (timeA < timeB) {
        return 1;
      }
      if (timeA > timeB) {
        return -1;
      }
      return 0;
    }).map(entry => {
      console.log("Entry", entry);
      const item = entry;
        const title = item.title ? item.title : item.content.title;
        return {
            title,
            url: item.content.url,
        };
    });
  }

  private async searchBookmarks(searchParams: KarakeepApiBookmarksSearchParams) {
    const data = await got
      .get(`${this.BASE_URL}/api/v1/bookmarks/search`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.CONSUMER_KEY}`,

        },
        searchParams: {...searchParams},
      })
      .json() as KarakeepApiBookmarkList; // fixme: better type
    
    if (process.env.VERBOSE) {
      console.log("Using search params:", searchParams);
      console.log("Got Karakeep data:", data);
    }
    return data.bookmarks
    .filter(item => typeof item.content.url === "string")
    .sort((a , b) => {
      const itemA = a;
      const itemB = b;
      const timeA = parseInt(itemA.createdAt);
      const timeB = parseInt(itemB.createdAt);
      if (timeA < timeB) {
        return 1;
      }
      if (timeA > timeB) {
        return -1;
      }
      return 0;
    }).map(entry => {
      const item = entry;
        const title = item.title ? item.title : item.content.title;
        return {
            title,
            url: item.content.url,
        };
    });
  }
}
