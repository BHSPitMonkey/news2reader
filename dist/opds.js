import querystring from "node:querystring";
import { create } from "xmlbuilder2";
const LINK_TYPE_NAVIGATION = 'application/atom+xml;profile=opds-catalog;kind=navigation';
export class OPDSFeed {
    constructor(properties) {
        const now = (new Date()).toISOString();
        this.feed = create()
            .ele('feed', { xmlns: "http://www.w3.org/2005/Atom" })
            .ele('id').txt(properties.id).up()
            .ele('title').txt(properties.title).up()
            .ele('updated').txt(now).up()
            .ele('link', { rel: 'self', href: properties.links.self, type: LINK_TYPE_NAVIGATION }).up()
            .ele('link', { rel: 'start', href: properties.links.start, type: LINK_TYPE_NAVIGATION }).up();
        if (typeof properties.links.up === "string") {
            this.feed.ele('link', { rel: 'up', href: properties.links.up, type: LINK_TYPE_NAVIGATION }).up();
        }
        if (typeof properties.author !== "undefined") {
            this.feed.ele('author')
                .ele('name').txt(properties.author.name).up()
                .ele('uri').txt(properties.author.uri).up()
                .up();
        }
    }
    addEntry(properties) {
        this.feed.ele('entry')
            .ele('id').txt(properties.id).up()
            .ele('title').txt(properties.title).up()
            .ele('link', { rel: 'subsection', href: properties.link, type: LINK_TYPE_NAVIGATION }).up()
            //.ele('updated').txt('2023-07-27T07:26:26.954Z').up()
            .ele('content', { type: 'text' }).txt(properties.content).up();
    }
    addEntries(entries) {
        for (const entry of entries) {
            this.addEntry(entry);
        }
    }
    addArticleAcquisitionEntry(url, title) {
        const queryString = querystring.stringify({ url });
        // Simplistic webpage vs PDF detection
        let href;
        let type;
        if (url.endsWith(".pdf")) {
            href = url;
            type = "application/pdf";
        }
        else {
            href = `/content.epub?${queryString}`;
            type = "application/epub+zip";
        }
        this.feed.ele("entry")
            .ele("id").txt("foo").up()
            .ele("title").txt(title).up()
            //.ele('updated').txt('2023-07-27T07:26:26.954Z').up()
            .ele("link", {
            rel: "http://opds-spec.org/acquisition",
            href,
            type,
        }).up();
    }
    toXmlString() {
        return this.feed.doc().end({ prettyPrint: true });
    }
}
