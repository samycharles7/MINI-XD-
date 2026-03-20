import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { botManager } from './bot';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use((req, res, next) => {
    // Skip check for OPTIONS requests (preflight)
    if (req.method === 'OPTIONS') {
      return next();
    }

    const userId = req.header('x-user-id');
    if (req.path.startsWith('/api/') && !userId) {
      console.warn(`Unauthorized request to ${req.path} from ${req.ip}`);
      return res.status(401).json({ error: 'User ID is required' });
    }
    (req as any).userId = userId;
    next();
  });

  // Initialize all existing bots on startup
  botManager.initAll();

  // API endpoint for pairing code
  app.post('/api/get-pairing-code', async (req, res) => {
    const { phoneNumber } = req.body;
    const userId = (req as any).userId;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    try {
      const bot = botManager.getBot(userId);
      const code = await bot.getPairingCode(phoneNumber);
      res.json({ code });
    } catch (error: any) {
      console.error('Error getting pairing code:', error);
      
      let message = 'Erreur lors de la génération du code';
      if (error.message?.includes('already registered')) {
        message = 'Le bot est déjà connecté ! Déconnectez-le d\'abord si vous voulez changer de numéro.';
      } else if (error.message?.includes('Stream Errored') || error.message?.includes('Connection Closed') || error.message?.includes('internal-server-error')) {
        message = 'WhatsApp a fermé la connexion ou une erreur interne est survenue. Réessayez dans quelques secondes.';
      }

      res.status(500).json({ error: message });
    }
  });

  // API endpoint for bot status
  app.get('/api/status', (req, res) => {
    const userId = (req as any).userId;
    const bot = botManager.getBot(userId);
    const isConnected = bot.sock?.authState.creds.registered || false;
    res.json({ isConnected });
  });

  // API endpoint for logout
  app.post('/api/logout', async (req, res) => {
    const userId = (req as any).userId;
    try {
      const bot = botManager.getBot(userId);
      if (bot.sock) {
        await bot.sock.logout();
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error during logout:', error);
      res.status(500).json({ error: 'Failed to logout' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
