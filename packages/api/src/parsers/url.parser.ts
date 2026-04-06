import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function parseUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PIS/1.0)' },
  });
  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove scripts, styles, nav, footer
  $('script, style, nav, footer, header, aside, iframe, noscript').remove();

  // Extract title
  const title = $('title').text().trim() || $('h1').first().text().trim() || '';

  // Try to get main content
  let text = '';
  const mainSelectors = ['article', 'main', '[role="main"]', '.content', '.post-content', '.entry-content'];
  for (const sel of mainSelectors) {
    const el = $(sel);
    if (el.length) {
      text = el.text().trim();
      break;
    }
  }
  if (!text) {
    text = $('body').text().trim();
  }

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // If text is too short, use OpenAI to extract from raw HTML
  if (text.length < 100) {
    const truncatedHtml = html.slice(0, 15000); // limit to ~15k chars for API
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: 'Extract the main textual content from this HTML page. Return only the extracted text, no HTML tags.' },
        { role: 'user', content: truncatedHtml },
      ],
    });
    text = result.choices[0]?.message?.content ?? text;
  }

  return title ? `${title}\n\n${text}` : text;
}
