import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import https from 'https';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { resolveTimezone, resolveCountry, formatPhoneForCall } from '../../core/scheduler/timezone';
import { requireApiKey, validatePhone } from '../middleware/validation';
import logger from '../../utils/logger';

export const uploadRouter = Router();

const uploadDir = './data/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(csv|txt)$/i)) {
      return cb(new Error('Только CSV файлы разрешены'));
    }
    cb(null, true);
  }
});

// ─── Общая функция импорта ────────────────────────────────────────────────────
interface ImportRow { phone: string; name?: string; email?: string }

async function importContacts(rows: ImportRow[], batchSize = 500) {
  const existingPhones = new Set(
    ContactRepository.findAll().map(c => c.phone.replace(/\D/g, ''))
  )

  let imported = 0, duplicates = 0, invalid = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    for (const row of batch) {
      if (!row.phone?.trim()) { invalid++; continue }

      const phoneCheck = validatePhone(row.phone.trim())
      if (!phoneCheck.valid) {
        invalid++
        if (errors.length < 10) errors.push(`${row.phone}: ${phoneCheck.error}`)
        continue
      }

      const phone = formatPhoneForCall(row.phone.trim())
      const cleanDigits = phone.replace(/\D/g, '')
      if (existingPhones.has(cleanDigits)) { duplicates++; continue }

      try {
        ContactRepository.create({
          phone,
          name: row.name?.trim() || 'Без имени',
          email: row.email?.trim() || undefined,
          timezone: resolveTimezone(phone),
          country: resolveCountry(phone) || 'RU',
        })
        existingPhones.add(cleanDigits)
        imported++
      } catch (e: any) {
        invalid++
        if (errors.length < 10) errors.push(`${row.phone}: ${e.message}`)
      }
    }
  }

  return { imported, duplicates, invalid, errors }
}

// ─── Парсинг CSV строки ───────────────────────────────────────────────────────
function parseCsvContent(content: string, batchSize = 500) {
  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length < 2) return { rows: [], error: 'Файл пустой или содержит только заголовки' }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["\r]/g, ''))
  const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('tel') || h.includes('телефон'))
  const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('имя') || h.includes('название'))
  const emailIdx = headers.findIndex(h => h.includes('email') || h.includes('почта') || h.includes('mail'))

  if (phoneIdx === -1) {
    return { rows: [], error: 'Нет колонки с телефоном. Назовите: Phone, Tel или Телефон' }
  }

  const rows: ImportRow[] = lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/["\r]/g, ''))
    return {
      phone: values[phoneIdx] || '',
      name: nameIdx >= 0 ? values[nameIdx] : undefined,
      email: emailIdx >= 0 ? values[emailIdx] : undefined,
    }
  }).filter(r => r.phone)

  return { rows, error: null }
}

// ─── Скачать URL ──────────────────────────────────────────────────────────────
function downloadUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    const req = https.get(url, { timeout: 15000 }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadUrl(res.headers.location!).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

// ─── Извлечь ID из Google Sheets URL ─────────────────────────────────────────
function extractSheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return match ? match[1] : null
}

// ─── CSV импорт через файл ────────────────────────────────────────────────────
uploadRouter.post('/csv', requireApiKey, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' })
    const content = fs.readFileSync(req.file.path, 'utf-8')
    fs.unlinkSync(req.file.path)

    const { rows, error } = parseCsvContent(content)
    if (error) return res.status(400).json({ error })

    const result = await importContacts(rows)
    logger.info(`CSV import: ${JSON.stringify(result)}`)
    res.json({ success: true, total: rows.length, ...result })
  } catch (error: any) {
    logger.error(`CSV import error: ${error.message}`)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ error: error.message })
  }
})

// ─── Google Sheets импорт (публичная таблица по ссылке) ──────────────────────
// Таблица должна быть с доступом "Просматривать могут все у кого есть ссылка"
uploadRouter.post('/google-sheets', requireApiKey, async (req: Request, res: Response) => {
  try {
    const { url, sheetName = '', batchSize = 500 } = req.body

    if (!url) {
      return res.status(400).json({
        error: 'Укажите url Google Sheets таблицы',
        hint: 'Таблица должна быть публичной (Настройки доступа → Все у кого есть ссылка)'
      })
    }

    const spreadsheetId = extractSheetId(url)
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Не удалось извлечь ID из ссылки Google Sheets' })
    }

    // Формируем URL для экспорта CSV (работает для публичных таблиц без авторизации)
    const sheetParam = sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : ''
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv${sheetParam}`

    logger.info(`Downloading Google Sheets: ${csvUrl}`)

    let csvContent: string
    try {
      csvContent = await downloadUrl(csvUrl)
    } catch (e: any) {
      return res.status(400).json({
        error: `Не удалось скачать таблицу: ${e.message}`,
        hint: 'Убедитесь что таблица публичная: Файл → Настройки доступа → Все у кого есть ссылка → Просматривающий'
      })
    }

    const { rows, error } = parseCsvContent(csvContent)
    if (error) return res.status(400).json({ error })

    logger.info(`Google Sheets: ${rows.length} строк, batchSize=${batchSize}`)
    const result = await importContacts(rows, Number(batchSize))

    logger.info(`Google Sheets import done: ${JSON.stringify(result)}`)
    res.json({ success: true, total: rows.length, ...result })

  } catch (error: any) {
    logger.error(`Google Sheets import error: ${error.message}`)
    res.status(500).json({ error: error.message })
  }
})

// ─── JSON импорт (для интеграций) ────────────────────────────────────────────
uploadRouter.post('/json', requireApiKey, async (req: Request, res: Response) => {
  try {
    const { contacts: inputContacts, batchSize = 500 } = req.body
    if (!Array.isArray(inputContacts) || inputContacts.length === 0) {
      return res.status(400).json({ error: 'Передайте массив contacts: [{phone, name, email}]' })
    }

    const rows: ImportRow[] = inputContacts.map((c: any) => ({
      phone: c.phone || c.Phone || c.телефон || '',
      name: c.name || c.Name || c.имя || 'Без имени',
      email: c.email || c.Email || '',
    }))

    const result = await importContacts(rows, Number(batchSize))
    res.json({ success: true, total: rows.length, ...result })
  } catch (error: any) {
    logger.error(`JSON import error: ${error.message}`)
    res.status(500).json({ error: error.message })
  }
})
