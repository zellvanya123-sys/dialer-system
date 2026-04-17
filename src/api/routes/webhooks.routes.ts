import { Router, Request, Response } from 'express';
import { handleCallResult } from '../../core/scheduler/scheduler.service';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { CallResult } from '../../core/contacts/contact.model';
import { formatPhoneForCall } from '../../core/scheduler/timezone';
import logger from '../../utils/logger';

export const webhooksRouter = Router();

function findContactByPhone(phone: string) {
  const clean = phone.replace(/\D/g, '');
  const normalized = formatPhoneForCall(phone);
  const all = ContactRepository.findAll();
  return all.find(c => {
    const contactClean = c.phone.replace(/\D/g, '');
    const contactNorm = formatPhoneForCall(c.phone);
    return contactNorm === normalized || contactClean === clean;
  }) || null;
}

function mapSipuniStatus(status: string, duration: number): CallResult {
  switch (status?.toUpperCase()) {
    case 'ANSWER':
      return duration > 0 ? CallResult.ANSWERED : CallResult.HANGUP;
    case 'BUSY':
      return CallResult.BUSY;
    case 'NOANSWER':
      return CallResult.NO_ANSWER;
    case 'CANCEL':
      return CallResult.HANGUP;
    case 'CONGESTION':
      return CallResult.CONGESTED;
    case 'CHANUNAVAIL':
      return CallResult.NO_ANSWER;
    default:
      return CallResult.NO_ANSWER;
  }
}

/**
 * Sipuni HTTP API webhook
 * event=1 — начало звонка
 * event=2 — завершение звонка (hang up)
 *
 * Параметры: event, call_id, src_num, dst_num, src_type, dst_type,
 * timestamp, call_start_timestamp, call_answer_timestamp, status, duration
 */
webhooksRouter.post('/sipuni', async (req: Request, res: Response) => {
  try {
    const {
      event,
      call_id,
      src_num,
      dst_num,
      status,
      timestamp,
      call_start_timestamp,
      call_answer_timestamp,
    } = req.body;

    logger.info(`Sipuni webhook: event=${event}, call_id=${call_id}, src=${src_num}, dst=${dst_num}, status=${status}`);

    if (String(event) === '2') {
      const phone = dst_num || src_num;
      if (!phone) {
        logger.warn('Sipuni webhook: no phone number');
        return res.json({ success: true });
      }

      const contact = findContactByPhone(phone);
      if (!contact) {
        logger.warn(`Sipuni webhook: contact not found for ${phone}`);
        return res.json({ success: true });
      }

      const startTs = parseInt(call_start_timestamp) || 0;
      const answerTs = parseInt(call_answer_timestamp) || 0;
      const endTs = parseInt(timestamp) || 0;

      let callDuration = 0;
      if (answerTs > 0 && endTs > 0) {
        callDuration = endTs - answerTs;
      }

      const callResult = mapSipuniStatus(status, callDuration);

      await handleCallResult(contact.id, callResult);

      ContactRepository.update(contact.id, {
        lastCallDuration: callDuration,
      });

      logger.info(`Sipuni: processed call for ${contact.name} (${phone}), status=${status}, result=${callResult}, duration=${callDuration}s`);
    }

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Sipuni webhook error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

webhooksRouter.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
