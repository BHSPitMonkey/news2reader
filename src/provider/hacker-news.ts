import got from "got";

interface HNSearchHit {
  author: string;
  created_at: string;
  objectId: string;
  points: number;
  title: string;
  url: string;
  _tags: string[];
}
interface HNSearchResults {
  hits: HNSearchHit[];
  hitsPerPage: number;
  nbHits: number;
  nbPages: number;
  page: number;
}

export async function getHackerNewsStories() {
  // Fetch stories
  const maxStories = 15;

  const response = await got(
    "http://hn.algolia.com/api/v1/search?tags=story,front_page"
  ).json() as HNSearchResults;
  console.log(response);
  let results = response.hits
  .sort((a, b) => {
    let comparison = 0;
    if (a.points > b.points) {
      comparison = 1;
    } else if (a.points < b.points) {
      comparison = -1;
    }
    return comparison;
  })
  .slice(0, maxStories)
  .map((hit) => {
    return { title: hit.title, url: hit.url };
  });
  console.log(results);
  return results;
}

export default class HackerNewsProvider {
    
}