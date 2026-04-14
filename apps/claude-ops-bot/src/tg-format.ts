export function chunkForTelegram(text: string, limit = 3500): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + limit, text.length);
    if (end < text.length) {
      const search = text.lastIndexOf('\n', end);
      if (search > i && search > end - 200) end = search + 1;
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}
