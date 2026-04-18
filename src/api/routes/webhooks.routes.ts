import { Router, Request, Response } from 'express';
import { handleCallResult, onCallCompleted } from '../../core/scheduler/scheduler.service';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { createCallLog } from '../../core/dialer/dialer.module';
import { CallResult } from '../../core/contacts/contact.model';
import { formatPhoneForCall } from '../../core/scheduler/timezone';
import { sendCallNotification } from '../../integrations/telegram/telegram.service';
import logger from '../../utils/logger';

export const webhooksRouter = Router();

// ✅ Поиск контакта по телефону
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

// ✅ Маппинг статуса Sipuni → наш CallResult
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

// ✅ AMD детектор — определяем автоответчик по признакам
// Sipuni передаёт dst_type или src_type = 'ivr'/'machine' для автоответчиков
// Также детектируем по очень короткому времени ответа и специфическим статусам
function isAnsweringMachine(data: {
  dst_type?: string;
  src_type?: string;
  duration?: number;
  call_answer_timestamp?: string;
  call_start_timestamp?: string;
  status?: string;
}): boolean {
  // Sipuni прямо говорит что это машина
  const dstType = (data.dst_type || '').toLowerCase();
  const srcType = (data.src_type || '').toLowerCase();
  if (dstType === 'ivr' || dstType === 'machine' || srcType === 'ivr' || srcType === 'machine') {
    return true;
  }

  // Звонок ответили но сразу сбросили (< 3 секунд) — скорее всего автоответчик
  const answerTs = parseInt(data.call_answer_timestamp || '0');
  const startTs = parseInt(data.call_start_timestamp || '0');
  if (answerTs > 0 && startTs > 0) {
    const timeToAnswer = answerTs - startTs;
    const duration = parseInt(String(data.duration || '0'));
    // Ответил мгновенно (< 1 сек) и разговор очень короткий (< 3 сек)
    if (timeToAnswer < 1 && duration < 3) {
      return true;
    }
  }

  return false;
}

// ✅ Проверка секретного токена Sipuni
function verifySipuniToken(req: Request): boolean {
  const webhookSecret = process.env.SIPUNI_WEBHOOK_SECRET;

  // Если секрет не задан — пропускаем проверку (совместимость)
  if (!webhookSecret) return true;

  const token = req.headers['x-sipuni-token'] || req.body?.token || req.query?.token;
  return token === webhookSecret;
}

/**
 * Sipuni HTTP API webhook
 * event=1 — начало звонка
 * event=2 — завершение звонка
 */
webhooksRouter.post('/sipuni', async (req: Request, res: Response) => {
  try {
    // ✅ Проверка токена
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

    logger.info(`Sipuni webhook: event=${event}, call_id=${call_id}, src=${src_num}, dst=${dst_num}, status=${status}, dst_type=${dst_type}`);

    // event=1 — звонок начался
    if (String(event) === '1') {
      logger.info(`Sipuni: call started, call_id=${call_id}`);
      return res.json({ success: true });
    }

    // event=2 — звонок завершился
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

      // Считаем длительность
      const answerTs = parseInt(call_answer_timestamp) || 0;
      const endTs = parseInt(timestamp) || 0;
      let callDuration = 0;
      if (answerTs > 0 && endTs > 0) {
        callDuration = endTs - answerTs;
      }

      // ✅ AMD: проверяем автоответчик ДО маппинга статуса
      const machine = isAnsweringMachine({
        dst_type, src_type, duration,
        call_answer_timestamp, call_start_timestamp, status,
      });

      let callResult: CallResult;

      if (machine) {
        // Автоответчик — помечаем как MACHINE и перезваниваем позже
        callResult = CallResult.MACHINE;
        logger.info(`Sipuni: ANSWERING MACHINE detected for ${contact.name} (${phone})`);
      } else {
        callResult = mapSipuniStatus(status, callDuration);
      }

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
          status: machine ? 'machine' : callResult,
        });
      } catch (tgError: any) {
        logger.warn(`Telegram notification failed: ${tgError.message}`);
      }

      logger.info(`Sipuni: done | contact=${contact.name} | status=${status} | result=${callResult} | duration=${callDuration}s | machine=${machine}`);
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
