import express, { Express, Request, Response } from "express"; // Import express itself for urlencoded
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { OPDSFeed } from "../opds.js";
import { nameFromUrlPath } from "../util.js";

// Interfaces for Raindrop API responses
interface RaindropCollection {
  _id: number;
  title: string;
  count?: number;
}

interface RaindropItem {
  _id: number;
  title: string;
  link: string;
  excerpt?: string;
  tags?: string[];
  created?: string;
  lastUpdate?: string;
}

interface FeedDescription {
  name: string;
  id: string;
  description: string;
  // searchParams?: any; // Example property
}

const RAINDROP_API_BASE_URL = "https://api.raindrop.io/rest/v1";
const OPDS_ACQUISITION_LINK_TYPE = "application/atom+xml;profile=opds-catalog;kind=acquisition";

export default class RaindropProvider {
  private accessToken: string | null = null;
  private authConfigPath: string;

  private readonly FEEDS: FeedDescription[] = [
    {
      name: "All Items",
      id: "all",
      description: "All items from Raindrop.io",
    },
  ];

  public constructor(app: Express, configDir: string) {
    console.log(`RaindropProvider initialized, config directory: ${configDir}`);
    this.authConfigPath = path.join(configDir, 'raindrop_token.txt');
    this.loadAccessToken();
    this.registerRoutes(app);
  }

  private loadAccessToken(): void {
    if (fs.existsSync(this.authConfigPath)) {
      const token = fs.readFileSync(this.authConfigPath, 'utf-8').trim();
      if (token) {
        this.accessToken = token;
        console.log("Raindrop.io access token loaded from config.");
      }
    }
  }

  private registerRoutes(app: Express): void {
    app.get("/opds/provider/raindrop", async (req: Request, res: Response) => {
      const opdsFeed = new OPDSFeed({
        id: "raindrop-provider",
        title: "Raindrop.io",
        links: {
          self: "/opds/provider/raindrop",
          start: "/opds", // Assuming /opds is the main catalog start
        },
      });

      if (!this.isConnected()) {
        opdsFeed.addEntry({
          title: "Raindrop.io Not Configured",
          id: "raindrop:error:notconfigured",
          link: "/opds/provider/raindrop", 
          content: "Raindrop.io is not configured. Please visit the main application page (/) to set it up.",
        });
      } else {
        try {
          const collections = await this.getCollections(); 

          if (collections.length > 0) {
            collections.forEach(collection => { 
              opdsFeed.addEntry({
                title: collection.name,
                id: `raindrop:${collection.id}`, 
                link: `/opds/provider/raindrop/${collection.id}`, 
                content: collection.description || `Items from ${collection.name}`,
              });
            });
          } else {
            opdsFeed.addEntry({
              title: "No collections found",
              id: "raindrop:empty",
              link: "/opds/provider/raindrop",
              content: "No collections available in Raindrop.io or provider not fully configured.",
            });
          }
        } catch (error) {
          console.error("Error fetching Raindrop.io collections:", error);
          opdsFeed.addEntry({
            title: "Error fetching collections",
            id: "raindrop:error:fetchcollections",
            link: "/opds/provider/raindrop",
            content: "Could not retrieve collections from Raindrop.io.",
          });
        }
      }
      res.type("application/xml").send(opdsFeed.toXmlString());
    });

    app.get("/opds/provider/raindrop/:feedId", async (req: Request, res: Response) => {
      const feedIdFromPath = req.params.feedId;
      const effectiveFeedId = feedIdFromPath === "all" ? "-1" : feedIdFromPath;
      const currentPage = parseInt(req.query.page as string, 10) || 0; // 0-indexed
      const itemsPerPage = 25; // Items per OPDS page

      let collectionName = `Collection ${effectiveFeedId}`; 

      if (this.isConnected()) {
        const collections = await this.getCollections(); 
        const foundCollection = collections.find(c => c.id.toString() === effectiveFeedId);
        if (foundCollection) {
          collectionName = foundCollection.name;
        }
      } else if (effectiveFeedId === "-1") { 
          const staticAllFeed = this.FEEDS.find(f => f.id === "all");
          if (staticAllFeed) {
            collectionName = staticAllFeed.name;
          }
      }
      
      let selfLink = `/opds/provider/raindrop/${feedIdFromPath}`;
      if (currentPage > 0) {
        selfLink += `?page=${currentPage}`;
      }

      const opdsFeed = new OPDSFeed({
        id: `raindrop:${effectiveFeedId}`, // The ID of the feed itself doesn't change with page
        title: `Raindrop.io - ${collectionName}${currentPage > 0 ? ` (Page ${currentPage + 1})` : ''}`,
        links: {
          self: selfLink,
          start: "/opds",
          up: "/opds/provider/raindrop",
        },
      });

      if (!this.isConnected()) {
        opdsFeed.addEntry({
          title: "Not Connected to Raindrop.io",
          id: `raindrop:${effectiveFeedId}:error:notconnected`,
          link: selfLink, // Link to current page view
          content: "Please configure the Raindrop.io provider.",
        });
      } else {
        try {
          const { items, hasMoreUpstream } = await this.getItemsInCollection(effectiveFeedId, currentPage, itemsPerPage);
          
          if (items.length === 0 && currentPage === 0) { // Only show "no items" if it's the first page and truly empty
            opdsFeed.addEntry({
              title: "No items found",
              id: `raindrop:${effectiveFeedId}:empty`,
              link: selfLink,
              content: `No items found in this Raindrop.io collection.`,
            });
          } else {
            items.forEach(item => {
              // Assuming addArticleAcquisitionEntry exists on OPDSFeed
              opdsFeed.addArticleAcquisitionEntry(item.url, item.title || nameFromUrlPath(item.url), item.description);
            });

            // Add pagination links
            if (hasMoreUpstream) {
              opdsFeed.feed.ele('link', { 
                rel: 'next', 
                href: `/opds/provider/raindrop/${feedIdFromPath}?page=${currentPage + 1}`, 
                type: OPDS_ACQUISITION_LINK_TYPE 
              }).up();
            }
            if (currentPage > 0) {
              const prevPageQuery = currentPage - 1 === 0 ? '' : `?page=${currentPage - 1}`;
              opdsFeed.feed.ele('link', { 
                rel: 'previous', 
                href: `/opds/provider/raindrop/${feedIdFromPath}${prevPageQuery}`, 
                type: OPDS_ACQUISITION_LINK_TYPE 
              }).up();
            }
          }
        } catch (error) {
          console.error(`Error fetching items for Raindrop collection ${effectiveFeedId}, page ${currentPage}:`, error);
          opdsFeed.addEntry({
            title: "Error fetching items",
            id: `raindrop:${effectiveFeedId}:error:fetch:page${currentPage}`,
            link: selfLink,
            content: "Could not retrieve items from Raindrop.io.",
          });
        }
      }
      res.type("application/xml").send(opdsFeed.toXmlString());
    });

    console.log("RaindropProvider routes registered.");
  }

