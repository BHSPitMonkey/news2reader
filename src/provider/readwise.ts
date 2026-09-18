import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import got from "got";
import { Express, Request, Response } from "express";
import { OPDSFeed } from "../opds.js";
import { htmlToEpub } from "../epub.js";

/**
 * Readwise Reader provider.
 *
 * Exposes your Readwise Reader library as OPDS feeds (one per "location":
 * new / later / shortlist / feed / archive) and converts each document to an
 * EPUB on demand using the document's own `html_content` from the Reader API
 * (so paywalled articles, newsletters, and reader-mode cleanups survive).
 *
 * Auth: set READWISE_TOKEN to a Readwise access token (https://readwise.io/access_token).
 *
 * Images (READWISE_IMAGES):
 *   keep       (default) embed images as-is.
 *   strip                remove images entirely (smallest, fastest).
 *   transcode            fetch each image and re-encode to JPEG (via sharp),
 *                        downscaled to READWISE_IMG_MAX_WIDTH. Use this for
 *                        e-ink readers (e.g. Crosspoint) that can't decode webp.
 *
 * Reader API: https://readwise.io/reader_api  (GET /api/v3/list/, 20 req/min).
 */

interface ReaderDocument {
  id: string;
  url?: string;
  source_url?: string;
  title?: string;
  author?: string;
  source?: string;
  site_name?: string;
  category?: string;
  location?: string;
  word_count?: number;
  created_at?: string;
  updated_at?: string;
  published_date?: number | string | null;
  summary?: string;
  html_content?: string;
  reading_progress?: number;
}

interface ReaderListResponse {
  count: number;
  nextPageCursor?: string | null;
  results: ReaderDocument[];
}

interface FeedDescription {
  name: string;
  id: string; // also the Reader `location` value
  description: string;
}

type ImageMode = "keep" | "strip" | "transcode";

