import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";

const URL_TYPE_OPDS = 'application/atom+xml;profile=opds-catalog;kind=acquisition';

export class OpenSearchDescription {
    description: XMLBuilder;
    constructor(template: string) {
        const now = (new Date()).toISOString();
        this.description = create()
        .ele('OpenSearchDescription', { xmlns: "http://www.w3.org/2005/Atom" })
        .ele('Url', { type: URL_TYPE_OPDS, template }).up();
    }
    toXmlString() {
        return this.description.doc().end({ prettyPrint: true });
    }
}
