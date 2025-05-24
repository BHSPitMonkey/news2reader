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
        // Since configuration is now on the main page, just provide a text entry.
        opdsFeed.addEntry({
          title: "Raindrop.io Not Configured",
          id: "raindrop:error:notconfigured",
          link: "/opds/provider/raindrop", // Link to self or a general info page
          content: "Raindrop.io is not configured. Please visit the main application page (/) to set it up.",
        });
      } else {
        try {
          const collections = await this.getCollections(); // This will now call the API

          if (collections.length > 0) {
            collections.forEach(collection => { // collection is FeedDescription here
              opdsFeed.addEntry({
                title: collection.name,
                id: `raindrop:${collection.id}`, 
                link: `/opds/provider/raindrop/${collection.id}`, // ID will be -1 for "All Items"
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
      // Map "all" from path to "-1" for API and internal consistency
      const effectiveFeedId = feedIdFromPath === "all" ? "-1" : feedIdFromPath;
      let collectionName = `Collection ${effectiveFeedId}`; // Default/fallback title

      if (this.isConnected()) {
        const collections = await this.getCollections(); // Fetches actual collections including "All Items" as "-1"
        const foundCollection = collections.find(c => c.id.toString() === effectiveFeedId);
        if (foundCollection) {
          collectionName = foundCollection.name;
        }
      } else if (effectiveFeedId === "-1") { 
          // If not connected, but it's the "all" feed, get name from static FEEDS
          const staticAllFeed = this.FEEDS.find(f => f.id === "all");
          if (staticAllFeed) {
            collectionName = staticAllFeed.name;
          }
      }

      const opdsFeed = new OPDSFeed({
        id: `raindrop:${effectiveFeedId}`,
        title: `Raindrop.io - ${collectionName}`,
        links: {
          self: `/opds/provider/raindrop/${feedIdFromPath}`, // Use original path param for self link
          start: "/opds",
          up: "/opds/provider/raindrop",
        },
      });

      if (!this.isConnected()) {
        opdsFeed.addEntry({
          title: "Not Connected to Raindrop.io",
          id: `raindrop:${effectiveFeedId}:error:notconnected`,
          link: `/opds/provider/raindrop/${feedIdFromPath}`,
          content: "Please configure the Raindrop.io provider.",
        });
      } else {
        try {
          const items = await this.getItemsInCollection(effectiveFeedId); // Use effectiveFeedId
          if (items.length === 0) {
            opdsFeed.addEntry({
              title: "No items found",
              id: `raindrop:${effectiveFeedId}:empty`,
              link: `/opds/provider/raindrop/${feedIdFromPath}`,
              content: `No items found in this Raindrop.io collection.`,
            });
          } else {
            items.forEach(item => {
              opdsFeed.addArticleAcquisitionEntry(item.url, item.title || nameFromUrlPath(item.url), item.description);
            });
          }
        } catch (error) {
          console.error(`Error fetching items for Raindrop collection ${effectiveFeedId}:`, error);
          opdsFeed.addEntry({
            title: "Error fetching items",
            id: `raindrop:${effectiveFeedId}:error:fetch`,
            link: `/opds/provider/raindrop/${feedIdFromPath}`,
            content: "Could not retrieve items from Raindrop.io.",
          });
        }
      }
      res.type("application/xml").send(opdsFeed.toXmlString());
    });

    console.log("RaindropProvider routes registered.");
  }

  public isConnected(): boolean {
    // Checks if an access token is present.
    return !!this.accessToken;
  }

  // Method to set token (e.g., after OAuth or from config)
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
            id: "-1", // Raindrop API uses -1 for "All bookmarks"
            name: allItemsFeedInfo.name,
            description: allItemsFeedInfo.description,
        });
      }
      // TODO: Optionally add "Unsorted" (collectionId 0) or other system collections if desired.
      return collections;
    } catch (error) {
      console.error("Error fetching Raindrop.io collections:", error);
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.error("Raindrop.io: Unauthorized. Token might be invalid or expired.");
      }
      return [];
    }
  }

  private async getItemsInCollection(collectionId: string): Promise<Array<{id: string, title: string, url: string, description?: string}>> {
    if (!this.isConnected() || !this.accessToken) {
      console.warn(`Raindrop.io: Not connected, cannot fetch items for collection ${collectionId}.`);
      return [];
    }

    // The 'all' ID from FEEDS/routes maps to Raindrop's special collection ID -1
    // Other IDs are expected to be numeric strings.
    const numericCollectionId = collectionId === "all" ? "-1" : collectionId;

    try {
      console.log(`Fetching items for collection ${numericCollectionId} from Raindrop.io API`);
      const response = await axios.get<{ items: RaindropItem[] }>(
        `${RAINDROP_API_BASE_URL}/raindrops/${numericCollectionId}`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );

      return response.data.items.map(item => ({
        id: item._id.toString(),
        title: item.title || nameFromUrlPath(item.link),
        url: item.link,
        description: item.excerpt || "",
      }));
    } catch (error) {
      console.error(`Error fetching Raindrop.io items for collection ${numericCollectionId}:`, error);
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.error("Raindrop.io: Unauthorized. Token might be invalid or expired.");
      }
      return [];
    }
  }

  // OAuth methods are more involved and would be implemented later.
  // public async handleOAuthCallback(req: Request, res: Response): Promise<void> { /* ... */ }
  // public getOAuthUrl(): string { /* ... */ }
}
