import { Router, Request, Response } from 'express';
import { handleCallResult, onCallCompleted } from '../../core/scheduler/scheduler.service';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { createCallLog } from '../../core/dialer/dialer.module';
import { CallResult } from '../../core/contacts/contact.model';
import { formatPhoneForCall } from '../../core/scheduler/timezone';
import { sendCallNotification } from '../../integrations/telegram/telegram.service';
import { activeCallIds } from './calls.routes';
import { config } from '../../config/index';
import logger from '../../utils/logger';

export const webhooksRouter = Router();

// ✅ Дедупликация — не обрабатываем один webhook дважды
const processedWebhooks = new Set<string>();
setInterval(() => {
  if (processedWebhooks.size > 10000) processedWebhooks.clear();
}, 60 * 60 * 1000);

function findContactByPhone(phone: string) {
  const clean = phone.replace(/\D/g, '');
  const all = ContactRepository.findAll();
  return all.find(c => {
    const contactClean = c.phone.replace(/\D/g, '');
    return contactClean === clean ||
      contactClean === '7' + clean.slice(1) ||
      contactClean === '8' + clean.slice(1);
  }) || null;
}

// ═══════════════════════════════════════════════
// МТС Exolve webhook
// POST /api/webhooks/exolve
// Документация: https://exolve.ru/docs/voice/
// ═══════════════════════════════════════════════
webhooksRouter.post('/exolve', async (req: Request, res: Response) => {
  try {
    logger.info(`Exolve webhook: ${JSON.stringify(req.body)}`);

    const {
      call_id,
      state,          // calling, connected, disconnected
      direction,      // outbound / inbound
      from_number,
      to_number,
      duration,       // секунды разговора
      disconnect_reason, // normal, busy, no_answer, failed
    } = req.body;

    // Отвечаем сразу чтобы Exolve не ретраил
    res.json({ success: true });

    // Нас интересуют только завершённые исходящие звонки
    if (state !== 'disconnected' || direction !== 'outbound') return;

    // Дедупликация
    const webhookKey = `${call_id}_disconnected`;
    if (call_id && processedWebhooks.has(webhookKey)) {
      logger.warn(`Exolve: duplicate webhook ignored: ${webhookKey}`);
      return;
    }
    if (call_id) processedWebhooks.add(webhookKey);

    // Ищем контакт по номеру
    const phone = to_number || from_number;
    if (!phone) {
      logger.warn('Exolve webhook: no phone number');
      return;
    }

    const contact = findContactByPhone(phone);
    if (!contact) {
      logger.warn(`Exolve webhook: contact not found for ${phone}`);
      onCallCompleted();
      return;
    }

    // Маппим статус Exolve → наш CallResult
    const callDuration = parseInt(duration) || 0;
    let callResult: CallResult;

    if (callDuration > 0 && disconnect_reason === 'normal') {
      callResult = CallResult.ANSWERED;
    } else if (disconnect_reason === 'busy') {
      callResult = CallResult.BUSY;
    } else if (disconnect_reason === 'no_answer') {
      callResult = CallResult.NO_ANSWER;
    } else if (disconnect_reason === 'failed') {
      callResult = CallResult.CONGESTED;
    } else {
      callResult = CallResult.NO_ANSWER;
    }

    // Снимаем с трекера (отключаем fallback таймер)
    if (call_id) activeCallIds.delete(call_id);

    // Уменьшаем счётчик активных звонков
    onCallCompleted();

    // Сохраняем лог
    await createCallLog(contact.id, callResult, callDuration);

    // Обновляем статус контакта
    await handleCallResult(contact.id, callResult);

    // Обновляем длительность
    ContactRepository.update(contact.id, { lastCallDuration: callDuration });

    // Telegram уведомление
    try {
      await sendCallNotification({
        name: contact.name,
        phone: contact.phone,
        status: callResult,
      });
    } catch (tgError: any) {
      logger.warn(`Telegram notification failed: ${tgError.message}`);
    }

    logger.info(`Exolve done | ${contact.name} | result=${callResult} | duration=${callDuration}s`);

  } catch (error: any) {
    logger.error(`Exolve webhook error: ${error.message}`);
  }
});

// ═══════════════════════════════════════════════
// Sipuni webhook (оставлен для совместимости)
// POST /api/webhooks/sipuni
// ═══════════════════════════════════════════════
function mapSipuniStatus(status: string, duration: number): CallResult {
  switch (status?.toUpperCase()) {
    case 'ANSWER': return duration > 0 ? CallResult.ANSWERED : CallResult.HANGUP;
    case 'BUSY': return CallResult.BUSY;
    case 'NOANSWER': return CallResult.NO_ANSWER;
    case 'CANCEL': return CallResult.HANGUP;
    case 'CONGESTION': return CallResult.CONGESTED;
    default: return CallResult.NO_ANSWER;
  }
}

function isAnsweringMachine(data: any): boolean {
  const dstType = (data.dst_type || '').toLowerCase();
  if (dstType === 'ivr' || dstType === 'machine') return true;
  const answerTs = parseInt(data.call_answer_timestamp || '0');
  const startTs = parseInt(data.call_start_timestamp || '0');
  if (answerTs > 0 && startTs > 0) {
    const timeToAnswer = answerTs - startTs;
    const dur = parseInt(String(data.duration || '0'));
    if (timeToAnswer < 1 && dur < 3) return true;
  }
  return false;
}

webhooksRouter.post('/sipuni', async (req: Request, res: Response) => {
  try {
    const { event, call_id, src_num, dst_num, dst_type, src_type,
      status, duration, timestamp, call_start_timestamp, call_answer_timestamp } = req.body;

    logger.info(`Sipuni webhook: event=${event}, call_id=${call_id}, status=${status}`);

    if (String(event) === '1') return res.json({ success: true });
    if (String(event) !== '2') return res.json({ success: true });

    // Дедупликация
    const webhookKey = `sipuni_${call_id}_2`;
    if (call_id && processedWebhooks.has(webhookKey)) {
      logger.warn(`Sipuni duplicate webhook ignored: ${webhookKey}`);
      return res.json({ success: true, duplicate: true });
    }
    if (call_id) processedWebhooks.add(webhookKey);

    const phone = dst_num || src_num;
    if (!phone) return res.json({ success: true });

    const contact = findContactByPhone(phone);
    if (!contact) {
      onCallCompleted();
      return res.json({ success: true });
    }

    const answerTs = parseInt(call_answer_timestamp) || 0;
    const endTs = parseInt(timestamp) || 0;
    const callDuration = answerTs > 0 && endTs > 0 ? endTs - answerTs : 0;

    const machine = isAnsweringMachine({ dst_type, src_type, duration, call_answer_timestamp, call_start_timestamp, status });
    const callResult = machine ? CallResult.MACHINE : mapSipuniStatus(status, callDuration);

    if (call_id) activeCallIds.delete(call_id);
    onCallCompleted();
    await createCallLog(contact.id, callResult, callDuration);
    await handleCallResult(contact.id, callResult);
    ContactRepository.update(contact.id, { lastCallDuration: callDuration });

    try {
      await sendCallNotification({ name: contact.name, phone: contact.phone, status: machine ? 'answering_machine' : callResult });
    } catch {}

    logger.info(`Sipuni done | ${contact.name} | result=${callResult} | duration=${callDuration}s`);
    res.json({ success: true });

  } catch (error: any) {
    logger.error(`Sipuni webhook error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

webhooksRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
