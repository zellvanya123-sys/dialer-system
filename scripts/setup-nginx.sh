#!/bin/bash
# Скрипт установки Nginx + SSL для dialer системы
# Запускать на сервере: bash /root/dialer-system/scripts/setup-nginx.sh

DOMAIN=${1:-"dialer.example.com"}   # передай домен как аргумент
EMAIL=${2:-"admin@example.com"}       # email для Let's Encrypt

echo "=== Устанавливаем Nginx + SSL для $DOMAIN ==="

# 1. Устанавливаем Nginx и Certbot
apt update -y
apt install -y nginx certbot python3-certbot-nginx

# 2. Создаём конфиг Nginx
cat > /etc/nginx/sites-available/dialer << EOF
server {
    listen 80;
    server_name $DOMAIN;

    # Редирект на HTTPS
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    # SSL (заполнится certbot автоматически)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    # Заголовки безопасности
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
    gzip_min_length 1000;

    # Проксируем на Node.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }

    # Webhook Sipuni — без Basic Auth
    location /api/webhooks/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    # Health check — без авторизации
    location /api/health {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
    }

    # Логи
    access_log /var/log/nginx/dialer_access.log;
    error_log /var/log/nginx/dialer_error.log;
}
EOF

# 3. Активируем конфиг
ln -sf /etc/nginx/sites-available/dialer /etc/nginx/sites-enabled/dialer
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== Nginx настроен. Получаем SSL сертификат... ==="

# 4. Получаем SSL сертификат
certbot --nginx -d $DOMAIN --email $EMAIL --agree-tos --non-interactive

# 5. Автообновление сертификата (уже настроено certbot, просто проверяем)
systemctl enable certbot.timer

echo "=== Готово! Сайт доступен на https://$DOMAIN ==="
echo "Не забудь настроить DNS: A-запись $DOMAIN -> $(curl -s ifconfig.me)"
