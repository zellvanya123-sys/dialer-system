import { Router, Request, Response } from 'express';
import { getDialer, createCallLog } from '../../core/dialer/dialer.module';
import { handleCallResult, scheduleAllDueCalls, enableAutoDial, disableAutoDial, getAutoDialStatus, onCallCompleted } from '../../core/scheduler/scheduler.service';
import { getAIVoice } from '../../core/ai-voice/ai-voice.service';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { ContactStatus, CallResult } from '../../core/contacts/contact.model';
import { sendLeadNotification, sendCallNotification } from '../../integrations/telegram/telegram.service';
import { requireApiKey, validateCallResult } from '../middleware/validation';
import logger from '../../utils/logger';

export const callsRouter = Router();

// ✅ Инициировать звонок вручную
callsRouter.post('/initiate/:contactId', requireApiKey, async (req: Request, res: Response) => {
  try {
    const contact = ContactRepository.findById(req.params.contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Контакт не найден' });
    }

    // ✅ Проверяем лимит параллельных звонков
    const { activeCalls } = getAutoDialStatus();
    const MAX_CONCURRENT = 3;
    if (activeCalls >= MAX_CONCURRENT) {
      return res.status(429).json({
        error: `Превышен лимит параллельных звонков (${MAX_CONCURRENT}). Сейчас активно: ${activeCalls}`
      });
    }

    // ✅ Проверяем нет ли уже активного звонка этому контакту
    const sessions = getAIVoice().getAllSessions();
    const alreadyCalling = sessions.some(
      s => s.contactId === req.params.contactId && s.status === 'in_progress'
    );
    if (alreadyCalling) {
      return res.status(409).json({ error: 'Этому контакту уже звонят прямо сейчас' });
    }

    const dialer = getDialer();
    const callId = await dialer.makeCall(req.params.contactId);

    // ✅ Увеличиваем счётчик активных звонков
    // (activeCalls управляется через onCallCompleted в scheduler)
    ContactRepository.update(req.params.contactId, {
      lastCallAt: new Date().toISOString(),
    });

    // ✅ Автоматически уменьшаем счётчик через 60 сек если webhook не придёт
    setTimeout(() => {
      onCallCompleted();
    }, 60000);

    res.json({ success: true, callId });
  } catch (error: any) {
    logger.error(`Error initiating call: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Обработать результат звонка
callsRouter.post('/result', requireApiKey, async (req: Request, res: Response) => {
  try {
    const validation = validateCallResult(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    const { contactId, result, qualification } = req.body;

    await handleCallResult(contactId, result as CallResult, qualification);

    // ✅ Сохраняем лог
    await createCallLog(contactId, result as CallResult);

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

// Запланировать все ожидающие звонки
callsRouter.post('/schedule', requireApiKey, async (req: Request, res: Response) => {
  try {
    const scheduled = await scheduleAllDueCalls();
    res.json({ success: true, scheduled });
  } catch (error: any) {
    logger.error(`Error scheduling calls: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Статистика — открытый роут (не страшно)
callsRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const all = ContactRepository.findAll();
    const totalCalls = all.reduce((sum, c) => sum + (c.attemptCount || 0), 0);
    const answeredCalls = all.filter(c => c.lastCallResult === CallResult.ANSWERED).length;
    const leads = all.filter(c => c.status === ContactStatus.LEAD);
    const totalDuration = all.reduce((sum, c) => sum + (c.lastCallDuration || 0), 0);

    const stats = {
      total: all.length,
      new: all.filter(c => c.status === ContactStatus.NEW).length,
      inProgress: all.filter(c =>
        [ContactStatus.CALL_1, ContactStatus.CALL_2, ContactStatus.CALL_3].includes(c.status)
      ).length,
      leads: leads.length,
      rejected: all.filter(c => c.status === ContactStatus.REJECT).length,
      noAnswer: all.filter(c => c.status === ContactStatus.NO_ANSWER).length,
      dueForCall: ContactRepository.findDueForCall().length,
      totalCalls,
      answeredCalls,
      totalDurationSec: totalDuration,
      conversionRate: totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0,
      activeCalls: getAutoDialStatus().activeCalls,
      autoDialEnabled: getAutoDialStatus().enabled,
    };

    res.json(stats);
  } catch (error: any) {
    logger.error(`Error getting stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Управление автодозвоном — только с API ключом
callsRouter.post('/auto/enable', requireApiKey, async (req: Request, res: Response) => {
  enableAutoDial();
  res.json({ success: true, message: 'Auto-dial enabled' });
});

callsRouter.post('/auto/disable', requireApiKey, async (req: Request, res: Response) => {
  disableAutoDial();
  res.json({ success: true, message: 'Auto-dial disabled' });
});

callsRouter.get('/auto/status', async (req: Request, res: Response) => {
  res.json(getAutoDialStatus());
});

// ✅ Завершение звонка — теперь логируем contactId
callsRouter.post('/completed/:contactId', requireApiKey, async (req: Request, res: Response) => {
  const { contactId } = req.params;
  onCallCompleted();
  logger.info(`Call completed via API for contact: ${contactId}`);
  res.json({ success: true });
});

// Обновить скрипт AI
callsRouter.put('/ai-script', requireApiKey, async (req: Request, res: Response) => {
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
