// Clarity Space Widget for Scriptable (iPhone)
// 1. Get your API key at clarity-space.ru → Profile → iPhone Widget
// 2. Paste it below
// 3. Run this script, then add Scriptable widget to home screen

let API_KEY = 'PASTE_YOUR_KEY_HERE'
let API = 'https://clarity-space.ru/v1/widget/today?key=' + API_KEY

let req = new Request(API)
let data = await req.loadJSON()

if (!data.success) {
  let w = new ListWidget()
  w.backgroundColor = new Color('#1e1b4b')
  let err = w.addText('Invalid API key')
  err.font = Font.systemFont(12)
  err.textColor = new Color('#ef4444')
  Script.setWidget(w)
  Script.complete()
  return
}

let d = data.data
let w = new ListWidget()

// Gradient background
let gradient = new LinearGradient()
gradient.locations = [0, 0.5, 1]
gradient.colors = [new Color('#312e81'), new Color('#1e1b4b'), new Color('#0f172a')]
w.backgroundGradient = gradient
w.setPadding(14, 14, 14, 14)

// Header
let headerStack = w.addStack()
headerStack.layoutHorizontally()
headerStack.centerAlignContent()

let logoRect = headerStack.addStack()
logoRect.backgroundColor = new Color('#6366f1')
logoRect.cornerRadius = 6
logoRect.setPadding(3, 6, 3, 6)
let logoText = logoRect.addText('CS')
logoText.font = Font.boldSystemFont(10)
logoText.textColor = Color.white()

headerStack.addSpacer(6)
let brandText = headerStack.addText('Clarity Space')
brandText.font = Font.mediumSystemFont(13)
brandText.textColor = new Color('#c7d2fe')

headerStack.addSpacer()
let rawDate = '' + (d.date || '')
let dateParts = rawDate.split('-')
let formattedDate = dateParts.length === 3 ? dateParts[2] + '.' + dateParts[1] + '.' + dateParts[0].slice(2) : rawDate
let dateText = headerStack.addText(formattedDate)
dateText.font = Font.systemFont(10)
dateText.textColor = new Color('#6366f1')
dateText.lineLimit = 1
dateText.minimumScaleFactor = 0.8

w.addSpacer(8)

// Focus
if (d.focus) {
  let focusStack = w.addStack()
  focusStack.backgroundColor = new Color('#fbbf24', 0.15)
  focusStack.cornerRadius = 8
  focusStack.setPadding(6, 8, 6, 8)
  let focusText = focusStack.addText('🎯 ' + d.focus)
  focusText.font = Font.mediumSystemFont(12)
  focusText.textColor = new Color('#fbbf24')
  focusText.lineLimit = 2
  w.addSpacer(6)
} else if (d.weekly_goal) {
  let goalStack = w.addStack()
  goalStack.backgroundColor = new Color('#a78bfa', 0.15)
  goalStack.cornerRadius = 8
  goalStack.setPadding(6, 8, 6, 8)
  let goalText = goalStack.addText('🚀 ' + d.weekly_goal)
  goalText.font = Font.mediumSystemFont(12)
  goalText.textColor = new Color('#a78bfa')
  goalText.lineLimit = 2
  w.addSpacer(6)
}

// Overdue
if (d.overdue_count > 0) {
  let ot = w.addText('⚠️ ' + d.overdue_count + ' overdue')
  ot.font = Font.boldSystemFont(11)
  ot.textColor = new Color('#f87171')
  w.addSpacer(4)
}

// Meetings
if (d.meetings && d.meetings.length > 0) {
  let ml = Math.min(d.meetings.length, 2)
  for (let i = 0; i < ml; i++) {
    let mt = w.addText('📅 ' + d.meetings[i].title)
    mt.font = Font.mediumSystemFont(11)
    mt.textColor = new Color('#93c5fd')
    mt.lineLimit = 1
  }
  w.addSpacer(4)
}

// Tasks
if (d.tasks && d.tasks.length > 0) {
  let tl = Math.min(d.tasks.length, 4)
  for (let i = 0; i < tl; i++) {
    let tt = w.addText('• ' + d.tasks[i].title)
    tt.font = Font.systemFont(11)
    tt.textColor = new Color('#e2e8f0')
    tt.lineLimit = 1
  }
}

// Habits
if (d.habits && d.habits.length > 0) {
  w.addSpacer(6)
  let done = 0
  for (let i = 0; i < d.habits.length; i++) {
    if (d.habits[i].done) done++
  }
  let ht = w.addText('🔥 ' + done + '/' + d.habits.length + ' habits')
  ht.font = Font.mediumSystemFont(10)
  ht.textColor = new Color('#fb923c')
}

w.addSpacer()

Script.setWidget(w)
Script.complete()
