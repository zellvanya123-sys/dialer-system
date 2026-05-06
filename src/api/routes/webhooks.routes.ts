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

// Дедупликация
const processedWebhooks = new Set<string>();
setInterval(() => {
  if (processedWebhooks.size > 10000) processedWebhooks.clear();
}, 60 * 60 * 1000);

function findContactByPhone(phone: string) {
  const clean = phone.replace(/\D/g, '');
  const all = ContactRepository.findAll();
  return all.find(c => {
    const contactClean = c.phone.replace(/\D/g, '');
    return contactClean === clean
      || contactClean === '7' + clean.slice(1)
      || contactClean === '8' + clean.slice(1)
      || '7' + contactClean.slice(1) === clean;
  }) || null;
}

// ═══════════════════════════════════════════════════════
// МТС Exolve VATS webhook
// POST /api/webhooks/vats
// Документация: https://vpbxdocs.exolve.ru/
// ═══════════════════════════════════════════════════════
webhooksRouter.post('/vats', async (req: Request, res: Response) => {
  try {
    // Логируем всё для дебага
    logger.info(`VATS webhook received: ${JSON.stringify(req.body)}`);

    // Проверяем секрет
    const authKey = req.headers['x-vats-authorization']
      || req.headers['authorization']
      || req.body?.key;

    if (config.vats.webhookSecret && authKey !== config.vats.webhookSecret) {
      logger.warn(`VATS webhook: invalid auth. Got: ${authKey}`);
      // Не блокируем — просто логируем (на случай если МТС шлёт по другому)
    }

    // VATS шлёт события разных типов
    const cmd = req.body?.cmd || req.body?.command || req.body?.event;
    const callId = req.body?.call_id || req.body?.callId || req.body?.id;
    const phone = req.body?.phone
      || req.body?.from
      || req.body?.caller
      || req.body?.to
      || req.body?.callee;
    const status = req.body?.status || req.body?.disposition || req.body?.state;
    const duration = parseInt(req.body?.duration || '0');
    const recordUrl = req.body?.record_url || req.body?.recording_url;

    // Отвечаем сразу чтобы VATS не ретраил
    res.json({ success: true });

    // Команда history — звонок завершён
    if (cmd === 'history' || cmd === 'call_end' || cmd === 'hangup' || status === 'END') {

      const webhookKey = `vats_${callId}_end`;
      if (callId && processedWebhooks.has(webhookKey)) {
        logger.warn(`VATS: duplicate webhook ignored: ${webhookKey}`);
        return;
      }
      if (callId) processedWebhooks.add(webhookKey);

      if (!phone) {
        logger.warn('VATS webhook: no phone number in payload');
        onCallCompleted();
        return;
      }

      const contact = findContactByPhone(phone);
      if (!contact) {
        logger.warn(`VATS webhook: contact not found for ${phone}`);
        onCallCompleted();
        return;
      }

      // Маппим статус
      let callResult: CallResult;
      if (duration > 5) {
        callResult = CallResult.ANSWERED;
      } else if (status === 'BUSY' || status === 'busy') {
        callResult = CallResult.BUSY;
      } else if (status === 'NO_ANSWER' || status === 'no_answer' || status === 'NOANSWER') {
        callResult = CallResult.NO_ANSWER;
      } else if (status === 'ANSWERED' || status === 'answer' || duration > 0) {
        callResult = CallResult.ANSWERED;
      } else {
        callResult = CallResult.NO_ANSWER;
      }

      if (callId) activeCallIds.delete(String(callId));
      onCallCompleted();

      await createCallLog(contact.id, callResult, duration);
      await handleCallResult(contact.id, callResult);

      if (duration > 0) {
        ContactRepository.update(contact.id, { lastCallDuration: duration });
      }

      try {
        await sendCallNotification({
          name: contact.name,
          phone: contact.phone,
          status: callResult,
        });
      } catch {}

      logger.info(`VATS done | ${contact.name} | result=${callResult} | duration=${duration}s | record=${recordUrl || 'none'}`);
    }

    // Команда event — входящий/исходящий звонок начался
    if (cmd === 'event' || cmd === 'call_start') {
      logger.info(`VATS call started: ${phone} → ${req.body?.to || 'unknown'}`);
    }

  } catch (error: any) {
    logger.error(`VATS webhook error: ${error.message}`);
    logger.error(`VATS webhook body: ${JSON.stringify(req.body)}`);
  }
});

