import { Router, Request, Response } from 'express';
import { getDialer } from '../../core/dialer/dialer.module.js';
import { handleCallResult } from '../../core/scheduler/scheduler.service.js';
import { ContactRepository } from '../../core/contacts/contact.repository.js';
import { CallResult, ContactStatus } from '../../core/contacts/contact.model.js';
import logger from '../../utils/logger.js';

export const webhooksRouter = Router();

webhooksRouter.post('/twilio-status', async (req: Request, res: Response) => {
  try {
    const { CallStatus, CallSid, CallDuration, Digits } = req.body;
    
    logger.info(`Twilio status: ${CallStatus}, SID: ${CallSid}`);
    
    if (CallStatus === 'completed') {
      const duration = parseInt(CallDuration) || 0;
      
      let result: CallResult;
      if (duration > 0) {
        result = CallResult.ANSWERED;
      } else {
        result = CallResult.NO_ANSWER;
      }
      
      const contacts = ContactRepository.findAll();
      const contact = contacts.find(c => c.lastCallAt);
      
      if (contact) {
        await handleCallResult(contact.id, result);
      }
    }

    res.status(200).send('<Response></Response>');
  } catch (error: any) {
    logger.error(`Webhook error: ${error.message}`);
    res.status(500).send('<Response></Response>');
  }
});

webhooksRouter.post('/twilio-call-status', async (req: Request, res: Response) => {
  try {
    const { CallStatus, CallSid, CallDuration, ContactookCallStatus } = req.body;
    
    logger.info(`Call status update: ${CallStatus}, SID: ${CallSid}`);
    
    res.status(200).send('<Response></Response>');
  } catch (error: any) {
    logger.error(`Webhook error: ${error.message}`);
    res.status(500).send('<Response></Response>');
  }
});

webhooksRouter.post('/zadarma', async (req: Request, res: Response) => {
  try {
    const { event, call_id, number } = req.body;
    
    logger.info(`Zadarma event: ${event}, call_id: ${call_id}`);
    
    if (event === 'call_end') {
      const contacts = ContactRepository.findAll();
      const contact = contacts.find(c => c.phone.includes(number));
      
      if (contact) {
        await handleCallResult(contact.id, CallResult.ANSWERED);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Zadarma webhook error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

webhooksRouter.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});