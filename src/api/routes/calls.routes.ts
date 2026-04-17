import { Router, Request, Response } from 'express';
import { getDialer } from '../../core/dialer/dialer.module';
import { handleCallResult, scheduleAllDueCalls, enableAutoDial, disableAutoDial, getAutoDialStatus, onCallCompleted } from '../../core/scheduler/scheduler.service';
import { getAIVoice } from '../../core/ai-voice/ai-voice.service';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { ContactStatus, CallResult } from '../../core/contacts/contact.model';
import { sendLeadNotification, sendCallNotification } from '../../integrations/telegram/telegram.service';
import { validateCallResult } from '../middleware/validation';
import logger from '../../utils/logger';

export const callsRouter = Router();

callsRouter.post('/initiate/:contactId', async (req: Request, res: Response) => {
  try {
    const contact = ContactRepository.findById(req.params.contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Контакт не найден' });
    }

    const dialer = getDialer();
    const callId = await dialer.makeCall(req.params.contactId);

    ContactRepository.update(req.params.contactId, {
      lastCallAt: new Date().toISOString(),
    });

    res.json({ success: true, callId });
  } catch (error: any) {
    logger.error(`Error initiating call: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

callsRouter.post('/result', async (req: Request, res: Response) => {
  try {
    const validation = validateCallResult(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    const { contactId, result, qualification } = req.body;

    await handleCallResult(contactId, result as CallResult, qualification);

    const contact = ContactRepository.findById(contactId);
    if (contact) {
      if (contact.status === ContactStatus.LEAD) {
        await sendLeadNotification({
          name: contact.name,
          phone: contact.phone,
          qualification: qualification
        });
      } else {
        await sendCallNotification({
          name: contact.name,
          phone: contact.phone,
          status: contact.status
        });
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Error handling call result: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

callsRouter.post('/schedule', async (req: Request, res: Response) => {
  try {
    const scheduled = await scheduleAllDueCalls();
    res.json({ success: true, scheduled });
  } catch (error: any) {
    logger.error(`Error scheduling calls: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

callsRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const all = ContactRepository.findAll();
    const stats = {
      total: all.length,
      new: all.filter(c => c.status === ContactStatus.NEW).length,
      inProgress: all.filter(c => [ContactStatus.CALL_1, ContactStatus.CALL_2, ContactStatus.CALL_3].includes(c.status)).length,
      leads: all.filter(c => c.status === ContactStatus.LEAD).length,
      rejected: all.filter(c => c.status === ContactStatus.REJECT).length,
      noAnswer: all.filter(c => c.status === ContactStatus.NO_ANSWER).length,
      dueForCall: ContactRepository.findDueForCall().length,
    };

    res.json(stats);
  } catch (error: any) {
    logger.error(`Error getting stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

callsRouter.post('/auto/enable', async (req: Request, res: Response) => {
  enableAutoDial();
  res.json({ success: true });
});

callsRouter.post('/auto/disable', async (req: Request, res: Response) => {
  disableAutoDial();
  res.json({ success: true });
});

callsRouter.get('/auto/status', async (req: Request, res: Response) => {
  res.json(getAutoDialStatus());
});

callsRouter.post('/completed/:contactId', async (req: Request, res: Response) => {
  onCallCompleted();
  res.json({ success: true });
});

callsRouter.put('/ai-script', async (req: Request, res: Response) => {
  try {
    const { systemPrompt, welcomeMessage, maxTurns, timeoutMs } = req.body;
    getAIVoice().updateConfig({ systemPrompt, welcomeMessage, maxTurns, timeoutMs });
    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Error updating AI script: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

callsRouter.get('/ai-script', async (req: Request, res: Response) => {
  const sessions = getAIVoice().getAllSessions();
  res.json({ sessions, sessionCount: sessions.length });
});
