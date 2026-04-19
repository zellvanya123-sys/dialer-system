#!/bin/bash
# Автоматический бэкап базы данных dialer
# Добавить в cron: 0 3 * * * bash /root/dialer-system/scripts/backup.sh

BACKUP_DIR="/root/backups"
DATA_DIR="/root/dialer-system/data"
TELEGRAM_BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN /root/dialer-system/.env | cut -d= -f2)
TELEGRAM_CHAT_ID=$(grep TELEGRAM_ADMIN_CHAT_ID /root/dialer-system/.env | cut -d= -f2)
DATE=$(date +%Y%m%d_%H%M)
KEEP_DAYS=30

mkdir -p $BACKUP_DIR

echo "[$(date)] Starting backup..."

# Бэкапим contacts.json
if [ -f "$DATA_DIR/contacts.json" ]; then
    cp "$DATA_DIR/contacts.json" "$BACKUP_DIR/contacts_$DATE.json"
    SIZE=$(du -sh "$BACKUP_DIR/contacts_$DATE.json" | cut -f1)
    echo "[$(date)] contacts.json backed up: $SIZE"
fi

# Бэкапим scheduler-state.json
if [ -f "$DATA_DIR/scheduler-state.json" ]; then
    cp "$DATA_DIR/scheduler-state.json" "$BACKUP_DIR/scheduler_$DATE.json"
fi

# Удаляем бэкапы старше 30 дней
find $BACKUP_DIR -name "*.json" -mtime +$KEEP_DAYS -delete
BACKUP_COUNT=$(ls $BACKUP_DIR/*.json 2>/dev/null | wc -l)

echo "[$(date)] Backup done. Total files: $BACKUP_COUNT"

# Уведомляем в Telegram
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    CONTACTS_COUNT=$(cat "$DATA_DIR/contacts.json" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('contacts',[])))" 2>/dev/null || echo "?")
    LOGS_COUNT=$(cat "$DATA_DIR/contacts.json" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('callLogs',[])))" 2>/dev/null || echo "?")

    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d chat_id="${TELEGRAM_CHAT_ID}" \
        -d text="🗄 Бэкап выполнен | ${DATE}
📊 Контактов: ${CONTACTS_COUNT}
📞 Звонков в логах: ${LOGS_COUNT}
💾 Размер: ${SIZE}
📁 Файлов бэкапа: ${BACKUP_COUNT}" \
        > /dev/null 2>&1
fi
