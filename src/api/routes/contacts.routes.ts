import { Router, Request, Response } from 'express';
import { ContactRepository } from '../../core/contacts/contact.repository.js';
import { Contact, ContactStatus } from '../../core/contacts/contact.model.js';
import { resolveTimezone, resolveCountry, formatPhoneForCall } from '../../core/scheduler/timezone.js';
import { validateContact } from '../middleware/validation.js';
import logger from '../../utils/logger.js';

export const contactsRouter = Router();

contactsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;

    const validation = validateContact(data);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    const timezone = resolveTimezone(data.phone, data.country);
    const country = resolveCountry(data.phone);
    const phone = formatPhoneForCall(data.phone);
    
    const contact = ContactRepository.create({
      phone,
      name: data.name,
      email: data.email,
      timezone,
      country,
      externalId: data.externalId,
      sheetRowId: data.sheetRowId,
    });

    logger.info(`Created contact: ${contact.id}`);
    res.status(201).json(contact);
  } catch (error: any) {
    logger.error(`Error creating contact: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

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

contactsRouter.put('/:id', async (req: Request, res: Response) => {
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

contactsRouter.delete('/:id', async (req: Request, res: Response) => {
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

contactsRouter.get('/due/calls', async (req: Request, res: Response) => {
  try {
    const contacts = ContactRepository.findDueForCall();
    res.json(contacts);
  } catch (error: any) {
    logger.error(`Error fetching due contacts: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});