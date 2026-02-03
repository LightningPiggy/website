#!/usr/bin/env python3
"""
Convert Ghost JSON export to Astro Markdown files.
"""

import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from html.parser import HTMLParser


class HTMLToMarkdown(HTMLParser):
    """Convert HTML to Markdown."""

    def __init__(self):
        super().__init__()
        self.output = []
        self.list_stack = []
        self.in_code_block = False
        self.code_language = ''
        self.current_link = None
        self.in_figcaption = False
        self.skip_content = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        if tag == 'p':
            pass  # Will add newlines on end
        elif tag == 'br':
            self.output.append('  \n')
        elif tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            level = int(tag[1])
            self.output.append('\n' + '#' * level + ' ')
        elif tag == 'strong' or tag == 'b':
            self.output.append('**')
        elif tag == 'em' or tag == 'i':
            self.output.append('*')
        elif tag == 'a':
            href = attrs_dict.get('href', '')
            # Convert internal Ghost URLs to relative paths
            href = href.replace('__GHOST_URL__/', '/blog/')
            # Clean up double slashes that might result from root links
            href = href.replace('/blog//', '/blog/')
            # Handle root URL case
            if href == '/blog/':
                href = '/'
            self.current_link = href
            self.output.append('[')
        elif tag == 'img':
            src = attrs_dict.get('src', '')
            alt = attrs_dict.get('alt', '')
            # Convert Ghost URL placeholder
            src = src.replace('__GHOST_URL__/content/images/', '/images/')
            self.output.append(f'![{alt}]({src})')
        elif tag == 'ul':
            self.list_stack.append('ul')
            self.output.append('\n')
        elif tag == 'ol':
            self.list_stack.append(('ol', 0))
            self.output.append('\n')
        elif tag == 'li':
            indent = '  ' * (len(self.list_stack) - 1)
            if self.list_stack:
                list_type = self.list_stack[-1]
                if list_type == 'ul':
                    self.output.append(f'{indent}- ')
                else:
                    # Ordered list
                    _, count = list_type
                    count += 1
                    self.list_stack[-1] = ('ol', count)
                    self.output.append(f'{indent}{count}. ')
        elif tag == 'blockquote':
            self.output.append('\n> ')
        elif tag == 'pre':
            self.in_code_block = True
            self.output.append('\n```')
        elif tag == 'code':
            if not self.in_code_block:
                self.output.append('`')
            else:
                # Check for language class
                class_attr = attrs_dict.get('class', '')
                if 'language-' in class_attr:
                    lang = class_attr.replace('language-', '')
                    self.output.append(lang)
                self.output.append('\n')
        elif tag == 'figure':
            pass
        elif tag == 'figcaption':
            self.in_figcaption = True
            self.output.append('\n*')
        elif tag == 'hr':
            self.output.append('\n---\n')
        elif tag == 'iframe':
            src = attrs_dict.get('src', '')
            self.output.append(f'\n[Embedded content]({src})\n')
        elif tag == 'video':
            src = attrs_dict.get('src', '')
            if src:
                src = src.replace('__GHOST_URL__/content/', '/')
                self.output.append(f'\n<video src="{src}" controls></video>\n')
        elif tag == 'source':
            src = attrs_dict.get('src', '')
            if src:
                src = src.replace('__GHOST_URL__/content/', '/')
                self.output.append(f'\n<video src="{src}" controls></video>\n')

    def handle_endtag(self, tag):
        if tag == 'p':
            self.output.append('\n\n')
        elif tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.output.append('\n\n')
        elif tag == 'strong' or tag == 'b':
            self.output.append('**')
        elif tag == 'em' or tag == 'i':
            self.output.append('*')
        elif tag == 'a':
            self.output.append(f']({self.current_link})')
            self.current_link = None
        elif tag == 'ul':
            if self.list_stack:
                self.list_stack.pop()
            self.output.append('\n')
        elif tag == 'ol':
            if self.list_stack:
                self.list_stack.pop()
            self.output.append('\n')
        elif tag == 'li':
            self.output.append('\n')
        elif tag == 'blockquote':
            self.output.append('\n')
        elif tag == 'pre':
            self.in_code_block = False
            self.output.append('```\n')
        elif tag == 'code':
            if not self.in_code_block:
                self.output.append('`')
        elif tag == 'figcaption':
            self.in_figcaption = False
            self.output.append('*\n')

    def handle_data(self, data):
        if self.in_figcaption:
            self.output.append(data.strip())
        elif self.in_code_block:
            self.output.append(data)
        else:
            # Normalize whitespace but preserve intentional spacing
            self.output.append(data)

    def get_markdown(self):
        result = ''.join(self.output)
        # Clean up excessive newlines
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()


