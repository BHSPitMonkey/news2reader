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
    addGenericLinkEntry(properties: { id: string, title: string, linkHref: string, linkRel: string, linkType: string, content: string }) {
        this.feed.ele('entry')
        .ele('id').txt(properties.id).up()
        .ele('title').txt(properties.title).up()
        .ele('link', { rel: properties.linkRel, href: properties.linkHref, type: properties.linkType }).up()
        .ele('content', {type: 'text'}).txt(properties.content).up();
    }
    addEntries(entries: SubsectionEntryProperties[]) {
        for (const entry of entries) {
            this.addEntry(entry);
        }
    }
    addArticleAcquisitionEntry(url: string, title: string, summary?: string) {
      // URL param is base64-encoded for the EPUB conversion link,
      // to avoid misleading clients trying to detect type based on suffixes in that specific case.
      const queryString = querystring.stringify({ url: Buffer.from(url).toString('base64') });

      let href = url; // Default to original URL
      let type: string;

      // Default to EPUB conversion path and type
      let finalHref = `/content.epub?${queryString}`;
      let finalType = "application/epub+zip";

      try {
        const parsedUrl = new URL(url);
        const pathnameLower = parsedUrl.pathname.toLowerCase();

        if (pathnameLower.endsWith(".pdf")) {
          finalHref = url; // Use original URL for PDF
          finalType = "application/pdf";
        } else if (pathnameLower.endsWith(".epub")) {
          finalHref = url; // Use original URL for EPUB
          finalType = "application/epub+zip";
        }
        // If neither, it remains set for EPUB conversion (default above)
      } catch (e) {
        // Fallback for unparsable URLs or if robust check is not desired for some edge cases
        // This fallback maintains a simple, case-insensitive suffix check.
        console.warn(`URL parsing failed for type detection: ${url}. Falling back to simple suffix check.`, e);
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.endsWith(".pdf")) {
          finalHref = url;
          finalType = "application/pdf";
        } else if (lowerUrl.endsWith(".epub")) {
          finalHref = url;
          finalType = "application/epub+zip";
        }
        // If neither, it remains set for EPUB conversion (default above)
      }

      // Title cleanup
      let finalTitle = title.trim();
      if (finalTitle === "") {
        finalTitle = nameFromUrlPath(url);
      }

      this.feed.ele("entry")
        .ele("id").txt("foo").up() // Consider generating a more unique ID, e.g., based on URL
        .ele("title").txt(finalTitle).up()
        //.ele('updated').txt('2023-07-27T07:26:26.954Z').up()
        .ele("link", {
          rel: "http://opds-spec.org/acquisition",
          href: finalHref,
          type: finalType,
        }).up();

      if (summary && summary.trim() !== "") {
        this.feed.ele('summary', {type: 'text'}).txt(summary.trim()).up();
      }
    }
    toXmlString() {
        return this.feed.doc().end({ prettyPrint: true });
    }
}
