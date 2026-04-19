import { Request, Response, NextFunction } from 'express';

export function basicAuth(req: Request, res: Response, next: NextFunction) {
  const login = process.env.DASHBOARD_LOGIN || 'admin';
  const password = process.env.DASHBOARD_PASSWORD || 'dialer123';

  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Dialer Dashboard"');
    return res.status(401).send('Требуется авторизация');
  }

  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const colonIndex = decoded.indexOf(':');
  const user = decoded.slice(0, colonIndex);
  const pass = decoded.slice(colonIndex + 1);

  if (user !== login || pass !== password) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Dialer Dashboard"');
    return res.status(401).send('Неверный логин или пароль');
  }

  next();
}
