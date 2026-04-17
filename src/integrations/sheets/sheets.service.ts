import { google } from 'googleapis';
import { config } from '../../config/index';
import logger from '../../utils/logger';

let sheets: any;
let auth: any;

export async function initSheets(): Promise<void> {
  if (!config.googleSheets.clientId || !config.googleSheets.clientSecret) {
    throw new Error('Google Sheets credentials not configured');
  }

  const oauth2Client = new google.auth.OAuth2(
    config.googleSheets.clientId,
    config.googleSheets.clientSecret
  );

  oauth2Client.setCredentials({
    refresh_token: config.googleSheets.refreshToken
  });

  auth = oauth2Client;
  sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  
  logger.info('Google Sheets initialized');
}

export interface SheetRow {
  name: string;
  phone: string;
  email?: string;
  status?: string;
  attemptCount?: number;
  lastCallAt?: string;
  nextCallAt?: string;
}

export async function readContacts(range: string = 'A:Z'): Promise<SheetRow[]> {
  if (!sheets || !config.googleSheets.spreadsheetId) {
    throw new Error('Google Sheets not initialized');
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheets.spreadsheetId,
    range,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0];
  const data = rows.slice(1);

  return data.map((row: any[]) => {
    const obj: any = {};
    headers.forEach((header: string, index: number) => {
      obj[header.toLowerCase()] = row[index] || '';
    });
    return obj;
  });
}

export async function updateCell(
  rowIndex: number,
  column: string,
  value: string
): Promise<void> {
  if (!sheets || !config.googleSheets.spreadsheetId) {
    throw new Error('Google Sheets not initialized');
  }

  const range = `${column}${rowIndex}`;
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheets.spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[value]]
    }
  });

  logger.info(`Updated cell ${range} with value ${value}`);
}

export async function updateContactStatus(
  rowIndex: number,
  status: string,
  attemptCount: number,
  lastCallAt?: string
): Promise<void> {
  await updateCell(rowIndex, 'E', status);
  await updateCell(rowIndex, 'F', attemptCount.toString());
  if (lastCallAt) {
    await updateCell(rowIndex, 'G', lastCallAt);
  }
}