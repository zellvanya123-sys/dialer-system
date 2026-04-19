import { Router, Request, Response } from 'express';
import { getDialer, createCallLog } from '../../core/dialer/dialer.module';
import { handleCallResult, scheduleAllDueCalls, enableAutoDial, disableAutoDial, getAutoDialStatus, onCallCompleted, incrementActiveCalls } from '../../core/scheduler/scheduler.service';
import { getAIVoice } from '../../core/ai-voice/ai-voice.service';
import { ContactRepository } from '../../core/contacts/contact.repository';
import { ContactStatus, CallResult } from '../../core/contacts/contact.model';
import { sendLeadNotification, sendCallNotification } from '../../integrations/telegram/telegram.service';
import { requireApiKey, validateCallResult } from '../middleware/validation';
import { config } from '../../config/index';
import logger from '../../utils/logger';

export const callsRouter = Router();

// ✅ FIX #2: Трекер активных звонков с call_id чтобы не двоить
const activeCallIds = new Set<string>();

// ✅ Инициировать звонок вручную с дашборда
callsRouter.post('/initiate/:contactId', requireApiKey, async (req: Request, res: Response) => {
  try {
    const contact = ContactRepository.findById(req.params.contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Контакт не найден' });
    }

    // Проверяем лимит параллельных звонков
    const { activeCalls } = getAutoDialStatus();
    const MAX_CONCURRENT = config.maxConcurrentCalls;
    if (activeCalls >= MAX_CONCURRENT) {
      return res.status(429).json({
        error: `Превышен лимит параллельных звонков (${MAX_CONCURRENT}). Сейчас активно: ${activeCalls}`
      });
    }

    // Проверяем нет ли уже активного звонка этому контакту
    const sessions = getAIVoice().getAllSessions();
    const alreadyCalling = sessions.some(
      s => s.contactId === req.params.contactId && s.status === 'in_progress'
    );
    if (alreadyCalling) {
      return res.status(409).json({ error: 'Этому контакту уже звонят прямо сейчас' });
    }

    const dialer = getDialer();
    const callId = await dialer.makeCall(req.params.contactId);

    // ✅ FIX #2: Увеличиваем счётчик ЯВНО и трекаем call_id
    incrementActiveCalls();
    activeCallIds.add(callId);

    ContactRepository.update(req.params.contactId, {
      lastCallAt: new Date().toISOString(),
      status: ContactStatus.CALL_1,
    });

    // ✅ FIX #2: Fallback таймер 5 минут (не 60 сек) — только если webhook не пришёл
    // При получении webhook call_id удаляется из activeCallIds и таймер не срабатывает
    const fallbackTimer = setTimeout(() => {
      if (activeCallIds.has(callId)) {
        activeCallIds.delete(callId);
        onCallCompleted();
        logger.warn(`Fallback timer fired for call ${callId} — webhook не пришёл за 5 минут`);
      }
    }, 5 * 60 * 1000);

    // Очищаем таймер при завершении процесса
    fallbackTimer.unref();

    res.json({ success: true, callId });
  } catch (error: any) {
    logger.error(`Error initiating call: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Обработать результат звонка (внешний вызов)
callsRouter.post('/result', requireApiKey, async (req: Request, res: Response) => {
  try {
    const validation = validateCallResult(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    const { contactId, result, qualification } = req.body;

    await handleCallResult(contactId, result as CallResult, qualification);
    await createCallLog(contactId, result as CallResult);

    const contact = ContactRepository.findById(contactId);
    if (contact) {
      if (contact.status === ContactStatus.LEAD) {
        await sendLeadNotification({ name: contact.name, phone: contact.phone, qualification });
      } else {
        await sendCallNotification({ name: contact.name, phone: contact.phone, status: contact.status });
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Error handling call result: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ✅ FIX #3: История звонков — реальные данные из БД
callsRouter.get('/logs', async (req: Request, res: Response) => {
  try {
    const logs = ContactRepository.findAllCallLogs();
    const contacts = ContactRepository.findAll();
    const contactMap = new Map(contacts.map(c => [c.id, c]));

    // Обогащаем логи данными контакта
    const enriched = logs
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 200) // последние 200 звонков
      .map(log => ({
        ...log,
        contactName: contactMap.get(log.contactId)?.name || 'Неизвестно',
        contactPhone: contactMap.get(log.contactId)?.phone || log.phone,
      }));

    res.json(enriched);
  } catch (error: any) {
    logger.error(`Error getting call logs: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ✅ FIX #4: Статистика с leadsByQualification
callsRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const all = ContactRepository.findAll();
    const logs = ContactRepository.findAllCallLogs();

    // Считаем по логам (правильно) а не по контактам
    const answeredLogs = logs.filter(l => l.result === CallResult.ANSWERED);
    const totalDuration = logs.reduce((sum, l) => sum + (l.duration || 0), 0);

    const leads = all.filter(c => c.status === ContactStatus.LEAD);

    // ✅ FIX #4: leadsByQualification
    const leadsByQualification = {
      withBudget: leads.filter(c => c.qualification?.hasBudget === true).length,
      withTask: leads.filter(c => c.qualification?.hasTask === true).length,
      decisionMaker: leads.filter(c => c.qualification?.decisionMaker && c.qualification.decisionMaker !== '').length,
    };

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
      totalCalls: logs.length,                    // ✅ по реальным логам
      answeredCalls: answeredLogs.length,          // ✅ по реальным логам
      totalDurationSec: totalDuration,
      conversionRate: logs.length > 0
        ? Math.round((answeredLogs.length / logs.length) * 100)
        : 0,
      activeCalls: getAutoDialStatus().activeCalls,
      autoDialEnabled: getAutoDialStatus().enabled,
      leadsByQualification,                       // ✅ FIX #4
    };

    res.json(stats);
  } catch (error: any) {
    logger.error(`Error getting stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Управление автодозвоном
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

// ✅ Завершение звонка через API (снимаем с трекера)
callsRouter.post('/completed/:callId', requireApiKey, async (req: Request, res: Response) => {
  const { callId } = req.params;
  if (activeCallIds.has(callId)) {
    activeCallIds.delete(callId);
    onCallCompleted();
  }
  logger.info(`Call completed via API: ${callId}`);
  res.json({ success: true });
});

// Обновить скрипт AI
callsRouter.put('/ai-script', requireApiKey, async (req: Request, res: Response) => {
  try {
    const { systemPrompt, welcomeMessage, maxTurns, timeoutMs } = req.body;
    getAIVoice().updateConfig({ systemPrompt, welcomeMessage, maxTurns, timeoutMs });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

callsRouter.get('/ai-script', async (req: Request, res: Response) => {
  const sessions = getAIVoice().getAllSessions();
  res.json({ sessions, sessionCount: sessions.length });
});

// Экспортируем трекер для использования в webhook
export { activeCallIds };
