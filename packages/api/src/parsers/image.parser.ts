import OpenAI from 'openai';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function parseImage(buffer: Buffer, ext: string): Promise<string> {
  const base64 = buffer.toString('base64');
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image in detail and extract all visible text. Respond in the same language as any text found in the image (Russian or English). If there is no text, just describe what you see.' },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    }],
  });

  return response.choices[0]?.message?.content ?? '';
}
