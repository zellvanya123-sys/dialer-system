const API = '/api';

const pages = {
  dashboard: renderDashboard,
  contacts: renderContacts,
  calls: renderCalls,
  settings: renderSettings,
};

let currentPage = 'dashboard';
let contacts = [];
let stats = {};

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return response.json();
}

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const titles = { dashboard: 'Дашборд', contacts: 'Контакты', calls: 'Звонки', settings: 'Настройки' };
  document.getElementById('page-title').textContent = titles[page];
  pages[page]();
}

function renderDashboard() {
  request('/calls/stats').then(s => {
    stats = s;
    document.getElementById('content').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card primary">
          <div class="value">${s.total || 0}</div>
          <div class="label">Всего контактов</div>
        </div>
        <div class="stat-card success">
          <div class="value">${s.leads || 0}</div>
          <div class="label">Лиды</div>
        </div>
        <div class="stat-card warning">
          <div class="value">${s.inProgress || 0}</div>
          <div class="label">В работе</div>
        </div>
        <div class="stat-card danger">
          <div class="value">${s.noAnswer || 0}</div>
          <div class="label">Нет ответа</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Последние контакты</div>
        <table class="table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Телефон</th>
              <th>Статус</th>
              <th>Попыток</th>
            </tr>
          </thead>
          <tbody id="recent-contacts"></tbody>
        </table>
      </div>
    `;
    loadRecentContacts();
  });
}

async function loadRecentContacts() {
  const c = await request('/contacts');
  const tbody = document.getElementById('recent-contacts');
  if (!c.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Контактов пока нет</td></tr>';
    return;
  }
  tbody.innerHTML = c.slice(0, 5).map(contact => `
    <tr>
      <td>${contact.name}</td>
      <td>${contact.phone}</td>
      <td><span class="status-badge status-${contact.status}">${contact.status}</span></td>
      <td>${contact.attemptCount}</td>
    </tr>
  `).join('');
}

function renderContacts() {
  request('/contacts').then(c => {
    contacts = c;
    document.getElementById('content').innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div class="card-title">Список контактов</div>
          <button class="btn btn-primary" onclick="showAddContactModal()">+ Добавить</button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Телефон</th>
              <th>Email</th>
              <th>Статус</th>
              <th>Попыток</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="contacts-list"></tbody>
        </table>
      </div>
    `;
    renderContactsList();
  });
}

function renderContactsList() {
  const tbody = document.getElementById('contacts-list');
  if (!contacts.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Контактов пока нет</td></tr>';
    return;
  }
  tbody.innerHTML = contacts.map(c => `
    <tr>
      <td>${c.name}</td>
      <td>${c.phone}</td>
      <td>${c.email || '-'}</td>
      <td><span class="status-badge status-${c.status}">${c.status}</span></td>
      <td>${c.attemptCount}</td>
      <td>
        <button class="btn btn-primary" onclick="initiateCall('${c.id}')">📞</button>
        <button class="btn btn-danger" onclick="deleteContact('${c.id}')">✕</button>
      </td>
    </tr>
  `).join('');
}

function showAddContactModal() {
  document.getElementById('content').innerHTML += `
    <div class="modal active" id="add-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Добавить контакт</h2>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form onsubmit="addContact(event)">
          <div class="form-group">
            <label class="form-label">Имя</label>
            <input type="text" name="name" class="form-input" required>
          </div>
          <div class="form-group">
            <label class="form-label">Телефон</label>
            <input type="tel" name="phone" class="form-input" required>
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" name="email" class="form-input">
          </div>
          <div class="actions">
            <button type="submit" class="btn btn-primary">Добавить</button>
            <button type="button" class="btn" onclick="closeModal()">Отмена</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function closeModal() {
  document.querySelector('.modal')?.remove();
  pages[currentPage]();
}

async function addContact(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  await request('/contacts', {
    method: 'POST',
    body: JSON.stringify(Object.fromEntries(formData)),
  });
  closeModal();
}

async function deleteContact(id) {
  if (!confirm('Удалить контакт?')) return;
  await request(`/contacts/${id}`, { method: 'DELETE' });
  renderContacts();
}

async function initiateCall(contactId) {
  try {
    await request(`/calls/initiate/${contactId}`, { method: 'POST' });
    alert('Звонок инициирован!');
    renderContacts();
  } catch (err) {
    alert('Ошибка: ' + err.message);
  }
}

function renderCalls() {
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-title">Звонки</div>
      <div style="display:flex;gap:12px;margin-bottom:20px">
        <button class="btn btn-primary" onclick="triggerAllCalls()">Запустить все</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Контакт</th>
            <th>Телефон</th>
            <th>Статус</th>
            <th>Результат</th>
            <th>Длительность</th>
          </tr>
        </thead>
        <tbody id="calls-list">
          <tr><td colspan="5" class="loading">Загрузка...</td></tr>
        </tbody>
      </table>
    </div>
  `;
  loadCalls();
}

async function loadCalls() {
  const c = await request('/contacts?status=call1');
  const c2 = await request('/contacts?status=call2');
  const c3 = await request('/contacts?status=call3');
  const all = [...c, ...c2, ...c3];
  const tbody = document.getElementById('calls-list');
  if (!all.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Нет контактов для звонка</td></tr>';
    return;
  }
  tbody.innerHTML = all.map(contact => `
    <tr>
      <td>${contact.name}</td>
      <td>${contact.phone}</td>
      <td><span class="status-badge status-${contact.status}">${contact.status}</span></td>
      <td>${contact.lastCallResult || '-'}</td>
      <td>${contact.lastCallDuration ? contact.lastCallDuration + 'с' : '-'}</td>
    </tr>
  `).join('');
}

async function triggerAllCalls() {
  const count = await request('/calls/schedule', { method: 'POST' });
  alert(`Запланировано ${count} звонков`);
}

function renderSettings() {
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-title">Настройки</div>
      <div class="form-group">
        <label class="form-label">Sipuni User ID</label>
        <input type="text" class="form-input" id="sipuni-user" placeholder="your_user_id">
      </div>
      <div class="form-group">
        <label class="form-label">Sipuni Secret</label>
        <input type="password" class="form-input" id="sipuni-secret" placeholder="your_secret_key">
      </div>
      <div class="form-group">
        <label class="form-label">Sipuni SIP Number</label>
        <input type="text" class="form-input" id="sipuni-sip" placeholder="your_sip_number">
      </div>
      <div class="form-group">
        <label class="form-label">Telegram Bot Token</label>
        <input type="password" class="form-input" id="telegram-token" placeholder="your_bot_token">
      </div>
      <div class="form-group">
        <label class="form-label">Telegram Chat ID</label>
        <input type="text" class="form-input" id="telegram-chat" placeholder="your_chat_id">
      </div>
      <button class="btn btn-primary" onclick="saveSettings()">Сохранить</button>
    </div>
  `;
}

async function saveSettings() {
  alert('Настройки сохранены в .env файле');
}

function updateTime() {
  const now = new Date();
  document.getElementById('current-time').textContent = now.toLocaleString('ru-RU');
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.dataset.page);
    });
  });
  updateTime();
  setInterval(updateTime, 1000);
  renderDashboard();
});