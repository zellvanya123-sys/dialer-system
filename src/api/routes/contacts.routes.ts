import { Router, Request, Response } from 'express';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { Contact, ContactStatus } from '../../core/contacts/contact.model';
import { resolveTimezone, resolveCountry, formatPhoneForCall } from '../../core/scheduler/timezone';
import { requireApiKey, validateContact, validatePhone } from '../middleware/validation';
import logger from '../../utils/logger';

export const contactsRouter = Router();

// ✅ Создать контакт — с валидацией телефона и проверкой дублей
contactsRouter.post('/', requireApiKey, async (req: Request, res: Response) => {
  try {
    const data = req.body;

    const validation = validateContact(data);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    // ✅ Валидация номера телефона
    const phoneCheck = validatePhone(data.phone);
    if (!phoneCheck.valid) {
      return res.status(400).json({ error: phoneCheck.error });
    }

    const phone = formatPhoneForCall(data.phone);

    // ✅ Проверка дублей
    const existing = ContactRepository.findAll().find(c =>
      c.phone.replace(/\D/g, '') === phone.replace(/\D/g, '')
    );
    if (existing) {
      return res.status(409).json({
        error: `Контакт с номером ${phone} уже существует`,
        existing
      });
    }

    // ✅ Timezone определяется автоматически по номеру
    const timezone = resolveTimezone(phone, data.country);
    const country = data.country || resolveCountry(phone);

    const contact = ContactRepository.create({
      phone,
      name: data.name,
      email: data.email,
      timezone,
      country,
      externalId: data.externalId,
      sheetRowId: data.sheetRowId,
    });

    logger.info(`Created contact: ${contact.id} (${contact.name}, ${contact.phone})`);
    res.status(201).json(contact);
  } catch (error: any) {
    logger.error(`Error creating contact: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Получить все контакты
contactsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    let contacts: Contact[];
    if (status) {
      contacts = ContactRepository.findByStatus(status as ContactStatus);
    } else {
      contacts = ContactRepository.findAll();
    }
    res.json(contacts);
  } catch (error: any) {
    logger.error(`Error fetching contacts: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Получить контакт по ID
contactsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const contact = ContactRepository.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(contact);
  } catch (error: any) {
    logger.error(`Error fetching contact: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Обновить контакт — только с API ключом
contactsRouter.put('/:id', requireApiKey, async (req: Request, res: Response) => {
  try {
    const contact = ContactRepository.update(req.params.id, req.body);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    logger.info(`Updated contact: ${contact.id}`);
    res.json(contact);
  } catch (error: any) {
    logger.error(`Error updating contact: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Удалить контакт — только с API ключом
contactsRouter.delete('/:id', requireApiKey, async (req: Request, res: Response) => {
  try {
    const deleted = ContactRepository.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    logger.info(`Deleted contact: ${req.params.id}`);
    res.status(204).send();
  } catch (error: any) {
    logger.error(`Error deleting contact: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Контакты ожидающие звонка
contactsRouter.get('/due/calls', async (req: Request, res: Response) => {
  try {
    const contacts = ContactRepository.findDueForCall();
    res.json(contacts);
  } catch (error: any) {
    logger.error(`Error fetching due contacts: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});
