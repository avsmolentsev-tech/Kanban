// Clarity Space Widget for Scriptable (iPhone)
// 1. Get your API key at kanban.myaipro.ru → Profile → iPhone Widget
// 2. Paste it below
// 3. Run this script, then add Scriptable widget to home screen

const API_KEY = 'PASTE_YOUR_KEY_HERE';
const API = 'https://kanban.myaipro.ru/v1/widget/today?key=' + API_KEY;

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

var header = w.addText('CS');
header.font = Font.boldSystemFont(14);
header.textColor = Color.white();
w.addSpacer(4);

if (d.focus) {
  var f = w.addText('\uD83C\uDFAF ' + d.focus);
  f.font = Font.mediumSystemFont(11);
  f.textColor = new Color('#fbbf24');
  f.lineLimit = 2;
  w.addSpacer(3);
} else if (d.weekly_goal) {
  var g = w.addText('\uD83C\uDFAF ' + d.weekly_goal);
  g.font = Font.mediumSystemFont(11);
  g.textColor = new Color('#a78bfa');
  g.lineLimit = 2;
  w.addSpacer(3);
}

if (d.overdue_count > 0) {
  var o = w.addText('\u26A0 Overdue: ' + d.overdue_count);
  o.font = Font.systemFont(11);
  o.textColor = new Color('#ef4444');
  w.addSpacer(2);
}

if (d.meetings && d.meetings.length > 0) {
  for (var mi = 0; mi < Math.min(d.meetings.length, 2); mi++) {
    var row = w.addText(d.meetings[mi].title);
    row.font = Font.mediumSystemFont(11);
    row.textColor = new Color('#93c5fd');
    row.lineLimit = 1;
  }
  w.addSpacer(2);
}

for (var ti = 0; ti < Math.min(d.tasks.length, 4); ti++) {
  var trow = w.addText('\u2022 ' + d.tasks[ti].title);
  trow.font = Font.systemFont(11);
  trow.textColor = new Color('#e2e8f0');
  trow.lineLimit = 1;
}

if (d.habits && d.habits.length > 0) {
  w.addSpacer(4);
  var done = d.habits.filter(function(h) { return h.done; }).length;
  var total = d.habits.length;
  var hText = w.addText(done + '/' + total + ' habits');
  hText.font = Font.systemFont(10);
  hText.textColor = new Color('#f97316');
}

w.addSpacer();
var footer = w.addText(d.date);
footer.font = Font.systemFont(9);
footer.textColor = new Color('#64748b');
footer.rightAlignText();

Script.setWidget(w);
w.presentSmall();
Script.complete();
