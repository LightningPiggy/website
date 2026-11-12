import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

// Freedom Farm News as RSS, linked from every page's <head>. Search Console
// also accepts it as a sitemap, so new posts are found quickly.
export async function GET(context) {
  // Posts with a description only (one without is a page kept for its old
  // address); newest first, same-day posts by slug as on /news/
  const posts = (await getCollection('news'))
    .filter((p) => p.data.description)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf() || b.data.slug.localeCompare(a.data.slug));
  return rss({
    title: 'Lightning Piggy: Freedom Farm News',
    description: 'News, firmware release notes and appearances from Lightning Piggy, the open source Bitcoin piggy bank for families.',
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/news/${post.data.slug}/`,
      categories: post.data.tags,
    })),
    customData: '<language>en-gb</language>',
  });
}