const IMG_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export default class ReadwiseProvider {
  public readonly BASE_URL = process.env.READWISE_BASE_URL ?? "https://readwise.io";
  private readonly TOKEN = process.env.READWISE_TOKEN ?? null;
  private readonly PORT = String(process.env.PORT ?? "8080");

  private readonly MAX_PAGES = Number(process.env.READWISE_MAX_PAGES ?? 3);
  private readonly LIST_TTL_MS = Number(process.env.READWISE_LIST_TTL_MS ?? 60_000);
  private listCache: Map<string, { fetchedAt: number; docs: ReaderDocument[] }> = new Map();

  // Image transcoding
  private readonly IMG_MAX_WIDTH = Number(process.env.READWISE_IMG_MAX_WIDTH ?? 1000);
  private readonly IMG_QUALITY = Number(process.env.READWISE_IMG_QUALITY ?? 80);
  // e-ink displays are grayscale; pre-converting (with contrast normalization)
  // renders cleaner than letting the device reduce a color image itself.
  private readonly IMG_GRAYSCALE = (process.env.READWISE_IMG_GRAYSCALE ?? "1") !== "0";
  private placeholderJpeg: Buffer | null = null;
  private sharpModule: any = null;

  // Number of live EPUB downloads in flight; background warming yields to these.
  private liveDownloads = 0;

  // Background cache warming (so cold-build latency never hits a reader's
  // download timeout): pre-build the top N docs of a feed when it's opened.
  private readonly WARM_COUNT = Number(process.env.READWISE_WARM_COUNT ?? 8);
  private readonly WARM_INTERVAL_MS = Number(process.env.READWISE_WARM_INTERVAL_MS ?? 4000);
  private warmQueue: string[] = [];
  private warmSet: Set<string> = new Set();
  private warming = false;

  private readonly cacheDir: string;

  private readonly FEEDS: FeedDescription[] = [
    { name: "Inbox (New)", id: "new", description: "Unread items in your Readwise Reader inbox" },
    { name: "Later", id: "later", description: "Items saved for later" },
    { name: "Shortlist", id: "shortlist", description: "Your shortlisted items" },
    { name: "Feed", id: "feed", description: "Items from your Reader feeds" },
    { name: "Archive", id: "archive", description: "Archived items" },
  ];

  public constructor(app: Express, configDir: string) {
    this.cacheDir = path.join(configDir, "readwise-epub-cache");
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.registerRoutes(app);
  }

  public isConnected() {
    return typeof this.TOKEN === "string" && this.TOKEN.length > 0;
  }

  private imageMode(): ImageMode {
    const m = (process.env.READWISE_IMAGES ?? "keep").toLowerCase();
    return m === "strip" || m === "transcode" ? m : "keep";
  }

  private authHeaders() {
    return { Accept: "application/json", Authorization: `Token ${this.TOKEN}` };
  }

  private cachePathFor(id: string) {
    return path.join(this.cacheDir, `readwise-${sanitizeId(id)}.epub`);
  }

  private registerRoutes(app: Express) {
    // Navigation feed: the per-location sub-feeds
    app.get("/opds/provider/readwise", (req: Request, res: Response) => {
      const feed = new OPDSFeed({
        id: "readwise",
        links: { self: "/opds/provider/readwise", start: "/opds", up: "/opds" },
        title: "Readwise Reader",
      });
      feed.addEntries(
        this.FEEDS.map((entry) => ({
          title: entry.name,
          id: `readwise-${entry.id}`,
          link: `/opds/provider/readwise/${entry.id}`,
          content: entry.description,
        }))
      );
      res.type("application/xml").send(feed.toXmlString());
    });

    // Acquisition feeds (one per location)
    for (const entry of this.FEEDS) {
      app.get(`/opds/provider/readwise/${entry.id}`, async (req: Request, res: Response) => {
        if (!this.isConnected()) {
          res.status(401).send("Readwise is not configured. Set READWISE_TOKEN.");
          return;
        }
        const feed = new OPDSFeed({
          id: `readwise-${entry.id}`,
          links: {
            self: `/opds/provider/readwise/${entry.id}`,
            start: "/opds",
            up: "/opds/provider/readwise",
          },
          title: `Readwise — ${entry.name}`,
        });
        try {
          const docs = await this.getDocuments(entry.id);
          for (const doc of docs) {
            const title = doc.title?.trim() || doc.url || "Untitled";
            feed.addAcquisitionEntry({
              id: `readwise:${doc.id}`,
              title,
              href: `/opds/provider/readwise/content.epub?id=${encodeURIComponent(doc.id)}`,
              author: doc.author || doc.site_name || undefined,
              summary: doc.summary || undefined,
              updated: doc.updated_at || undefined,
            });
          }
          // Warm the top of the feed in the background (skip in strip mode,
          // where builds are already instant).
          if (this.imageMode() !== "strip") {
            this.enqueueWarm(docs.slice(0, this.WARM_COUNT).map((d) => d.id));
          }
        } catch (e) {
          console.error("Readwise: failed to list documents", e);
          res.status(502).send("Failed to fetch documents from Readwise");
          return;
        }
        res.type("application/xml").send(feed.toXmlString());
      });
    }

    // On-demand EPUB for a single document
    app.get("/opds/provider/readwise/content.epub", async (req: Request, res: Response) => {
      if (!this.isConnected()) {
        res.status(401).send("Readwise is not configured. Set READWISE_TOKEN.");
        return;
      }
      const id = req.query.id;
      if (typeof id !== "string" || id.length === 0) {
        res.status(400).send("Missing document id");
        return;
      }
      // Mark a live download so background warming backs off and this request
      // (cached or cold) gets priority.
      this.liveDownloads++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          this.liveDownloads = Math.max(0, this.liveDownloads - 1);
        }
      };
      res.on("finish", release);
      res.on("close", release);
      try {
        const epubPath = await this.documentToEpub(id);
        res.type("application/epub+zip").sendFile(epubPath);
      } catch (e) {
        console.error(`Readwise: failed to build EPUB for ${id}`, e);
        res.status(404).send("Could not retrieve this document");
        release();
      }
    });

    // Image transcoding proxy (used by transcode mode). epub-gen fetches the
    // rewritten <img src> (which ends in `.jpg`) from here; we fetch the
    // original image and return a downscaled JPEG that e-ink readers can decode.
    app.get("/opds/provider/readwise/img/:file", async (req: Request, res: Response) => {
      const file = String(req.params.file ?? "");
      const b64 = file.replace(/\.jpe?g$/i, "");
      let src = "";
      try {
        src = Buffer.from(b64, "base64url").toString("utf8");
      } catch {
        /* fall through to placeholder */
      }
      if (!/^https?:\/\//i.test(src)) {
        res.type("image/jpeg").send(await this.getPlaceholder());
        return;
      }
      try {
        const sharp = await this.getSharp();
        const resp = await got(src, {
          responseType: "buffer",
          timeout: { request: 20_000 },
          retry: { limit: 1 },
          headers: { "user-agent": IMG_UA, accept: "image/*,*/*" },
        });
        let pipe = sharp(resp.body, { animated: false, failOn: "none" })
          .rotate()
          .resize({ width: this.IMG_MAX_WIDTH, withoutEnlargement: true });
        if (this.IMG_GRAYSCALE) {
          // Grayscale + contrast stretch reads better on e-ink than a color
          // image the device has to reduce itself. toColourspace("b-w") emits a
          // true single-channel JPEG (smaller, no color subsampling artifacts).
          pipe = pipe.grayscale().normalise().toColourspace("b-w");
        }
        const out = await pipe.jpeg({ quality: this.IMG_QUALITY, mozjpeg: true }).toBuffer();
        res.type("image/jpeg").send(out);
      } catch (e) {
        // Return a placeholder rather than erroring, so the EPUB stays valid.
        console.warn("Readwise img transcode failed:", src, (e as Error).message);
        res.type("image/jpeg").send(await this.getPlaceholder());
      }
    });
  }

  /** Fetch documents for a location, paging up to MAX_PAGES, with a short cache. */
  private async getDocuments(location: string): Promise<ReaderDocument[]> {
    const cached = this.listCache.get(location);
    if (cached && Date.now() - cached.fetchedAt < this.LIST_TTL_MS) {
      return cached.docs;
    }
    const docs: ReaderDocument[] = [];
    let pageCursor: string | undefined;
    for (let page = 0; page < this.MAX_PAGES; page++) {
      const searchParams: Record<string, string> = { location, withHtmlContent: "false" };
      if (pageCursor) searchParams.pageCursor = pageCursor;
      const data = (await got
        .get(`${this.BASE_URL}/api/v3/list/`, { headers: this.authHeaders(), searchParams })
        .json()) as ReaderListResponse;
      if (process.env.VERBOSE) {
        console.log(`Readwise list [${location}] page ${page}: ${data.results?.length ?? 0} docs`);
      }
      docs.push(...(data.results ?? []));
      pageCursor = data.nextPageCursor ?? undefined;
      if (!pageCursor) break;
    }
    this.listCache.set(location, { fetchedAt: Date.now(), docs });
    return docs;
  }

  /** Fetch a single document with html_content and build (or reuse) its EPUB. */
  private async documentToEpub(id: string): Promise<string> {
    const outputPath = this.cachePathFor(id);
    if (fs.existsSync(outputPath)) return outputPath;

    const data = (await got
      .get(`${this.BASE_URL}/api/v3/list/`, {
        headers: this.authHeaders(),
        searchParams: { id, withHtmlContent: "true" },
      })
      .json()) as ReaderListResponse;

    const doc = data.results?.[0];
    if (!doc) throw new Error(`Document ${id} not found`);

    let html =
      doc.html_content && doc.html_content.trim().length > 0
        ? doc.html_content
        : `<h1>${escapeHtml(doc.title ?? "Untitled")}</h1>` +
          (doc.summary ? `<p>${escapeHtml(doc.summary)}</p>` : "") +
          (doc.url ? `<p><a href="${escapeHtml(doc.url)}">${escapeHtml(doc.url)}</a></p>` : "");

    const mode = this.imageMode();
    if (mode === "strip") html = stripImages(html);
    else if (mode === "transcode") html = this.rewriteImagesToProxy(html);

    return htmlToEpub({
      html,
      title: doc.title?.trim() || doc.url || "Untitled",
      author: doc.author || doc.site_name || null,
      publisher: doc.site_name || (doc.url ? hostOf(doc.url) : null),
      outputPath,
    });
  }

  /** Rewrite <img> sources to the transcoding proxy (ending in `.jpg`). */
  private rewriteImagesToProxy(html: string): string {
    html = html.replace(/<source\b[^>]*>/gi, "").replace(/<\/?picture\b[^>]*>/gi, "");
    const proxyBase = `http://127.0.0.1:${this.PORT}/opds/provider/readwise/img`;
    return html.replace(/<img\b[^>]*>/gi, (tag) => {
      const t = tag.replace(/\bsrcset\s*=\s*("[^"]*"|'[^']*')/gi, "");
      const m = t.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i);
      const src = m ? m[2] ?? m[3] : undefined;
      if (!src || !/^https?:\/\//i.test(src)) return t;
      const enc = Buffer.from(src, "utf8").toString("base64url");
      return t.replace(m![0], `src="${proxyBase}/${enc}.jpg"`);
    });
  }

  /** Lazy-load sharp and pin its thread pool to 1 so warming can't hog the CPU. */
  private async getSharp(): Promise<any> {
    if (!this.sharpModule) {
      const s = (await import("sharp")).default;
      try {
        s.concurrency(1);
      } catch {
        /* older sharp: ignore */
      }
      this.sharpModule = s;
    }
    return this.sharpModule;
  }

  private async getPlaceholder(): Promise<Buffer> {
    if (this.placeholderJpeg) return this.placeholderJpeg;
    const sharp = await this.getSharp();
    const buf: Buffer = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
    this.placeholderJpeg = buf;
    return buf;
  }

  // ---- Background cache warming ----

  private enqueueWarm(ids: string[]) {
    for (const id of ids) {
      if (this.warmSet.has(id)) continue;
      if (fs.existsSync(this.cachePathFor(id))) continue;
      this.warmSet.add(id);
      this.warmQueue.push(id);
    }
    void this.runWarm();
  }

  private async runWarm() {
    if (this.warming) return;
    this.warming = true;
    try {
      while (this.warmQueue.length) {
        // Yield to any live download so the user's tap is never starved.
        while (this.liveDownloads > 0) await sleep(500);
        const id = this.warmQueue.shift()!;
        this.warmSet.delete(id);
        try {
          if (!fs.existsSync(this.cachePathFor(id))) {
            await this.documentToEpub(id);
            if (process.env.VERBOSE) console.log(`Readwise warm: cached ${id}`);
          }
        } catch (e) {
          console.warn(`Readwise warm failed for ${id}:`, (e as Error).message);
        }
        if (this.warmQueue.length) await sleep(this.WARM_INTERVAL_MS);
      }
    } finally {
      this.warming = false;
    }
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function stripImages(html: string): string {
  return html
    .replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<source\b[^>]*>/gi, "");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
