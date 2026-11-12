import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

// Freedom Farm News as RSS, linked from every page's <head>. Search Console
// also accepts it as a sitemap, so new posts are found quickly.
export async function GET(context) {
  const posts = (await getCollection('news')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
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
