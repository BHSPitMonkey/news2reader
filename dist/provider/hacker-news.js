import got from "got";
export async function getHackerNewsStories() {
    // Fetch stories
    const maxStories = 15;
    const response = await got("http://hn.algolia.com/api/v1/search?tags=story,front_page").json();
    console.log(response);
    let results = response.hits
        .sort((a, b) => {
        let comparison = 0;
        if (a.points > b.points) {
            comparison = 1;
        }
        else if (a.points < b.points) {
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
