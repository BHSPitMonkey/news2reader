import fs from "node:fs";
import path from "node:path";
import querystring from "node:querystring";
import got from "got";
import { OPDSFeed } from "../opds.js";
import { OpenSearchDescription } from "../opensearch.js";
;
export default class PocketProvider {
    constructor(app, configDir) {
        this.CONSUMER_KEY = "108332-4cb01719bb01deabce69438";
        this.BASE_SEARCH_PARAMS = {
            detailType: "simple",
            count: 60,
        };
        this.FEEDS = [
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
    isConnected() {
        return (typeof this.accessToken === "string");
    }
    registerRoutes(app) {
        app.get("/pocket/setup", async (req, res) => {
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
                    .json());
                // Save the returned 'code', we'll need this later
                this.code = data.code;
                const authorizeQuery = querystring.stringify({
                    request_token: this.code,
                    redirect_uri: redirectUrl,
                });
                const authorizeUrl = `https://getpocket.com/auth/authorize?${authorizeQuery}`;
                res.redirect(authorizeUrl);
                return;
            }
            catch (e) {
                console.error("Pocket setup failed", e);
                res.status(500).send("Pocket setup failed");
                return;
            }
        });
        app.get("/pocket/oauth", async (req, res) => {
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
                    .json());
                console.log(`Got access token for Pocket user ${data.username}`);
                this.setAccessToken(data.access_token);
                res.send("Pocket is now signed in! You can leave this page.");
            }
            catch (e) {
                console.error("Error getting Pocket token", e);
                res
                    .status(500)
                    .send("Pocket setup failed! Check logs, and return to /pocket/setup to try again.");
                return;
            }
        });
        // Navigation Feed
        app.get("/opds/provider/pocket", (req, res) => {
            const feed = new OPDSFeed({
                id: "pocket",
                links: {
                    self: "/opds/provider/pocket",
                    start: "/opds",
                    up: "/opds",
                    search: "/opds/provider/pocket/search.xml",
                },
                title: "Pocket",
            });
            feed.addEntries(this.FEEDS.map((entry) => {
                return {
                    title: entry.name,
                    id: `pocket-${entry.id}`,
                    link: `/opds/provider/pocket/${entry.id}`,
                    content: entry.description,
                };
            }));
            res.type('application/xml').send(feed.toXmlString());
        });
        // Search description document
        app.get(`/opds/provider/pocket/search.xml`, async (req, res) => {
            const searchDescription = new OpenSearchDescription('/opds/provider/pocket/search?q={searchTerms}');
            res.type('application/xml').send(searchDescription.toXmlString());
        });
        // Search handler
        app.get(`/opds/provider/pocket/search`, async (req, res) => {
            const feed = new OPDSFeed({
                id: `pocket-search`,
                links: {
                    self: `/opds/provider/pocket/search`,
                    start: "/opds",
                    up: "/opds/provider/pocket",
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
            const combinedSearchParams = Object.assign(Object.assign({}, this.BASE_SEARCH_PARAMS), { search: query });
            const stories = await this.getStories(combinedSearchParams);
            for (const story of stories) {
                feed.addArticleAcquisitionEntry(story.url, story.title);
            }
            res.type('application/xml').send(feed.toXmlString());
        });
        // Acquisition feeds
        for (const entry of this.FEEDS) {
            app.get(`/opds/provider/pocket/${entry.id}`, async (req, res) => {
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
                const combinedSearchParams = Object.assign(Object.assign({}, this.BASE_SEARCH_PARAMS), entry.searchParams);
                const stories = await this.getStories(combinedSearchParams);
                for (const story of stories) {
                    feed.addArticleAcquisitionEntry(story.url, story.title);
                }
                res.type('application/xml').send(feed.toXmlString());
            });
        }
    }
    async getStories(searchParams) {
        const data = await got
            .post("https://getpocket.com/v3/get", {
            headers: {
                Accept: "*/*",
                "X-Accept": "application/json",
            },
            json: Object.assign({ consumer_key: this.CONSUMER_KEY, access_token: this.accessToken }, searchParams),
        })
            .json(); // fixme: better type
        if (process.env.VERBOSE) {
            console.log("Using search params:", searchParams);
            console.log("Got Pocket data:", data);
        }
        return Object.entries(data.list).sort((a, b) => {
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
    setAccessToken(token) {
        this.accessToken = token;
        // Persist the access token into the config dir
        fs.writeFileSync(this.authConfigPath, token);
    }
}
