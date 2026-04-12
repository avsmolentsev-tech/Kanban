// PIS Widget for Scriptable (iPhone)
// 1. Get your API key at kanban.myaipro.ru → Profile → iPhone Widget
// 2. Paste it below
// 3. Run this script, then add Scriptable widget to home screen

const API_KEY = 'PASTE_YOUR_KEY_HERE';
const API = `https://kanban.myaipro.ru/v1/widget/today?key=${API_KEY}`;

const req = new Request(API);
const data = await req.loadJSON();

if (!data.success) {
  const w = new ListWidget();
  w.backgroundColor = new Color('#0f172a');
  const err = w.addText('Invalid API key');
  err.font = Font.systemFont(12);
  err.textColor = new Color('#ef4444');
  Script.setWidget(w);
  w.presentSmall();
  Script.complete();
  return;
}

const d = data.data;
const w = new ListWidget();
w.backgroundColor = new Color('#0f172a');
w.setPadding(12, 12, 12, 12);

// Header
const header = w.addText('PIS');
header.font = Font.boldSystemFont(14);
header.textColor = Color.white();
w.addSpacer(4);

// Overdue
if (d.overdue_count > 0) {
  const o = w.addText(`! Overdue: ${d.overdue_count}`);
  o.font = Font.systemFont(11);
  o.textColor = new Color('#ef4444');
  w.addSpacer(2);
}

// Meetings
if (d.meetings && d.meetings.length > 0) {
  for (const m of d.meetings.slice(0, 2)) {
    const row = w.addText(m.title);
    row.font = Font.mediumSystemFont(11);
    row.textColor = new Color('#93c5fd');
    row.lineLimit = 1;
  }
  w.addSpacer(2);
}

// Tasks
for (const t of d.tasks.slice(0, 4)) {
  const row = w.addText(`• ${t.title}`);
  row.font = Font.systemFont(11);
  row.textColor = new Color('#e2e8f0');
  row.lineLimit = 1;
}

// Habits
if (d.habits && d.habits.length > 0) {
  w.addSpacer(4);
  const done = d.habits.filter(h => h.done).length;
  const total = d.habits.length;
  const hText = w.addText(`${done}/${total} habits`);
  hText.font = Font.systemFont(10);
  hText.textColor = new Color('#f97316');
}

w.addSpacer();
const footer = w.addText(d.date);
footer.font = Font.systemFont(9);
footer.textColor = new Color('#64748b');
footer.rightAlignText();

Script.setWidget(w);
w.presentSmall();
Script.complete();
