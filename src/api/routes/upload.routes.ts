import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
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

// ✅ Лимит размера файла 10MB
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

uploadRouter.post('/csv', requireApiKey, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const content = fs.readFileSync(req.file.path, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'CSV файл пустой или содержит только заголовки' });
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('tel') || h.includes('телефон'));
    const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('имя') || h.includes('название'));
    const emailIdx = headers.findIndex(h => h.includes('email') || h.includes('почта') || h.includes('mail'));

    if (phoneIdx === -1) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: 'В CSV нет колонки с телефоном. Назовите колонку: phone, tel или телефон'
      });
    }

    // ✅ Загружаем существующие номера для проверки дублей
    const existingPhones = new Set(
      ContactRepository.findAll().map(c => c.phone.replace(/\D/g, ''))
    );

    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    let invalidPhones = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const rawPhone = values[phoneIdx];

      if (!rawPhone || rawPhone.trim() === '') {
        skipped++;
        continue;
      }

      // ✅ Строгая валидация номера
      const phoneCheck = validatePhone(rawPhone);
      if (!phoneCheck.valid) {
        invalidPhones++;
        if (errors.length < 5) {
          errors.push(`Строка ${i + 1}: ${phoneCheck.error}`);
        }
        continue;
      }

      const formattedPhone = formatPhoneForCall(rawPhone);
      const cleanDigits = formattedPhone.replace(/\D/g, '');

      // ✅ Проверка дублей
      if (existingPhones.has(cleanDigits)) {
        duplicates++;
        continue;
      }

      const name = nameIdx >= 0 && values[nameIdx] ? values[nameIdx] : 'Без имени';
      const email = emailIdx >= 0 && values[emailIdx] ? values[emailIdx] : undefined;

      try {
        const timezone = resolveTimezone(formattedPhone);
        const country = resolveCountry(formattedPhone);

        ContactRepository.create({
          phone: formattedPhone,
          name,
          email,
          timezone,
          country,
        });

        // ✅ Добавляем в Set чтобы не было дублей внутри самого файла
        existingPhones.add(cleanDigits);
        imported++;
      } catch (e: any) {
        skipped++;
        if (errors.length < 5) errors.push(`Строка ${i + 1}: ${e.message}`);
      }
    }

    // Удаляем загруженный файл
    fs.unlinkSync(req.file.path);

    logger.info(`CSV imported: ${imported} contacts, ${duplicates} duplicates, ${invalidPhones} invalid phones, ${skipped} skipped`);

    res.json({
      success: true,
      imported,
      duplicates,
      invalidPhones,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error: any) {
    logger.error(`CSV import error: ${error.message}`);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});
