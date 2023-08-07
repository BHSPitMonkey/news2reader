import fs from "node:fs";
import path from "node:path";
import querystring from "node:querystring";
import got from "got";
import { Express, Request, Response } from "express";
import { OPDSFeed } from "../opds.js";

interface OAuthCodeResponse {
    code: string;
}

interface OAuthAccessTokenResponse {
    access_token: string;
    username: string;
}

/**
 * Params accepted by the Pocket's /get API (subset we care about)
 */
interface PocketApiSearchParams {
    contentType?: "article",
    count?: number,
    detailType?: "simple",
    favorite?: "0" | "1",
    sort?: "newest",
    state?: "all" | "unread",
}

interface PocketApiItem {
  item_id: string,
  resolved_id: string,
  given_url: string,
  given_title: string,
  favorite: string,
  sort_id: number,
  status: string,
  time_added: string,
  time_updated: string,
  resolved_title: string,
  resolved_url: string,
  is_article: string,
  is_index: string,
  word_count: string,
};

interface PocketApiItemList { [key: string]: PocketApiItem; }

/**
 * Internal description of a Pocket catalog feed
 */
interface FeedDescription {
    name: string,
    id: string,
    description: string,
    searchParams: PocketApiSearchParams,
}

export default class PocketProvider {
  private code: string | null;
  private accessToken: string | null;
  private authConfigPath: string;

  private readonly CONSUMER_KEY = "108332-4cb01719bb01deabce69438";
  private readonly BASE_SEARCH_PARAMS: PocketApiSearchParams = {
    detailType: "simple",
    count: 60,
  };
  private readonly FEEDS: FeedDescription[] = [
    {
      name: "All Items",
      id: "all",
      description: "All saved items from Pocket",
      searchParams: {
        state: "all",
        sort: "newest",
      },
    },
    {
      name: "Unread Items",
      id: "unread",
      description: "All unread items from Pocket",
      searchParams: {
        state: "unread",
        sort: "newest",
      },
    },
    {
      name: "Favorite Items",
      id: "favorite",
      description: "Favorite items from Pocket",
      searchParams: {
        state: "all",
        favorite: "1",
        sort: "newest",
      },
    },
  ];

  public constructor(app: Express, configDir: string) {
    this.code = null;
    this.registerRoutes(app);

    this.authConfigPath = path.join(configDir, 'pocketauth');
    this.accessToken = null;
    if (fs.existsSync(this.authConfigPath)) {
        const pocketauth = fs.readFileSync(this.authConfigPath).toString();
        if (pocketauth.length > 0) {
            console.log("Using stored Pocket access token");
            this.accessToken = pocketauth;
        }
    }
  }

  public isConnected() {
    return (typeof this.accessToken === "string");
  }

  private registerRoutes(app: Express) {
    app.get("/pocket/setup", async (req: Request, res: Response) => {
      const redirectUrl = `http://${req.headers.host}/pocket/oauth`;
      try {
        const data = (await got
          .post("https://getpocket.com/v3/oauth/request", {
            headers: {
              Accept: "*/*",
              "X-Accept": "application/json",
            },
            json: {
              consumer_key: this.CONSUMER_KEY,
              redirect_uri: redirectUrl,
            },
          })
          .json()) as OAuthCodeResponse;
        // Save the returned 'code', we'll need this later
        this.code = data.code;
        const authorizeQuery = querystring.stringify({
          request_token: this.code,
          redirect_uri: redirectUrl,
        });
        const authorizeUrl = `https://getpocket.com/auth/authorize?${authorizeQuery}`;
        res.redirect(authorizeUrl);
        return;
      } catch (e) {
        console.error("Pocket setup failed", e);
        res.status(500).send("Pocket setup failed");
        return;
      }
    });
    app.get("/pocket/oauth", async (req: Request, res: Response) => {
      // We should now be able to exchange our 'code' for an access token
      try {
        const data = (await got
          .post("https://getpocket.com/v3/oauth/authorize", {
            headers: {
              Accept: "*/*",
              "X-Accept": "application/json",
            },
            json: {
              consumer_key: this.CONSUMER_KEY,
              code: this.code,
            },
          })
          .json()) as OAuthAccessTokenResponse;
        console.log(`Got access token for Pocket user ${data.username}`);
        this.setAccessToken(data.access_token);
        res.send("Pocket is now signed in! You can leave this page.");
      } catch (e) {
        console.error("Error getting Pocket token", e);
        res
          .status(500)
          .send(
            "Pocket setup failed! Check logs, and return to /pocket/setup to try again."
          );
        return;
      }
    });

    // Navigation Feed
    app.get("/opds/provider/pocket", (req: Request, res: Response) => {
      const feed = new OPDSFeed({
        id: "pocket",
        links: {
          self: "/opds/provider/pocket",
          start: "/opds",
          up: "/opds",
        },
        title: "Pocket",
      });
      feed.addEntries(
        this.FEEDS.map((entry) => {
          return {
            title: entry.name,
            id: `pocket-${entry.id}`,
            link: `/opds/provider/pocket/${entry.id}`,
            content: entry.description,
          };
        })
      );
      res.type('application/xml').send(feed.toXmlString());
    });

    // Acquisition feeds
    for (const entry of this.FEEDS) {
      app.get(
        `/opds/provider/pocket/${entry.id}`,
        async (req: Request, res: Response) => {
          const feed = new OPDSFeed({
            id: `pocket-${entry.id}`,
            links: {
              self: `/opds/provider/pocket/${entry.id}`,
              start: "/opds",
              up: "/opds/provider/pocket",
            },
            title: entry.name,
          });

          // Fetch stories
          const combinedSearchParams = {
            ...this.BASE_SEARCH_PARAMS,
            ...entry.searchParams,
          };
          const stories = await this.getStories(combinedSearchParams);
          for (const story of stories) {
            feed.addArticleAcquisitionEntry(story.url, story.title);
          }
          res.type('application/xml').send(feed.toXmlString());
        }
      );
    }
  }

  private async getStories(searchParams: PocketApiSearchParams) {
    const data = await got
      .post("https://getpocket.com/v3/get", {
        headers: {
          Accept: "*/*",
          "X-Accept": "application/json",
        },
        json: {
            consumer_key: this.CONSUMER_KEY,
            access_token: this.accessToken,
            ...searchParams,
        },
      })
      .json() as {list: PocketApiItemList}; // fixme: better type
    
    if (process.env.VERBOSE) {
      console.log("Using search params:", searchParams);
      console.log("Got Pocket data:", data);
    }
    return Object.entries(data.list).sort((a , b) => {
      const [, itemA] = a;
      const [, itemB] = b;
      const timeA = parseInt(itemA.time_added);
      const timeB = parseInt(itemB.time_added);
      if (timeA < timeB) {
        return 1;
      }
      if (timeA > timeB) {
        return -1;
      }
      return 0;
    }).map(entry => {
      const [, item] = entry;
        const title = item.resolved_title ? item.resolved_title : item.given_title;
        return {
            title,
            url: item.given_url,
        };
    });
  }

  private setAccessToken(token: string) {
    this.accessToken = token;
    
    // Persist the access token into the config dir
    fs.writeFileSync(this.authConfigPath, token);
  }
}