def html_to_markdown(html):
    """Convert HTML string to Markdown."""
    if not html:
        return ''
    parser = HTMLToMarkdown()
    parser.feed(html)
    return parser.get_markdown()


def escape_yaml_string(s):
    """Escape a string for YAML frontmatter."""
    if not s:
        return '""'
    # If contains special chars, wrap in quotes and escape internal quotes
    if any(c in s for c in [':', '#', '"', "'", '\n', '[', ']', '{', '}']):
        return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
    return s


def convert_ghost_to_astro(ghost_json_path, output_dir, images_src_dir, images_dest_dir):
    """
    Convert Ghost export to Astro markdown files.

    Args:
        ghost_json_path: Path to Ghost JSON export
        output_dir: Output directory for markdown files
        images_src_dir: Source directory containing Ghost images
        images_dest_dir: Destination for images (public/images)
    """

    with open(ghost_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    db = data['db'][0]['data']
    posts = db['posts']
    tags = {t['id']: t for t in db['tags']}
    posts_tags = db['posts_tags']

    # Build post -> tags mapping
    post_tags_map = {}
    for pt in posts_tags:
        post_id = pt['post_id']
        tag_id = pt['tag_id']
        if post_id not in post_tags_map:
            post_tags_map[post_id] = []
        if tag_id in tags:
            post_tags_map[post_id].append(tags[tag_id]['slug'])

    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(images_dest_dir, exist_ok=True)

    converted = []
    skipped = []

    for post in posts:
        # Skip drafts by default
        if post['status'] != 'published':
            skipped.append((post['slug'], post['status']))
            continue

        slug = post['slug']
        title = post['title']
        html = post.get('html', '')
        feature_image = post.get('feature_image', '')
        published_at = post.get('published_at')
        custom_excerpt = post.get('custom_excerpt', '')

        # Convert HTML to Markdown
        content = html_to_markdown(html)

        # Parse date
        if published_at:
            pub_date = datetime.fromisoformat(published_at.replace('Z', '+00:00'))
            date_str = pub_date.strftime('%Y-%m-%d')
        else:
            date_str = datetime.now().strftime('%Y-%m-%d')

        # Process feature image
        if feature_image:
            feature_image = feature_image.replace('__GHOST_URL__/content/images/', '/images/')

        # Get tags for this post
        post_tag_slugs = post_tags_map.get(post['id'], [])

        # Build frontmatter
        frontmatter_lines = [
            '---',
            f'title: {escape_yaml_string(title)}',
            f'slug: {escape_yaml_string(slug)}',
            f'pubDate: {date_str}',
        ]

        if custom_excerpt:
            frontmatter_lines.append(f'description: {escape_yaml_string(custom_excerpt)}')

        if feature_image:
            frontmatter_lines.append(f'heroImage: {escape_yaml_string(feature_image)}')

        if post_tag_slugs:
            tags_yaml = '[' + ', '.join(f'"{t}"' for t in post_tag_slugs) + ']'
            frontmatter_lines.append(f'tags: {tags_yaml}')

        frontmatter_lines.append('---')

        frontmatter = '\n'.join(frontmatter_lines)

        # Write markdown file
        filename = f'{slug}.md'
        filepath = os.path.join(output_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(frontmatter + '\n\n' + content)

        converted.append(slug)

    # Copy images
    if os.path.exists(images_src_dir):
        images_copied = 0
        for root, dirs, files in os.walk(images_src_dir):
            for file in files:
                src_path = os.path.join(root, file)
                # Preserve year/month structure
                rel_path = os.path.relpath(src_path, images_src_dir)
                dest_path = os.path.join(images_dest_dir, rel_path)
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                shutil.copy2(src_path, dest_path)
                images_copied += 1
        print(f'Copied {images_copied} images to {images_dest_dir}')

    print(f'\nConverted {len(converted)} posts:')
    for slug in converted:
        print(f'  - {slug}')

    if skipped:
        print(f'\nSkipped {len(skipped)} non-published posts:')
        for slug, status in skipped:
            print(f'  - {slug} ({status})')

    return converted


if __name__ == '__main__':
    import sys

    base_dir = Path(__file__).parent.parent

    ghost_json = base_dir / 'web-ghost' / 'lightning-piggy.ghost.2026-01-26-15-23-38.json'
    output_dir = base_dir / 'src' / 'content' / 'blog'
    images_src = base_dir / 'web-ghost' / 'lightning-piggy_1769442222' / 'content' / 'images'
    images_dest = base_dir / 'public' / 'images'

    convert_ghost_to_astro(ghost_json, output_dir, images_src, images_dest)
