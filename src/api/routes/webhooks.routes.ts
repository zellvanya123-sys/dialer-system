import { Router, Request, Response } from 'express';
import { handleCallResult, onCallCompleted } from '../../core/scheduler/scheduler.service';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { createCallLog } from '../../core/dialer/dialer.module';
import { CallResult } from '../../core/contacts/contact.model';
import { formatPhoneForCall } from '../../core/scheduler/timezone';
import { sendCallNotification } from '../../integrations/telegram/telegram.service';
import { activeCallIds } from './calls.routes';
import logger from '../../utils/logger';

export const webhooksRouter = Router();

// ✅ FIX #19: Дедупликация webhook — Set обработанных call_id
const processedWebhooks = new Set<string>();
// Очищаем старые через час чтобы не течь память
setInterval(() => {
  if (processedWebhooks.size > 10000) processedWebhooks.clear();
}, 60 * 60 * 1000);

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

function isAnsweringMachine(data: {
  dst_type?: string;
  src_type?: string;
  duration?: number;
  call_answer_timestamp?: string;
  call_start_timestamp?: string;
  status?: string;
}): boolean {
  const dstType = (data.dst_type || '').toLowerCase();
  const srcType = (data.src_type || '').toLowerCase();
  if (dstType === 'ivr' || dstType === 'machine' || srcType === 'ivr' || srcType === 'machine') {
    return true;
  }

  const answerTs = parseInt(data.call_answer_timestamp || '0');
  const startTs = parseInt(data.call_start_timestamp || '0');
  if (answerTs > 0 && startTs > 0) {
    const timeToAnswer = answerTs - startTs;
    const duration = parseInt(String(data.duration || '0'));
    if (timeToAnswer < 1 && duration < 3) return true;
  }

  return false;
}

function verifySipuniToken(req: Request): boolean {
  const webhookSecret = process.env.SIPUNI_WEBHOOK_SECRET;
  if (!webhookSecret) return true;
  const token = req.headers['x-sipuni-token'] || req.body?.token || req.query?.token;
  return token === webhookSecret;
}

webhooksRouter.post('/sipuni', async (req: Request, res: Response) => {
  try {
    if (!verifySipuniToken(req)) {
      logger.warn(`Sipuni webhook: invalid token from ${req.ip}`);
      return res.status(403).json({ error: 'Forbidden: invalid token' });
    }

    const {
      event,
      call_id,
      src_num,
      dst_num,
      dst_type,
      src_type,
      status,
      duration,
      timestamp,
      call_start_timestamp,
      call_answer_timestamp,
    } = req.body;

    logger.info(`Sipuni webhook: event=${event}, call_id=${call_id}, src=${src_num}, dst=${dst_num}, status=${status}`);

    // event=1 — звонок начался
    if (String(event) === '1') {
      return res.json({ success: true });
    }

    // event=2 — звонок завершился
    if (String(event) === '2') {
      // ✅ FIX #19: Дедупликация — один call_id обрабатываем только раз
      const webhookKey = `${call_id}_${event}`;
      if (call_id && processedWebhooks.has(webhookKey)) {
        logger.warn(`Duplicate webhook ignored: ${webhookKey}`);
        return res.json({ success: true, duplicate: true });
      }
      if (call_id) processedWebhooks.add(webhookKey);

      const phone = dst_num || src_num;
      if (!phone) {
        logger.warn('Sipuni webhook: no phone number');
        return res.json({ success: true });
      }

      const contact = findContactByPhone(phone);
      if (!contact) {
        logger.warn(`Sipuni webhook: contact not found for ${phone}`);
        // ✅ FIX #2: Всё равно уменьшаем счётчик чтобы не зависал
        onCallCompleted();
        return res.json({ success: true });
      }

      const answerTs = parseInt(call_answer_timestamp) || 0;
      const endTs = parseInt(timestamp) || 0;
      let callDuration = 0;
      if (answerTs > 0 && endTs > 0) {
        callDuration = endTs - answerTs;
      }

      const machine = isAnsweringMachine({
        dst_type, src_type, duration,
        call_answer_timestamp, call_start_timestamp, status,
      });

      const callResult: CallResult = machine
        ? CallResult.MACHINE
        : mapSipuniStatus(status, callDuration);

      if (machine) {
        logger.info(`Sipuni: ANSWERING MACHINE for ${contact.name} (${phone})`);
      }

      // ✅ FIX #2: Снимаем call_id с трекера (отключаем fallback таймер)
      if (call_id) activeCallIds.delete(call_id);

      // 1. Уменьшаем счётчик активных звонков
      onCallCompleted();

      // 2. Сохраняем лог в БД
      await createCallLog(contact.id, callResult, callDuration);

      // 3. Обновляем статус контакта
      await handleCallResult(contact.id, callResult);

      // 4. Обновляем длительность
      ContactRepository.update(contact.id, { lastCallDuration: callDuration });

      // 5. Уведомление в Telegram
      try {
        await sendCallNotification({
          name: contact.name,
          phone: contact.phone,
          status: machine ? 'answering_machine' : callResult,
        });
      } catch (tgError: any) {
        logger.warn(`Telegram notification failed: ${tgError.message}`);
      }

      logger.info(`Sipuni done | ${contact.name} | result=${callResult} | duration=${callDuration}s`);
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
