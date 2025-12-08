import got from "got";
import { OPDSFeed } from "../opds.js";
import { OpenSearchDescription } from "../opensearch.js";
;
export default class KarakeepProvider {
    constructor(app, configDir) {
        var _a, _b;
        this.BASE_URL = (_a = process.env.KARAKEEP_API_URL) !== null && _a !== void 0 ? _a : null;
        this.CONSUMER_KEY = (_b = process.env.KARAKEEP_API_KEY) !== null && _b !== void 0 ? _b : null;
        this.BASE_SEARCH_PARAMS = {
            limit: 60,
        };
        this.FEEDS = [
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
        this.registerRoutes(app);
    }
    isConnected() {
        return this.BASE_URL !== null && this.CONSUMER_KEY !== null;
    }
    registerRoutes(app) {
        // Navigation Feed
        app.get("/opds/provider/karakeep", (req, res) => {
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
            feed.addEntries(this.FEEDS.map((entry) => {
                return {
                    title: entry.name,
                    id: `karakeep-${entry.id}`,
                    link: `/opds/provider/karakeep/${entry.id}`,
                    content: entry.description,
                };
            }));
            res.type('application/xml').send(feed.toXmlString());
        });
        // Search description document
        app.get(`/opds/provider/karakeep/search.xml`, async (req, res) => {
            const searchDescription = new OpenSearchDescription('/opds/provider/karakeep/search?q={searchTerms}');
            res.type('application/xml').send(searchDescription.toXmlString());
        });
        // Search handler
        app.get(`/opds/provider/karakeep/search`, async (req, res) => {
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
            const combinedSearchParams = Object.assign(Object.assign({}, this.BASE_SEARCH_PARAMS), { q: query });
            const stories = await this.searchBookmarks(combinedSearchParams);
            for (const story of stories) {
                if (story.url === undefined || story.title === undefined) {
                    console.warn("WARN: Search handler skipping story due to undefined url or title:", story);
                    continue; // Skip this iteration
                }
                feed.addArticleAcquisitionEntry(story.url, story.title);
            }
            res.type('application/xml').send(feed.toXmlString());
        });
        // Acquisition feeds
        for (const entry of this.FEEDS) {
            app.get(`/opds/provider/karakeep/${entry.id}`, async (req, res) => {
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
                const combinedSearchParams = Object.assign(Object.assign({}, this.BASE_SEARCH_PARAMS), entry.searchParams);
                const stories = await this.getBookmarks(combinedSearchParams);
                for (const story of stories) {
                    if (story.url === undefined || story.title === undefined) {
                        console.warn("WARN: Skipping story due to undefined url or title:", story);
                        continue; // Skip this iteration
                    }
                    feed.addArticleAcquisitionEntry(story.url, story.title);
                }
                res.type('application/xml').send(feed.toXmlString());
            });
        }
    }
    async getBookmarks(searchParams) {
        const data = await got
            .get(`${this.BASE_URL}/api/v1/bookmarks`, {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${this.CONSUMER_KEY}`,
            },
            searchParams: Object.assign({}, searchParams),
        })
            .json(); // fixme: better type
        if (process.env.VERBOSE) {
            console.log("Using search params:", searchParams);
            console.log("Got Karakeep data:", data);
        }
        debugger;
        return data.bookmarks.sort((a, b) => {
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
    async searchBookmarks(searchParams) {
        const data = await got
            .get(`${this.BASE_URL}/api/v1/bookmarks/search`, {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${this.CONSUMER_KEY}`,
            },
            searchParams: Object.assign({}, searchParams),
        })
            .json(); // fixme: better type
        if (process.env.VERBOSE) {
            console.log("Using search params:", searchParams);
            console.log("Got Karakeep data:", data);
        }
        return data.bookmarks
            .filter(item => typeof item.content.url === "string")
            .sort((a, b) => {
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
