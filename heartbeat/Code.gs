/**
 * Estancia Noticeboard — display heartbeat backend (Google Apps Script).
 *
 * Each display (index.html?t=t1c1 …) POSTs a small JSON heartbeat here on boot
 * and on every config refresh. This script keeps ONE row per display in a
 * Google Sheet (latest state only) and serves it back as JSON to the admin
 * status panel.
 *
 * DEPLOY (once):
 *   1. sheets.google.com → create a blank spreadsheet.
 *   2. Extensions → Apps Script. Paste this file over Code.gs. Save.
 *   3. Deploy → New deployment → type "Web app".
 *        Execute as:  Me
 *        Who has access:  Anyone
 *      Deploy, authorise, and copy the "/exec" Web app URL.
 *   4. Paste that URL into the admin panel → Displays → Backend URL → Save.
 *      (It is stored in config.json as "heartbeatUrl".)
 *
 * Re-deploying after edits: Deploy → Manage deployments → edit → Version: New.
 * The /exec URL stays the same, so no config change is needed.
 */

var SPREADSHEET_ID = '1KMoADnda8lw-r1Qq3UO9BUn2ueSenrYoahMKlNZmRnE';
var SHEET_NAME = 'heartbeats';
var HEADERS = ['tv', 'lastSeen', 'online', 'slides', 'version', 'href', 'ua', 'beats'];

function getSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
  }
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Display posts a heartbeat here. Upserts the row keyed by tv. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (_) {}
    var tv = String(body.tv || '').trim().toLowerCase();
    if (!tv) return json_({ ok: false, error: 'no tv' });

    var sh = getSheet_();
    var now = new Date();
    var values = sh.getDataRange().getValues();   // includes header row
    var rowIndex = -1;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim().toLowerCase() === tv) { rowIndex = i; break; }
    }
    var prevBeats = rowIndex > -1 ? Number(values[rowIndex][7]) || 0 : 0;

    var row = [
      tv,
      now.getTime(),                                  // lastSeen (epoch ms, server clock)
      body.online === false ? false : true,
      Number(body.slides) || 0,
      String(body.version || ''),
      String(body.href || ''),
      String(body.ua || '').slice(0, 300),
      prevBeats + 1
    ];

    if (rowIndex > -1) {
      sh.getRange(rowIndex + 1, 1, 1, row.length).setValues([row]);
    } else {
      sh.appendRow(row);
    }
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/** Admin panel reads the current status of every display from here. */
function doGet(e) {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var displays = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    displays.push({
      tv: String(r[0]).trim().toLowerCase(),
      lastSeen: Number(r[1]) || 0,
      online: r[2] === true || r[2] === 'true' || r[2] === 'TRUE',
      slides: Number(r[3]) || 0,
      version: String(r[4] || ''),
      href: String(r[5] || ''),
      ua: String(r[6] || ''),
      beats: Number(r[7]) || 0
    });
  }
  return json_({ now: new Date().getTime(), displays: displays });
}
