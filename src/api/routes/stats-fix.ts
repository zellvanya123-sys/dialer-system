// ✅ FIX #10: Stats использует оптимизированный метод SQLite вместо findAll()
callsRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    // Один быстрый запрос вместо загрузки всей базы в память
    const dbStats = ContactRepository.getStats();
    const sm = dbStats.statusMap;
    const logStats = dbStats.logStats || { total: 0, answered: 0, total_duration: 0 };

    const leads = ContactRepository.findByStatus(ContactStatus.LEAD);
    const leadsByQualification = {
      withBudget: leads.filter(c => c.qualification?.hasBudget === true).length,
      withTask: leads.filter(c => c.qualification?.hasTask === true).length,
      decisionMaker: leads.filter(c =>
        c.qualification?.decisionMaker && c.qualification.decisionMaker !== ''
      ).length,
    };

    const stats = {
      total: dbStats.total,
      new: sm['new'] || 0,
      inProgress: (sm['call1'] || 0) + (sm['call2'] || 0) + (sm['call3'] || 0),
      leads: sm['lead'] || 0,
      rejected: sm['reject'] || 0,
      noAnswer: sm['no_answer'] || 0,
      dueForCall: dbStats.dueCount,
      totalCalls: logStats.total || 0,
      answeredCalls: logStats.answered || 0,
      totalDurationSec: logStats.total_duration || 0,
      conversionRate: logStats.total > 0
        ? Math.round((logStats.answered / logStats.total) * 100)
        : 0,
      activeCalls: getAutoDialStatus().activeCalls,
      autoDialEnabled: getAutoDialStatus().enabled,
      leadsByQualification,
    };

    res.json(stats);
  } catch (error: any) {
    logger.error(`Error getting stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});
