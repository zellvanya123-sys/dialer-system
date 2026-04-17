import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { resolveTimezone, resolveCountry, formatPhoneForCall } from '../../core/scheduler/timezone';
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

const upload = multer({ storage });

uploadRouter.post('/csv', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const content = fs.readFileSync(req.file.path, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('tel'));
    const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('имя'));
    const emailIdx = headers.findIndex(h => h.includes('email') || h.includes('почта'));

    if (phoneIdx === -1) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'В CSV нет колонки с телефоном' });
    }

    let imported = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const phone = values[phoneIdx];

      if (!phone || phone.length < 10) {
        skipped++;
        continue;
      }

      const name = nameIdx >= 0 ? values[nameIdx] : 'Unknown';
      const email = emailIdx >= 0 ? values[emailIdx] : undefined;

      try {
        const formattedPhone = formatPhoneForCall(phone);
        const timezone = resolveTimezone(formattedPhone);
        const country = resolveCountry(formattedPhone);

        ContactRepository.create({
          phone: formattedPhone,
          name,
          email,
          timezone,
          country,
        });
        imported++;
      } catch (e) {
        skipped++;
      }
    }

    fs.unlinkSync(req.file.path);

    logger.info(`CSV imported: ${imported} contacts, ${skipped} skipped`);
    res.json({ success: true, imported, skipped });
  } catch (error: any) {
    logger.error(`CSV import error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});