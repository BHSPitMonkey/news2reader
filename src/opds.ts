import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";

const LINK_TYPE_NAVIGATION = 'application/atom+xml;profile=opds-catalog;kind=navigation';

interface FeedProperties {
    id: string;
    links: { self: string; start: string; up?: string };
    title: string;
    author: { name: string; uri: string };
}
interface SubsectionEntryProperties {
    id: string,
    title: string,
    link: string,
    content: string,
}

export class OPDSFeed {
    feed: XMLBuilder;
    constructor(properties: FeedProperties) {
        const now = (new Date()).toISOString();
        this.feed = create()
        .ele('feed', { xmlns: "http://www.w3.org/2005/Atom" })
        .ele('id').txt(properties.id).up()
        .ele('title').txt(properties.title).up()
        .ele('updated').txt(now).up()
        .ele('author')
          .ele('name').txt(properties.author.name).up()
          .ele('uri').txt(properties.author.uri).up()
        .up()
        .ele('link', { rel: 'self', href: properties.links.self, type: LINK_TYPE_NAVIGATION }).up()
        .ele('link', { rel: 'start', href: properties.links.start, type: LINK_TYPE_NAVIGATION }).up();

        if (typeof properties.links.up === "string") {
            this.feed.ele('link', { rel: 'up', href: properties.links.up, type: LINK_TYPE_NAVIGATION }).up();
        }
    }
    addEntry(properties: SubsectionEntryProperties) {
        this.feed.ele('entry')
        .ele('id').txt(properties.id).up()
        .ele('title').txt(properties.title).up()
        .ele('link', { rel: 'subsection', href: properties.link, type: LINK_TYPE_NAVIGATION }).up()
        //.ele('updated').txt('2023-07-27T07:26:26.954Z').up()
        .ele('content', {type: 'text'}).txt(properties.content).up();      
    }
    addEntries(entries: SubsectionEntryProperties[]) {
        for (const entry of entries) {
            this.addEntry(entry);
        }
    }
    toXmlString() {
        return this.feed.doc().end({ prettyPrint: true });
    }
}
