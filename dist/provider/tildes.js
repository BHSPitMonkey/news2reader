import querystring from "node:querystring";
import got from "got";
import jsdom from "jsdom";
import { OPDSFeed } from "../opds.js";
import { OpenSearchDescription } from "../opensearch.js";
export default class TildesProvider {
    constructor(app, configDir) {
        this.FEEDS = [
            {
                name: "Front Page",
                id: "front",
                description: "Stories from the Tildes front page",
            },
        ];
        this.registerRoutes(app);
    }
    registerRoutes(app) {
        // Navigation Feed
        app.get("/opds/provider/tildes", (req, res) => {
            const feed = new OPDSFeed({
                id: "tildes",
                links: {
                    self: "/opds/provider/tildes",
                    start: "/opds",
                    up: "/opds",
                    search: "/opds/provider/tildes/search.xml",
                },
                title: "Hacker News",
            });
            feed.addEntries(this.FEEDS.map((entry) => {
                return {
                    title: entry.name,
                    id: `tildes-${entry.id}`,
                    link: `/opds/provider/tildes/${entry.id}`,
                    content: entry.description,
                };
            }));
            res.type('application/xml').send(feed.toXmlString());
        });
        // Search description document
        app.get(`/opds/provider/tildes/search.xml`, async (req, res) => {
            const searchDescription = new OpenSearchDescription('/opds/provider/tildes/search?q={searchTerms}');
            res.type('application/xml').send(searchDescription.toXmlString());
        });
        // Search handler
        app.get(`/opds/provider/tildes/search`, async (req, res) => {
            const feed = new OPDSFeed({
                id: `tildes-search`,
                links: {
                    self: `/opds/provider/tildes/search`,
                    start: "/opds",
                    up: "/opds/provider/tildes",
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
            const stories = await this.getStories(query);
            for (const story of stories) {
                if (story.url != null && story.title != null) {
                    feed.addArticleAcquisitionEntry(story.url, story.title);
                }
            }
            res.type('application/xml').send(feed.toXmlString());
        });
        // Acquisition feeds
        for (const entry of this.FEEDS) {
            app.get(`/opds/provider/tildes/${entry.id}`, async (req, res) => {
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
            });
        }
    }
    async getStories(query) {
        // Fetch stories
        if (process.env.VERBOSE) {
            console.log("Searching Tildes for articles");
        }
        let searchUrl = `https://tildes.net/`;
        if (query) {
            let queryString = querystring.stringify({ q: query, order: "votes" });
            searchUrl += `search?${queryString}`;
        }
        if (process.env.VERBOSE) {
            console.log("Fetching from:", searchUrl);
        }
        const response = await got(searchUrl).text();
        const virtualConsole = new jsdom.VirtualConsole();
        const dom = new jsdom.JSDOM(response, { url: searchUrl, virtualConsole });
        const document = dom.window.document;
        const nodeList = document.querySelectorAll(".topic");
        const topics = Array.from(nodeList);
        if (process.env.VERBOSE) {
            console.log(topics);
        }
        let results = topics
            .filter(topic => {
            let contentType = topic === null || topic === void 0 ? void 0 : topic.querySelector('.topic-content-type');
            if (process.env.VERBOSE) {
                console.log("Topic has contentType:", contentType);
            }
            return (contentType === null || contentType === void 0 ? void 0 : contentType.textContent) == 'Article';
        })
            .map(topic => {
            const a = topic.querySelector('h1.topic-title > a');
            const title = a.textContent;
            const url = a.getAttribute("href");
            return { title, url };
        });
        return results;
    }
}