// ═══════════════════════════════════════════════════════
// Exolve dev API webhook
// POST /api/webhooks/exolve
// ═══════════════════════════════════════════════════════
webhooksRouter.post('/exolve', async (req: Request, res: Response) => {
  try {
    logger.info(`Exolve webhook: ${JSON.stringify(req.body)}`);
    res.json({ success: true });

    const { call_id, state, direction, to_number, from_number, duration, disconnect_reason } = req.body;
    if (state !== 'disconnected' || direction !== 'outbound') return;

    const webhookKey = `exolve_${call_id}_disconnected`;
    if (call_id && processedWebhooks.has(webhookKey)) return;
    if (call_id) processedWebhooks.add(webhookKey);

    const phone = to_number || from_number;
    if (!phone) return;

    const contact = findContactByPhone(phone);
    if (!contact) { onCallCompleted(); return; }

    const callDuration = parseInt(duration) || 0;
    let callResult: CallResult;
    if (callDuration > 0 && disconnect_reason === 'normal') callResult = CallResult.ANSWERED;
    else if (disconnect_reason === 'busy') callResult = CallResult.BUSY;
    else if (disconnect_reason === 'no_answer') callResult = CallResult.NO_ANSWER;
    else callResult = CallResult.NO_ANSWER;

    if (call_id) activeCallIds.delete(String(call_id));
    onCallCompleted();
    await createCallLog(contact.id, callResult, callDuration);
    await handleCallResult(contact.id, callResult);
    ContactRepository.update(contact.id, { lastCallDuration: callDuration });

    try { await sendCallNotification({ name: contact.name, phone: contact.phone, status: callResult }); } catch {}

  } catch (error: any) {
    logger.error(`Exolve webhook error: ${error.message}`);
  }
});

// ═══════════════════════════════════════════════════════
// Sipuni webhook (fallback)
// ═══════════════════════════════════════════════════════
webhooksRouter.post('/sipuni', async (req: Request, res: Response) => {
  try {
    logger.info(`Sipuni webhook: ${JSON.stringify(req.body)}`);
    const { event, call_id, src_num, dst_num, status, duration, timestamp, call_answer_timestamp } = req.body;

    if (String(event) === '1') return res.json({ success: true });
    if (String(event) !== '2') return res.json({ success: true });

    const webhookKey = `sipuni_${call_id}_2`;
    if (call_id && processedWebhooks.has(webhookKey)) return res.json({ success: true, duplicate: true });
    if (call_id) processedWebhooks.add(webhookKey);

    const phone = dst_num || src_num;
    if (!phone) return res.json({ success: true });

    const contact = findContactByPhone(phone);
    if (!contact) { onCallCompleted(); return res.json({ success: true }); }

    const answerTs = parseInt(call_answer_timestamp) || 0;
    const endTs = parseInt(timestamp) || 0;
    const callDuration = answerTs > 0 && endTs > 0 ? endTs - answerTs : 0;

    let callResult: CallResult;
    switch (status?.toUpperCase()) {
      case 'ANSWER': callResult = callDuration > 0 ? CallResult.ANSWERED : CallResult.HANGUP; break;
      case 'BUSY': callResult = CallResult.BUSY; break;
      case 'NOANSWER': callResult = CallResult.NO_ANSWER; break;
      default: callResult = CallResult.NO_ANSWER;
    }

    if (call_id) activeCallIds.delete(String(call_id));
    onCallCompleted();
    await createCallLog(contact.id, callResult, callDuration);
    await handleCallResult(contact.id, callResult);
    ContactRepository.update(contact.id, { lastCallDuration: callDuration });

    try { await sendCallNotification({ name: contact.name, phone: contact.phone, status: callResult }); } catch {}

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Sipuni webhook error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

webhooksRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
