// PIS Widget for Scriptable (iPhone)
// Install Scriptable app, paste this code, add widget to homescreen

const API = 'https://kanban.myaipro.ru/v1/widget/today';

const req = new Request(API);
const data = await req.loadJSON();
const d = data.data;

const w = new ListWidget();
w.backgroundColor = new Color('#0f172a');

// Header
const header = w.addText('📋 PIS');
header.font = Font.boldSystemFont(14);
header.textColor = Color.white();
w.addSpacer(4);

// Overdue
if (d.overdue_count > 0) {
  const o = w.addText(`⚠️ Просрочено: ${d.overdue_count}`);
  o.font = Font.systemFont(11);
  o.textColor = new Color('#ef4444');
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
if (d.habits.length > 0) {
  w.addSpacer(4);
  const habitLine = d.habits.map(h => h.done ? '✅' : h.icon).join(' ');
  const hText = w.addText(habitLine);
  hText.font = Font.systemFont(12);
}

w.addSpacer();
const footer = w.addText(d.date);
footer.font = Font.systemFont(9);
footer.textColor = new Color('#64748b');
footer.rightAlignText();

Script.setWidget(w);
w.presentSmall();
Script.complete();
