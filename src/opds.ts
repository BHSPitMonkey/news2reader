import querystring from "node:querystring";
import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import { nameFromUrlPath } from "./util.js";

const LINK_TYPE_NAVIGATION = 'application/atom+xml;profile=opds-catalog;kind=navigation';
const LINK_TYPE_SEARCH = 'application/opensearchdescription+xml';

interface FeedProperties {
    id: string;
    links: { self: string; start: string; up?: string; search?: string };
    title: string;
    author?: { name: string; uri: string };
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
        .ele('link', { rel: 'self', href: properties.links.self, type: LINK_TYPE_NAVIGATION }).up()
        .ele('link', { rel: 'start', href: properties.links.start, type: LINK_TYPE_NAVIGATION }).up();

        if (properties.links.up) {
            this.feed.ele('link', { rel: 'up', href: properties.links.up, type: LINK_TYPE_NAVIGATION }).up();
        }

        if (properties.links.search) {
            this.feed.ele('link', { rel: 'search', href: properties.links.search, type: LINK_TYPE_SEARCH }).up();
        }

        if (typeof properties.author !== "undefined") {
            this.feed.ele('author')
            .ele('name').txt(properties.author.name).up()
            .ele('uri').txt(properties.author.uri).up()
          .up();
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
    addArticleAcquisitionEntry(url: string, title: string) {
      // URL param is base64-encoded to avoid misleading clients trying to detect type based on suffixes
      const queryString = querystring.stringify({ url: Buffer.from(url).toString('base64') });

      // Simplistic PDF/EPUB detection (skip conversion when URL ends in these extensions)
      // FIXME: Better way? Make HEAD request to URL first?
      let href = url;
      let type: string;
      if (url.endsWith(".pdf")) {
        type = "application/pdf";
      } else if (url.endsWith(".epub")) {
        type = "application/epub+zip";
      } else {
        href = `/content.epub?${queryString}`;
        type = "application/epub+zip";
      }

      // Title cleanup
      let finalTitle = title.trim();
      if (finalTitle === "") {
        finalTitle = nameFromUrlPath(url);
      }

      this.feed.ele("entry")
        .ele("id").txt("foo").up()
        .ele("title").txt(finalTitle).up()
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
