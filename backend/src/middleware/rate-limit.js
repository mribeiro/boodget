const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`[security] Rate limit exceeded: ${req.method} ${req.originalUrl} from ${req.ip}`);
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.username || '').toLowerCase()}`,
  handler: (req, res) => {
    console.log(`[auth] Login rate limit exceeded for username: ${req.body?.username}`);
    res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  },
});

module.exports = { apiLimiter, loginLimiter };
