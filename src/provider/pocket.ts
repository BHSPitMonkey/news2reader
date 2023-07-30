import querystring from "node:querystring";
import fs from "node:fs";
import got from "got";
import express, { Express, Request, Response } from "express";
import { OPDSFeed } from "../opds.js";

interface OAuthCodeResponse {
    code: string;
}

interface OAuthAccessTokenResponse {
    access_token: string;
    username: string;
}

export default class PocketProvider {
  private consumer_key: string;
  private code: string | null;
  private accessToken: string | null;

  private readonly BASE_SEARCH_PARAMS = {
    contentType: "article",
    detailType: "simple",
    count: 15,
  };
  private readonly FEEDS = [
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

  public constructor(app: Express) {
    this.consumer_key = "108332-4cb01719bb01deabce69438";
    this.code = null;
    this.registerRoutes(app);

    this.accessToken = null; // TODO: Load from storage if exists already
    if (fs.existsSync('.pocketauth')) {
        const pocketauth = fs.readFileSync(".pocketauth").toString();
        if (pocketauth.length > 0) {
            console.log("Using stored Pocket access token");
            this.accessToken = pocketauth;
        }
    }
  }

  public isEnabled() {
    // TODO: Only true if consumer key is set
    return true;
  }

  public getArticles() {
    // pocket.getRequestToken()
    //     .then(reponse => {
    //         console.log(response)
    //         //returns request_token
    //     })
    // // Once you have you have recieved you request token, you have to send you user to the getPocket site
    // // It must also include a redirect URL, example:
    // // https://getpocket.com/auth/authorize?request_token=YOUR_REQUEST_TOKEN&redirect_uri=YOUR_REDIRECT_URI
    // // Please refer to the getPocket API site
    // pocket.getAccessToken()
    //     .then(response => {
    //         console.log(repsonse);
    //         // returns access token
    //     });
    // pocket.getArticles(parameter_object)
    //     .then(response => {
    //         console.log(response);
    //         //Returns articles
    //     });
  }

  private registerRoutes(app: Express) {
    app.get("/pocket/setup", async (req: Request, res: Response) => {
      //console.warn(req);
      const redirectUrl = `http://${req.headers.host}/pocket/oauth`;
      // const resp = await this.pocket.getRequestToken({url}, (_: null, authParams: any) => {
      //     console.log("ASDF", authParams.redirectUrl);
      //     return authParams.redirectUrl;
      // });
      try {
        const data = (await got
          .post("https://getpocket.com/v3/oauth/request", {
            headers: {
              Accept: "*/*",
              "X-Accept": "application/json",
            },
            json: {
              consumer_key: this.consumer_key,
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
              consumer_key: this.consumer_key,
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
      res.send(feed.toXmlString());
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
          console.log("Got stories:", stories);
          for (const story of stories) {
            feed.addArticleAcquisitionEntry(story.url, story.title);
          }
          res.send(feed.toXmlString());
        }
      );
    }
  }

  private async getStories(searchParams) {
    const data = await got
      .post("https://getpocket.com/v3/get", {
        headers: {
          Accept: "*/*",
          "X-Accept": "application/json",
        },
        json: {
            consumer_key: this.consumer_key,
            access_token: this.accessToken,
            ...searchParams,
        },
      })
      .json() as {list: object};
    console.log("Got Pocket data:", data);
    return Object.entries(data.list).map(entry => {
        const [item_id, item] = entry;
        return {
            title: item.resolved_title,
            url: item.resolved_url,
        };
    });
  }

  private setAccessToken(token: string) {
    this.accessToken = token;
    // TODO: Persist token in storage somewhere restricted
    fs.writeFileSync(".pocketauth", token);
  }
}