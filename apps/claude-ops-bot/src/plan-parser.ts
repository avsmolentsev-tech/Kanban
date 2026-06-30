export function extractPlan(output: string): string | null {
  const markerMatch = output.match(/\[PLAN_START\]([\s\S]*?)\[PLAN_END\]/);
  if (markerMatch) return markerMatch[1]!.trim();

  const lines = output.split('\n');
  const planLines: string[] = [];
  let inPlan = false;

  for (const line of lines) {
    if (/^\d+\.\s/.test(line.trim())) {
      inPlan = true;
      planLines.push(line.trim());
    } else if (inPlan && line.trim().startsWith('-')) {
      planLines.push(line.trim());
    } else if (inPlan && line.trim() === '') {
      planLines.push('');
    } else if (inPlan) {
      break;
    }
  }

  return planLines.length >= 2 ? planLines.join('\n').trim() : null;
}

export function extractSummary(output: string): string | null {
  const markerMatch = output.match(/\[SUMMARY_START\]([\s\S]*?)\[SUMMARY_END\]/);
  if (markerMatch) return markerMatch[1]!.trim();

  const paragraphs = output.split(/\n\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length === 0) return null;
  const last = paragraphs[paragraphs.length - 1]!.trim();
  return last.length > 500 ? last.slice(0, 500) + '...' : last;
}

export function buildPlanPrompt(userPrompt: string): string {
  return `Я хочу, чтобы ты сначала ТОЛЬКО составил план, не выполняя никаких действий.

Задача: ${userPrompt}

Ответь ТОЛЬКО планом в формате:
[PLAN_START]
1. Шаг первый
2. Шаг второй
...
[PLAN_END]

Не редактируй файлы, не выполняй команды. Только план.`;
}

export function buildExecutePrompt(userPrompt: string, plan: string): string {
  return `Выполни задачу по утверждённому плану.

Задача: ${userPrompt}

Утверждённый план:
${plan}

После выполнения напиши краткое резюме:
[SUMMARY_START]
Что было сделано (2-3 предложения)
[SUMMARY_END]`;
}
