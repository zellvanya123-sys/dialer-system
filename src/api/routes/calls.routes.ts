import { Router, Request, Response } from 'express';
import { getDialer, initDialer } from '../../core/dialer/dialer.module.js';
import { handleCallResult, scheduleAllDueCalls, callQueue } from '../../core/scheduler/scheduler.service.js';
import { ContactRepository } from '../../core/contacts/contact.repository.js';
import { ContactStatus, CallResult } from '../../core/contacts/contact.model.js';
import { sendLeadNotification, sendCallNotification } from '../../integrations/telegram/telegram.service.js';
import logger from '../../utils/logger.js';

export const callsRouter = Router();

callsRouter.post('/initiate/:contactId', async (req: Request, res: Response) => {
  try {
    const dialer = getDialer();
    const callSid = await dialer.makeCall(req.params.contactId);
    
    res.json({ success: true, callSid });
  } catch (error: any) {
    logger.error(`Error initiating call: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

callsRouter.post('/result', async (req: Request, res: Response) => {
  try {
    const { contactId, result, qualification, duration } = req.body;
    
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

callsRouter.get('/queue/status', async (req: Request, res: Response) => {
  try {
    const waiting = await callQueue.getWaiting();
    const active = await callQueue.getActive();
    const completed = await callQueue.getCompleted();
    
    res.json({
      waiting: waiting.length,
      active: active.length,
      completed: completed.length
    });
  } catch (error: any) {
    logger.error(`Error getting queue status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});