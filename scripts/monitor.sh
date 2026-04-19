#!/bin/bash
# Мониторинг сервера — запускать каждые 5 минут через cron
# Добавить в cron: */5 * * * * bash /root/dialer-system/scripts/monitor.sh

TELEGRAM_BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN /root/dialer-system/.env | cut -d= -f2)
TELEGRAM_CHAT_ID=$(grep TELEGRAM_ADMIN_CHAT_ID /root/dialer-system/.env | cut -d= -f2)
HEALTH_URL="http://localhost:3000/api/health"
ALERT_FILE="/tmp/dialer_alert_sent"

send_alert() {
    local msg="$1"
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d chat_id="${TELEGRAM_CHAT_ID}" \
            -d text="$msg" > /dev/null 2>&1
    fi
}

# Проверяем что сервер отвечает
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 $HEALTH_URL 2>/dev/null)

if [ "$HTTP_CODE" != "200" ]; then
    # Сервер не отвечает
    if [ ! -f "$ALERT_FILE" ]; then
        touch $ALERT_FILE
        send_alert "🚨 АЛЕРТ: Dialer сервер не отвечает!
URL: $HEALTH_URL
HTTP код: $HTTP_CODE
Время: $(date)
Попытка перезапуска..."
        # Пробуем перезапустить
        pm2 restart dialer --update-env 2>/dev/null
        sleep 10
        # Проверяем снова
        HTTP_CODE2=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 $HEALTH_URL 2>/dev/null)
        if [ "$HTTP_CODE2" = "200" ]; then
            send_alert "✅ Dialer перезапущен успешно!"
            rm -f $ALERT_FILE
        else
            send_alert "❌ Перезапуск не помог. Требуется ручное вмешательство!"
        fi
    fi
else
    # Сервер работает — убираем флаг алерта
    if [ -f "$ALERT_FILE" ]; then
        rm -f $ALERT_FILE
        send_alert "✅ Dialer сервер восстановлен и работает нормально"
    fi
fi

# Проверяем диск (алерт если занято > 85%)
DISK_USAGE=$(df / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 85 ]; then
    DISK_ALERT="/tmp/dialer_disk_alert"
    if [ ! -f "$DISK_ALERT" ]; then
        touch $DISK_ALERT
        send_alert "⚠️ ДИСК почти полный: ${DISK_USAGE}% занято!
Сервер: 62.60.249.223
Проверь: du -sh /root/dialer-system/data/audio/*"
    fi
else
    rm -f /tmp/dialer_disk_alert 2>/dev/null
fi

# Проверяем RAM (алерт если > 90%)
RAM_USAGE=$(free | awk 'NR==2{printf "%.0f", $3/$2*100}')
if [ "$RAM_USAGE" -gt 90 ]; then
    send_alert "⚠️ RAM критически высокая: ${RAM_USAGE}%"
fi
