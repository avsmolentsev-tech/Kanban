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
  const g = new LinearGradient();
  g.locations = [0, 1];
  g.colors = [new Color('#1e1b4b'), new Color('#0f172a')];
  w.backgroundGradient = g;
  const err = w.addText('Invalid API key');
  err.font = Font.systemFont(12);
  err.textColor = new Color('#ef4444');
  Script.setWidget(w);
  w.presentMedium();
  Script.complete();
  return;
}

const d = data.data;
const w = new ListWidget();

// Gradient background — indigo to purple like the app
const gradient = new LinearGradient();
gradient.locations = [0, 0.5, 1];
gradient.colors = [
  new Color('#312e81'),
  new Color('#1e1b4b'),
  new Color('#0f172a'),
];
w.backgroundGradient = gradient;
w.setPadding(14, 14, 14, 14);

// Header: Clarity Space
const headerStack = w.addStack();
headerStack.layoutHorizontally();
headerStack.centerAlignContent();

const logoRect = headerStack.addStack();
logoRect.backgroundColor = new Color('#6366f1');
logoRect.cornerRadius = 6;
logoRect.setPadding(3, 6, 3, 6);
const logoText = logoRect.addText('CS');
logoText.font = Font.boldSystemFont(10);
logoText.textColor = Color.white();

headerStack.addSpacer(6);
const brandText = headerStack.addText('Clarity Space');
brandText.font = Font.mediumSystemFont(13);
brandText.textColor = new Color('#c7d2fe');

headerStack.addSpacer();
const dateText = headerStack.addText(d.date || '');
dateText.font = Font.systemFont(10);
dateText.textColor = new Color('#6366f1');

w.addSpacer(8);

// Focus or weekly goal
if (d.focus) {
  const focusStack = w.addStack();
  focusStack.backgroundColor = new Color('#fbbf24', 0.15);
  focusStack.cornerRadius = 8;
  focusStack.setPadding(6, 8, 6, 8);
  const focusText = focusStack.addText('\uD83C\uDFAF ' + d.focus);
  focusText.font = Font.mediumSystemFont(12);
  focusText.textColor = new Color('#fbbf24');
  focusText.lineLimit = 2;
  w.addSpacer(6);
} else if (d.weekly_goal) {
  const goalStack = w.addStack();
  goalStack.backgroundColor = new Color('#a78bfa', 0.15);
  goalStack.cornerRadius = 8;
  goalStack.setPadding(6, 8, 6, 8);
  const goalText = goalStack.addText('\uD83D\uDE80 ' + d.weekly_goal);
  goalText.font = Font.mediumSystemFont(12);
  goalText.textColor = new Color('#a78bfa');
  goalText.lineLimit = 2;
  w.addSpacer(6);
}

// Overdue warning
if (d.overdue_count > 0) {
  const overdueStack = w.addStack();
  overdueStack.backgroundColor = new Color('#ef4444', 0.15);
  overdueStack.cornerRadius = 6;
  overdueStack.setPadding(4, 8, 4, 8);
  const overdueText = overdueStack.addText('\u26A0\uFE0F ' + d.overdue_count + ' overdue');
  overdueText.font = Font.boldSystemFont(11);
  overdueText.textColor = new Color('#f87171');
  w.addSpacer(4);
}

// Meetings
if (d.meetings && d.meetings.length > 0) {
  for (var mi = 0; mi < Math.min(d.meetings.length, 2); mi++) {
    const meetStack = w.addStack();
    meetStack.layoutHorizontally();
    meetStack.centerAlignContent();
    const meetDot = meetStack.addText('\uD83D\uDCC5 ');
    meetDot.font = Font.systemFont(10);
    const meetText = meetStack.addText(d.meetings[mi].title);
    meetText.font = Font.mediumSystemFont(11);
    meetText.textColor = new Color('#93c5fd');
    meetText.lineLimit = 1;
  }
  w.addSpacer(4);
}

// Tasks
const maxTasks = d.focus || d.weekly_goal ? 3 : 5;
for (var ti = 0; ti < Math.min(d.tasks.length, maxTasks); ti++) {
  const taskStack = w.addStack();
  taskStack.layoutHorizontally();
  taskStack.centerAlignContent();

  const bullet = taskStack.addText('');
  const prio = d.tasks[ti].priority || 3;
  if (prio >= 4) {
    bullet.textColor = new Color('#ef4444');
    taskStack.addSpacer(2);
  } else {
    bullet.textColor = new Color('#6366f1');
    taskStack.addSpacer(2);
  }
  bullet.font = Font.systemFont(6);

  const dot = taskStack.addText('\u2022 ');
  dot.font = Font.systemFont(11);
  dot.textColor = prio >= 4 ? new Color('#ef4444') : new Color('#818cf8');

  const taskText = taskStack.addText(d.tasks[ti].title);
  taskText.font = Font.systemFont(11);
  taskText.textColor = new Color('#e2e8f0');
  taskText.lineLimit = 1;
}

// Habits
if (d.habits && d.habits.length > 0) {
  w.addSpacer(6);
  const habitsStack = w.addStack();
  habitsStack.layoutHorizontally();
  habitsStack.centerAlignContent();
  var done = d.habits.filter(function(h) { return h.done; }).length;
  var total = d.habits.length;
  const fireText = habitsStack.addText('\uD83D\uDD25 ');
  fireText.font = Font.systemFont(10);
  const habText = habitsStack.addText(done + '/' + total + ' habits');
  habText.font = Font.mediumSystemFont(10);
  habText.textColor = new Color('#fb923c');
}

w.addSpacer();

// Bottom line with subtle branding
const bottomStack = w.addStack();
bottomStack.layoutHorizontally();
const bottomLine = bottomStack.addText('');
bottomLine.font = Font.systemFont(1);
bottomStack.addSpacer();
const poweredBy = bottomStack.addText('clarity.space');
poweredBy.font = Font.systemFont(8);
poweredBy.textColor = new Color('#4338ca', 0.5);

Script.setWidget(w);
w.presentMedium();
Script.complete();
