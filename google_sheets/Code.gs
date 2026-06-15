const SHEET_NAME = 'Поручения';
const DEFAULT_SCRIPT_TOKEN = 'CHANGE_ME';

const HEADERS = [
  'id',
  'responsible',
  'assignment',
  'department',
  'max_username',
  'deadline',
  'status',
  'completion_text',
  'closed_at',
  'updated_at',
];

function doGet() {
  return jsonResponse({ ok: true, service: 'digital-office-google-sheets' });
}

function doPost(e) {
  try {
    const payload = parsePayload(e);
    validateToken(payload.token);

    const action = String(payload.action || 'upsert');
    if (!payload.id) {
      throw new Error('Field "id" is required');
    }
    if (action !== 'upsert' && action !== 'complete') {
      throw new Error('Unsupported action: ' + action);
    }

    const sheet = getOrCreateSheet();
    const row = upsertRow(sheet, payload);

    if (action === 'complete') {
      markCompleted(sheet, row);
    }

    return jsonResponse({ ok: true, action, id: payload.id, row });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function parsePayload(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Empty request body');
  }
  return JSON.parse(e.postData.contents);
}

function validateToken(token) {
  const configured = PropertiesService.getScriptProperties().getProperty('SCRIPT_TOKEN') || DEFAULT_SCRIPT_TOKEN;
  if (!configured || configured === 'CHANGE_ME') {
    throw new Error('Set SCRIPT_TOKEN in Apps Script Project Settings');
  }
  if (String(token || '') !== configured) {
    throw new Error('Unauthorized');
  }
}

function getOrCreateSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  const existingHeaders = headerRange.getValues()[0];
  const needsHeaders = existingHeaders.some((value, index) => value !== HEADERS[index]);
  if (needsHeaders) {
    headerRange.setValues([HEADERS]);
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function upsertRow(sheet, payload) {
  const row = findRowById(sheet, payload.id) || Math.max(sheet.getLastRow() + 1, 2);
  const values = [
    payload.id || '',
    payload.responsible || '',
    payload.assignment || '',
    payload.department || '',
    payload.max_username || '',
    payload.deadline || '',
    payload.status || '',
    payload.completion_text || '',
    payload.closed_at || '',
    new Date(),
  ];

  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  sheet.getRange(row, 1, 1, values.length).setBackground(null);
  sheet.autoResizeColumns(1, HEADERS.length);
  return row;
}

function findRowById(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (String(ids[index][0]) === String(id)) {
      return index + 2;
    }
  }
  return null;
}

function markCompleted(sheet, row) {
  const statusColumn = HEADERS.indexOf('status') + 1;
  sheet.getRange(row, statusColumn).setValue('Выполнено');
  sheet.getRange(row, 1, 1, HEADERS.length).setBackground('#d9ead3');
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