  public isConnected(): boolean {
    return !!this.accessToken;
  }

  public setAccessToken(token: string): void {
    this.accessToken = token;
    try {
      fs.writeFileSync(this.authConfigPath, token, 'utf-8');
      console.log("Raindrop.io access token saved.");
    } catch (error) {
      console.error("Error saving Raindrop.io access token:", error);
    }
  }

  private async getCollections(): Promise<FeedDescription[]> {
    if (!this.isConnected() || !this.accessToken) {
      console.warn("Raindrop.io: Not connected, cannot fetch collections.");
      return [];
    }

    try {
      console.log("Fetching collections from Raindrop.io API");
      const response = await axios.get<{ items: RaindropCollection[] }>(
        `${RAINDROP_API_BASE_URL}/collections`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );

      const collections: FeedDescription[] = response.data.items.map(collection => ({
        id: collection._id.toString(),
        name: collection.title,
        description: `Collection: ${collection.title}${collection.count ? ` (${collection.count} items)` : ''}`,
      }));
      
      const allItemsFeedInfo = this.FEEDS.find(f => f.id === "all");
      if (allItemsFeedInfo) {
        collections.unshift({
            id: "-1", 
            name: allItemsFeedInfo.name,
            description: allItemsFeedInfo.description,
        });
      }
      return collections;
    } catch (error) {
      console.error("Error fetching Raindrop.io collections:", error);
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.error("Raindrop.io: Unauthorized. Token might be invalid or expired.");
      }
      return [];
    }
  }

  private async getItemsInCollection(
    collectionId: string, 
    page: number, // 0-indexed page for Raindrop API
    perPage: number // items per page to request from Raindrop
  ): Promise<{ 
    items: Array<{id: string, title: string, url: string, description?: string}>, 
    hasMoreUpstream: boolean 
  }> {
    if (!this.isConnected() || !this.accessToken) {
      console.warn(`Raindrop.io: Not connected, cannot fetch items for collection ${collectionId}.`);
      return { items: [], hasMoreUpstream: false };
    }

    const numericCollectionId = collectionId === "all" ? "-1" : collectionId;

    try {
      console.log(`Fetching items for collection ${numericCollectionId} from Raindrop.io API (page ${page}, perPage ${perPage})`);
      const response = await axios.get<{ items: RaindropItem[] }>(
        `${RAINDROP_API_BASE_URL}/raindrops/${numericCollectionId}?page=${page}&perpage=${perPage}`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );

      const fetchedRaindropItems = response.data.items || [];
      const mappedItems = fetchedRaindropItems.map(item => ({
        id: item._id.toString(),
        title: item.title || nameFromUrlPath(item.link),
        url: item.link,
        description: item.excerpt || "",
      }));

      return {
        items: mappedItems,
        hasMoreUpstream: fetchedRaindropItems.length === perPage,
      };
    } catch (error) {
      console.error(`Error fetching Raindrop.io items for collection ${numericCollectionId}, page ${page}:`, error);
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.error("Raindrop.io: Unauthorized. Token might be invalid or expired.");
      }
      return { items: [], hasMoreUpstream: false }; 
    }
  }
}
