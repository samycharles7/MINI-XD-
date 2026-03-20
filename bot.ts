import makeWASocket, { 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  DisconnectReason,
  WASocket,
  ConnectionState,
  jidNormalizedUser,
  downloadMediaMessage,
  proto
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { Boom } from '@hapi/boom';
import axios from 'axios';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import yts from 'yt-search';

export class WhatsAppBot {
  public sock: WASocket | null = null;
  private authDir: string;
  private isInitializing = false;
  private pairingCodeRequest: { phoneNumber: string; resolve: (code: string) => void; reject: (err: any) => void } | null = null;
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
    this.authDir = path.join(process.cwd(), 'sessions', userId);
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  private warnings: Record<string, number> = {};
  private bans: Set<string> = new Set();
  private antilinkGroups: Set<string> = new Set();
  private antispamGroups: Set<string> = new Set();
  private welcomeGroups: Set<string> = new Set();
  private goodbyeGroups: Set<string> = new Set();
  private lastMessageTime: Record<string, number> = {};
  private publicMode: boolean = true;
  private autoreact: boolean = false;
  private antidelete: boolean = false;
  private antiviewonce: boolean = false;
  private anticall: boolean = false;
  private antitoxic: boolean = false;
  private antitag: boolean = false;
  private messageStore: Record<string, any> = {};
  private startTime: number = Date.now();
  private afk: Record<string, { reason: string; time: number }> = {};

  async init() {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`Using WA version v${version.join('.')}, isLatest: ${isLatest}`);

      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('call', async (calls) => {
        if (this.anticall) {
          for (const call of calls) {
            if (call.status === 'offer') {
              await this.sock?.rejectCall(call.id, call.from);
              await this.sock?.sendMessage(call.from, { 
                text: `*🌸 MINI-XD ANTICALL 🌸*\n\n*🧚 Désolée, je ne prends pas les appels. ✨*\n*🎀 Merci de m'envoyer un message à la place. 🎀*` 
              });
            }
          }
        }
      });

      this.sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        
        // Always try to refresh metadata if possible, but don't block
        let metadata;
        try {
          metadata = await this.sock?.groupMetadata(id);
        } catch (e) {}

        if (action === 'add') {
          for (const user of participants) {
            const userId = typeof user === 'string' ? user : (user as any).id;
            let ppUrl = 'https://lieixmgdboiceopzksvu.supabase.co/storage/v1/object/public/hosted-files/9nwmikgq-1773928282038.jpg';
            try {
              ppUrl = await this.sock?.profilePictureUrl(userId, 'image') || ppUrl;
            } catch (e) {}

            const welcomeMsg = `*✨ BIENVENUE ✨*\n\n*🌸 Coucou @${userId.split('@')[0]} !*\n*🎀 Bienvenue dans ${metadata?.subject || 'le groupe'} !*\n*🧚 On est super contents de t'avoir avec nous. ✨*\n\n*🧚 Fait avec amour par MINI-XD 🧚*`;
            
            await this.sock?.sendMessage(id, {
              image: { url: ppUrl },
              caption: welcomeMsg,
              mentions: [userId],
              contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: '120363406104843715@newsletter',
                  serverMessageId: 1,
                  newsletterName: 'MINI-XD BOT UPDATES'
                }
              }
            });
          }
        } else if (action === 'remove') {
          for (const user of participants) {
            const userId = typeof user === 'string' ? user : (user as any).id;
            const goodbyeMsg = `*✨ AU REVOIR ✨*\n\n*🌸 @${userId.split('@')[0]} nous a quittés...*\n*🧚 On espère te revoir bientôt ! ✨*\n\n*🧚 Fait avec amour par MINI-XD 🧚*`;
            
            await this.sock?.sendMessage(id, {
              text: goodbyeMsg,
              mentions: [userId],
              contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: '120363406104843715@newsletter',
                  serverMessageId: 1,
                  newsletterName: 'MINI-XD BOT UPDATES'
                }
              }
            });
          }
        }
      });

      this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
          const error = lastDisconnect?.error as Boom;
          const statusCode = error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`Connection closed: ${statusCode}, ${error?.message}. Reconnecting: ${shouldReconnect}`);
          
          this.isInitializing = false;
          this.sock = null;

          if (shouldReconnect) {
            const delay = statusCode === 515 || statusCode === 500 ? 3000 : 5000;
            console.log(`Reconnecting in ${delay}ms...`);
            setTimeout(() => this.init(), delay);
          } else {
            console.log('Logged out, cleaning session...');
            if (fs.existsSync(this.authDir)) {
              fs.rmSync(this.authDir, { recursive: true, force: true });
            }
            setTimeout(() => this.init(), 5000);
          }

          if (this.pairingCodeRequest && !shouldReconnect) {
            this.pairingCodeRequest.reject(new Error('Connection closed and cannot reconnect'));
            this.pairingCodeRequest = null;
          }
        } else if (connection === 'open') {
          console.log('WhatsApp Bot connected successfully!');
          this.isInitializing = false;

          if (this.sock?.user) {
            const selfJid = jidNormalizedUser(this.sock.user.id);
            const welcomeMessage = `*✨🌸 MINI‑XD IS NOW CONNECTED! 🌸✨*\n\n*💖 Prête à rendre ton expérience fluide, magique et pleine de petites surprises ✨🐾* *🌈 Profite d'une interface douce et agréable, toujours à ton service 🌟💌*\n\n*Tape .menu*`;
            
            try {
              await this.sock.sendMessage(selfJid, { 
                text: welcomeMessage,
                contextInfo: {
                  forwardingScore: 999,
                  isForwarded: true,
                  forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363406104843715@newsletter',
                    serverMessageId: 1,
                    newsletterName: 'MINI-XD BOT UPDATES'
                  }
                }
              });
            } catch (err) {
              console.error('Failed to send welcome message:', err);
            }
          }
        }

        if (this.pairingCodeRequest && this.sock && !this.sock.authState.creds.registered) {
          try {
            const code = await this.sock.requestPairingCode(this.pairingCodeRequest.phoneNumber);
            this.pairingCodeRequest.resolve(code);
            this.pairingCodeRequest = null;
          } catch (err) {
            console.error('Error requesting pairing code in update:', err);
          }
        }
      });

      this.sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const remoteJid = msg.key.remoteJid!;
        const isGroup = remoteJid.endsWith('@g.us');
        const sender = msg.key.participant || msg.key.remoteJid!;
        const isMe = msg.key.fromMe;

        let isAdmin = false;
        if (isGroup && this.sock) {
          const metadata = await this.sock.groupMetadata(remoteJid);
          const participant = metadata.participants.find(p => p.id === sender);
          isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
        }

        if (!this.publicMode && !isMe) return;
        if (this.bans.has(sender) && !isMe) return;

        // Autoreact Logic
        if (this.autoreact && !isMe) {
          const reactions = ['🌸', '✨', '🎀', '🧚', '💖', '🌟'];
          const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
          await this.sock?.sendMessage(remoteJid, { react: { text: randomReaction, key: msg.key } });
        }

        // Ghost Voice (Vocale Fantôme) - Activity Simulation
        if (!isMe) {
          // Randomly choose between recording and typing
          const activity = Math.random() > 0.5 ? 'recording' : 'composing';
          this.sock?.sendPresenceUpdate(activity, remoteJid);
          
          // Stop simulation after 25 seconds to avoid being stuck
          setTimeout(() => {
            this.sock?.sendPresenceUpdate('paused', remoteJid);
          }, 25000);
        }

        // AFK Logic
        if (!isMe) {
          // Check if sender is AFK
          if (this.afk[sender]) {
            const afkData = this.afk[sender];
            const duration = Math.floor((Date.now() - afkData.time) / 1000);
            const hours = Math.floor(duration / 3600);
            const minutes = Math.floor((duration % 3600) / 60);
            const seconds = duration % 60;
            const timeStr = `${hours ? hours + 'h ' : ''}${minutes ? minutes + 'm ' : ''}${seconds}s`;
            
            delete this.afk[sender];
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Bon retour !* Tu n'es plus AFK. ✨\n*⏳ Durée :* ${timeStr}` }, { quoted: msg });
          }

          // Check if mentioned users are AFK
          const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          for (const jid of mentions) {
            if (this.afk[jid]) {
              const afkData = this.afk[jid];
              const duration = Math.floor((Date.now() - afkData.time) / 1000);
              const hours = Math.floor(duration / 3600);
              const minutes = Math.floor((duration % 3600) / 60);
              const seconds = duration % 60;
              const timeStr = `${hours ? hours + 'h ' : ''}${minutes ? minutes + 'm ' : ''}${seconds}s`;
              
              await this.sock?.sendMessage(remoteJid, { 
                text: `*🌸 Désolée !* @${jid.split('@')[0]} est actuellement AFK. ✨\n*🧚 Raison :* ${afkData.reason}\n*⏳ Depuis :* ${timeStr}`,
                mentions: [jid]
              }, { quoted: msg });
            }
          }
        }

        // Message Store for Antidelete
        if (msg.message && !msg.key.fromMe) {
          this.messageStore[msg.key.id!] = JSON.parse(JSON.stringify(msg));
          // Keep only last 500 messages
          const keys = Object.keys(this.messageStore);
          if (keys.length > 500) {
            delete this.messageStore[keys[0]];
          }
        }

        // Antidelete Logic
        if (msg.message?.protocolMessage?.type === 0 && this.antidelete) {
          const deletedKey = msg.message.protocolMessage.key;
          const originalMsg = this.messageStore[deletedKey.id];
          if (originalMsg) {
            const sender = originalMsg.key.participant || originalMsg.key.remoteJid;
            await this.sock?.sendMessage(remoteJid, { 
              text: `*🌸 MINI-XD ANTIDELETE 🌸*\n\n*🧚 @${sender.split('@')[0]} a supprimé un message ! ✨*`,
              mentions: [sender]
            });
            await this.sock?.sendMessage(remoteJid, { forward: originalMsg }, { quoted: originalMsg });
          }
        }

        // Antiviewonce Logic
        const viewOnce = msg.message?.viewOnceMessageV2 || msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2Extension || 
                         msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.viewOnceMessageV2 ||
                         msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.viewOnceMessage ||
                         msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.viewOnceMessageV2Extension;

        if (viewOnce && this.antiviewonce && !isMe) {
          const mediaMsg = (viewOnce as any).message?.imageMessage || (viewOnce as any).message?.videoMessage || (viewOnce as any).imageMessage || (viewOnce as any).videoMessage;
          if (mediaMsg) {
            const buffer = await downloadMediaMessage(
              msg,
              'buffer',
              {},
              { logger: pino({ level: 'silent' }) } as any
            );
            const type = ((viewOnce as any).message?.imageMessage || (viewOnce as any).imageMessage) ? 'image' : 'video';
            const messageContent: any = { 
              [type]: buffer, 
              caption: `*🌸 MINI-XD ANTIVIEWONCE 🌸*\n\n*🧚 Message à vue unique intercepté ! ✨*` 
            };
            await this.sock?.sendMessage(remoteJid, messageContent, { quoted: msg });
          }
        }

        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || 
                     "";

        // Antitoxic Logic
        if (isGroup && this.antitoxic && !isMe && !isAdmin) {
          const toxicWords = ['connard', 'salope', 'pute', 'fdp', 'merde', 'enculé'];
          if (toxicWords.some(word => text.toLowerCase().includes(word))) {
            await this.sock?.sendMessage(remoteJid, { delete: msg.key });
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Alerte Antitoxic !* @${sender.split('@')[0]} surveille ton langage chéri(e). ✨`, mentions: [sender] });
          }
        }

        // Antitag Logic
        if (isGroup && this.antitag && !isMe && !isAdmin) {
          if (text.includes('@everyone') || text.includes('@here') || (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length || 0) > 10) {
            await this.sock?.sendMessage(remoteJid, { delete: msg.key });
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Alerte Antitag !* @${sender.split('@')[0]} ne tague pas tout le monde sans permission. 🎀`, mentions: [sender] });
          }
        }

        const prefix = '.';
        const command = text.split(' ')[0].toLowerCase().trim();
        const args = text.split(' ').slice(1);

        if (command === prefix + 'afk') {
          const reason = args.join(' ') || 'Pas de raison précise ✨';
          this.afk[sender] = { reason, time: Date.now() };
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 AFK activé !* @${sender.split('@')[0]} est maintenant absent(e). ✨\n*🧚 Raison :* ${reason}`, mentions: [sender] }, { quoted: msg });
        }

        if (command === prefix + 'runtime') {
          const duration = Math.floor((Date.now() - this.startTime) / 1000);
          const days = Math.floor(duration / 86400);
          const hours = Math.floor((duration % 86400) / 3600);
          const minutes = Math.floor((duration % 3600) / 60);
          const seconds = duration % 60;
          const timeStr = `${days ? days + 'j ' : ''}${hours ? hours + 'h ' : ''}${minutes ? minutes + 'm ' : ''}${seconds}s`;
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD RUNTIME 🌸*\n\n*🧚 Bot actif depuis :* ${timeStr} ✨` }, { quoted: msg });
        }

        if (command === prefix + 'quote') {
          try {
            const res = await axios.get('https://api.quotable.io/random');
            const quote = res.data;
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 CITATION DU JOUR 🌸*\n\n*"${quote.content}"*\n\n*🧚 Auteur :* ${quote.author} ✨` }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de récupérer une citation. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'fact') {
          try {
            const res = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en');
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 LE SAVAIS-TU ? 🌸*\n\n*🧚* ${res.data.text} ✨` }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de récupérer un fait. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'joke') {
          try {
            const res = await axios.get('https://official-joke-api.appspot.com/random_joke');
            const joke = res.data;
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 BLAGUE DU JOUR 🌸*\n\n*🧚* ${joke.setup}\n\n*✨* ${joke.punchline} 😂` }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de récupérer une blague. ✨` }, { quoted: msg });
          }
        }

        if (command.startsWith(prefix + 'qr')) {
          const text = args.join(' ');
          if (!text) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Donne moi un texte pour générer un QR Code. ✨` }, { quoted: msg });
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;
          await this.sock?.sendMessage(remoteJid, { image: { url: qrUrl }, caption: `*🌸 MINI-XD QR CODE 🌸*\n\n*🧚 Texte :* ${text} ✨` }, { quoted: msg });
        }

        if (command.startsWith(prefix + 'shorten')) {
          const url = args[0];
          if (!url) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Donne moi une URL à raccourcir. ✨` }, { quoted: msg });
          try {
            const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD SHORTENER 🌸*\n\n*🧚 URL courte :* ${res.data} ✨` }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de raccourcir cette URL. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'weather') {
          const city = args.join(' ');
          if (!city) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Donne moi une ville. ✨` }, { quoted: msg });
          try {
            const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=895284fb2d2c1d87930248adcd5148a1&units=metric&lang=fr`);
            const data = res.data;
            const weatherText = `*🌸 MÉTÉO - ${data.name} 🌸*\n\n*🧚 Temps :* ${data.weather[0].description} ✨\n*🌡️ Température :* ${data.main.temp}°C\n*💧 Humidité :* ${data.main.humidity}%\n*💨 Vent :* ${data.wind.speed} m/s`;
            await this.sock?.sendMessage(remoteJid, { text: weatherText }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de trouver la météo pour cette ville. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'lyrics') {
          const song = args.join(' ');
          if (!song) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Donne moi le nom d'une chanson. ✨` }, { quoted: msg });
          try {
            const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(song)}`);
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD LYRICS 🌸*\n\n*🧚 Chanson :* ${song}\n\n${res.data.lyrics || 'Paroles non trouvées. ✨'}` }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de trouver les paroles. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'google') {
          const query = args.join(' ');
          if (!query) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Que veux-tu chercher ? ✨` }, { quoted: msg });
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD SEARCH 🌸*\n\n*🧚 Recherche :* ${query}\n*✨ Lien :* ${searchUrl}` }, { quoted: msg });
        }

        if (command === prefix + 'pinterest') {
          const query = args.join(' ');
          if (!query) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Que cherches-tu sur Pinterest ? ✨` }, { quoted: msg });
          const pinUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD PINTEREST 🌸*\n\n*🧚 Recherche :* ${query}\n*✨ Lien :* ${pinUrl}` }, { quoted: msg });
        }

        if (command === prefix + 'wiki') {
          const query = args.join(' ');
          if (!query) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Que veux-tu chercher sur Wikipedia ? ✨` }, { quoted: msg });
          try {
            const res = await axios.get(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
            const data = res.data;
            if (data.type === 'standard') {
              const wikiText = `*🌸 WIKIPEDIA - ${data.title} 🌸*\n\n*🧚* ${data.extract} ✨\n\n*✨ Lien :* ${data.content_urls.mobile.page} 🎀`;
              await this.sock?.sendMessage(remoteJid, { text: wikiText }, { quoted: msg });
            } else {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Article non trouvé. ✨` }, { quoted: msg });
            }
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Erreur lors de la recherche Wikipedia. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'play') {
          const query = args.join(' ');
          if (!query) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Que veux-tu écouter ? ✨` }, { quoted: msg });
          try {
            const search = await yts(query);
            const video = search.videos[0];
            if (!video) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Vidéo non trouvée. ✨` }, { quoted: msg });
            
            const caption = `*🌸 MINI-XD PLAY 🌸*\n\n*🧚 Titre :* ${video.title}\n*✨ Durée :* ${video.timestamp}\n*🧚 Vues :* ${video.views}\n*✨ Lien :* ${video.url}\n\n*🧚 Téléchargement en cours... 🎀*`;
            await this.sock?.sendMessage(remoteJid, { image: { url: video.thumbnail }, caption }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Erreur lors de la recherche. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'ytmp3' || command === prefix + 'ytmp4') {
          const url = args[0];
          if (!url) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Donne moi un lien YouTube. ✨` }, { quoted: msg });
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 Téléchargement en cours...* ✨\n\n*🧚 Bientôt disponible avec une vraie API de téléchargement ! 🎀*` }, { quoted: msg });
        }

        if (command === prefix + 'news') {
          try {
            const res = await axios.get('https://api.spaceflightnewsapi.net/v4/articles/?limit=5');
            const articles = res.data.results;
            let newsText = `*╭─── 🌸 MINI-XD NEWS 🌸 ───╮*\n\n`;
            articles.forEach((art: any, i: number) => {
              newsText += `*${i + 1}.* ${art.title}\n*🧚 Source :* ${art.news_site}\n\n`;
            });
            newsText += `*╰──────────────────╯*`;
            await this.sock?.sendMessage(remoteJid, { text: newsText }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de récupérer les actualités. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'reminder') {
          const time = parseInt(args[0]);
          const reason = args.slice(1).join(' ') || 'Rappel ! ✨';
          if (isNaN(time)) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Utilise : .reminder [minutes] [raison] ✨` }, { quoted: msg });
          
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 Rappel programmé !* Je te préviendrai dans ${time} minute(s). 🧚` }, { quoted: msg });
          
          setTimeout(async () => {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 RAPPEL ! 🌸*\n\n*🧚 @${sender.split('@')[0]} :* ${reason} ✨`, mentions: [sender] });
          }, time * 60000);
        }

        if (command === prefix + 'ship') {
          const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (users.length >= 2) {
            const love = Math.floor(Math.random() * 101);
            const user1 = users[0];
            const user2 = users[1];
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD SHIP 🌸*\n\n*🧚 @${user1.split('@')[0]}* ❤️ *🧚 @${user2.split('@')[0]}*\n*✨ Compatibilité :* ${love}% 💖`, mentions: [user1, user2] }, { quoted: msg });
          } else {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Mentionne deux personnes pour les shipper. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'love') {
          const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          const target = users[0] || sender;
          const love = Math.floor(Math.random() * 101);
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD LOVE 🌸*\n\n*🧚 @${target.split('@')[0]}* est amoureux(se) à ${love}% ! 💖`, mentions: [target] }, { quoted: msg });
        }

        if (command === prefix + 'dare') {
          const dares = [
            "Fais une déclaration d'amour à ton dernier contact.",
            "Envoie un message vocal en chantant une chanson ridicule.",
            "Change ta photo de profil par une image moche pendant 10 minutes.",
            "Dis à ton crush ce que tu ressens pour lui/elle.",
            "Fais 20 pompes et envoie la preuve en vidéo."
          ];
          const dare = dares[Math.floor(Math.random() * dares.length)];
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD ACTION 🌸*\n\n*🧚 Ton défi :* ${dare} ✨` }, { quoted: msg });
        }

        if (command === prefix + 'truth') {
          const truths = [
            "Quel est ton plus grand secret ?",
            "De qui es-tu amoureux(se) en ce moment ?",
            "Quelle est la chose la plus embarrassante que tu aies faite ?",
            "Si tu pouvais changer une chose chez toi, ce serait quoi ?",
            "Quel est ton plus grand regret ?"
          ];
          const truth = truths[Math.floor(Math.random() * truths.length)];
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD VÉRITÉ 🌸*\n\n*🧚 Ta question :* ${truth} ✨` }, { quoted: msg });
        }

        if (command.startsWith(prefix + 'calc')) {
          const expr = args.join(' ');
          if (!expr) return await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Donne moi un calcul. ✨` }, { quoted: msg });
          try {
            // Simple evaluation using Function (safe enough for basic math)
            const result = new Function(`return ${expr}`)();
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 MINI-XD CALC 🌸*\n\n*🧚 Calcul :* ${expr}\n*✨ Résultat :* ${result} ✨` }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Calcul invalide. ✨` }, { quoted: msg });
          }
        }

        // Antilink Logic
        if (isGroup && this.antilinkGroups.has(remoteJid) && !isMe) {
          const linkRegex = /chat.whatsapp.com\/[a-zA-Z0-9]+/i;
          if (linkRegex.test(text)) {
            await this.sock?.sendMessage(remoteJid, { delete: msg.key });
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Alerte Antilink !* Désolée chéri(e), les liens ne sont pas autorisés ici. J'ai dû supprimer ton message. ✨` }, { quoted: msg });
            return;
          }
        }

        // Antispam Logic
        if (isGroup && this.antispamGroups.has(remoteJid) && !isMe) {
          const now = Date.now();
          const lastTime = this.lastMessageTime[sender] || 0;
          if (now - lastTime < 1500) { // 1.5 seconds threshold
            await this.sock?.sendMessage(remoteJid, { delete: msg.key });
            return;
          }
          this.lastMessageTime[sender] = now;
        }

        if (command === 'menu' || command === prefix + 'menu') {
          // React with emoji
          await this.sock?.sendMessage(remoteJid, { react: { text: '🌸', key: msg.key } });

          const uptime = Date.now() - this.startTime;
          const hours = Math.floor(uptime / 3600000);
          const minutes = Math.floor((uptime % 3600000) / 60000);
          const seconds = Math.floor((uptime % 60000) / 1000);
          const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

          const menuText = `*╭─── 🎀 MINI-XD MENU 🎀 ───╮*

*│*  👑 *Owner*   : Samy Charles
*│*  ⏳ *Uptime*  : ${uptimeStr}
*│*  🧚 *Prefix*  : ${prefix}
*│*  🎀 *Theme*   : Pink
*│*  🧚 *Mode*    : Public
*╰──────────────────╯*

*╭─── 🌸 MODÉRATION ───╮*
*│* 🌸 ${prefix}antilink
*│* 🌸 ${prefix}antispam
*│* 🌸 ${prefix}antidelete
*│* 🌸 ${prefix}antiviewonce
*│* 🌸 ${prefix}anticall
*│* 🌸 ${prefix}antitoxic
*│* 🌸 ${prefix}antitag
*│* 🌸 ${prefix}welcome
*│* 🌸 ${prefix}goodbye
*│* 🌸 ${prefix}kick
*│* 🌸 ${prefix}add
*│* 🌸 ${prefix}kickall
*│* 🌸 ${prefix}promoteall
*│* 🌸 ${prefix}demoteall
*│* 🌸 ${prefix}clear
*│* 🌸 ${prefix}acceptall
*│* 🌸 ${prefix}promote
*│* 🌸 ${prefix}demote
*│* 🌸 ${prefix}mute
*│* 🌸 ${prefix}unmute
*│* 🌸 ${prefix}tagall
*│* 🌸 ${prefix}hidetag
*│* 🌸 ${prefix}tag
*│* 🌸 ${prefix}everyone
*│* 🌸 ${prefix}warn
*│* 🌸 ${prefix}listwarn
*│* 🌸 ${prefix}resetwarn
*│* 🌸 ${prefix}del
*│* 🌸 ${prefix}setpp
*│* 🌸 ${prefix}lock
*│* 🌸 ${prefix}unlock
*│* 🌸 ${prefix}link
*│* 🌸 ${prefix}setname
*│* 🌸 ${prefix}setdesc
*│* 🌸 ${prefix}opentime
*│* 🌸 ${prefix}closetime
*│* 🌸 ${prefix}ban
*│* 🌸 ${prefix}unban
*╰──────────────────╯*

*╭─── 🌸 OUTILS ───╮*
*│* 🌸 ${prefix}vv
*│* 🌸 ${prefix}statuts
*│* 🌸 ${prefix}sticker
*│* 🌸 ${prefix}toimg
*│* 🌸 ${prefix}autoreact
*│* 🌸 ${prefix}jid
*│* 🌸 ${prefix}anime
*│* 🌸 ${prefix}alive
*│* 🌸 ${prefix}ping
*│* 🌸 ${prefix}speed
*│* 🌸 ${prefix}translate
*│* 🌸 ${prefix}wiki
*│* 🌸 ${prefix}play
*│* 🌸 ${prefix}ytmp3
*│* 🌸 ${prefix}ytmp4
*│* 🌸 ${prefix}groupinfo
*│* 🌸 ${prefix}getpp
*│* 🌸 ${prefix}admins
*│* 🌸 ${prefix}gcpp
*│* 🌸 ${prefix}poll
*│* 🌸 ${prefix}block
*│* 🌸 ${prefix}unblock
*│* 🌸 ${prefix}public
*│* 🌸 ${prefix}private
*│* 🌸 ${prefix}support
*│* 🌸 ${prefix}listgc
*╰──────────────────╯*

*╭─── 🌸 FUN & UTILS ───╮*
*│* 🌸 ${prefix}afk
*│* 🌸 ${prefix}runtime
*│* 🌸 ${prefix}quote
*│* 🌸 ${prefix}fact
*│* 🌸 ${prefix}joke
*│* 🌸 ${prefix}qr
*│* 🌸 ${prefix}shorten
*│* 🌸 ${prefix}weather
*│* 🌸 ${prefix}calc
*│* 🌸 ${prefix}lyrics
*│* 🌸 ${prefix}google
*│* 🌸 ${prefix}pinterest
*│* 🌸 ${prefix}news
*│* 🌸 ${prefix}reminder
*│* 🌸 ${prefix}ship
*│* 🌸 ${prefix}love
*│* 🌸 ${prefix}dare
*│* 🌸 ${prefix}truth
*╰──────────────────╯*

*╭─── 🌸 MANGA ───╮*
*│* 🌸 ${prefix}waifu
*│* 🌸 ${prefix}neko
*│* 🌸 ${prefix}shinobu
*│* 🌸 ${prefix}megumin
*│* 🌸 ${prefix}cuddle
*│* 🌸 ${prefix}hug
*│* 🌸 ${prefix}kiss
*│* 🌸 ${prefix}pat
*│* 🌸 ${prefix}slap
*╰──────────────────╯*

*╭─── 🌸 BOT INFO ───╮*
*│* 🌸 ${prefix}status
*│* 🌸 ${prefix}ping
*│* 🌸 ${prefix}owner
*╰──────────────────╯*`;

          await this.sock?.sendMessage(remoteJid, {
            image: { url: 'https://lieixmgdboiceopzksvu.supabase.co/storage/v1/object/public/hosted-files/9nwmikgq-1773928282038.jpg' },
            caption: menuText,
            contextInfo: {
              forwardingScore: 999,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: '120363406104843715@newsletter',
                serverMessageId: 1,
                newsletterName: 'MINI-XD BOT UPDATES'
              }
            }
          }, { quoted: msg });

          // Send audio after 4 seconds
          setTimeout(async () => {
            await this.sock?.sendMessage(remoteJid, { 
              audio: { url: 'https://lieixmgdboiceopzksvu.supabase.co/storage/v1/object/public/hosted-files/32fpgkpd-1773945069414.mp3' },
              mimetype: 'audio/mpeg',
              ptt: false
            }, { quoted: msg });
          }, 4000);
          return;
        }

        // Moderation Commands (Group Only)
        if (isGroup) {
          if (command === prefix + 'antilink') {
            const mode = args[0]?.toLowerCase();
            if (mode === 'on') {
              this.antilinkGroups.add(remoteJid);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antilink activé !* Je surveille maintenant les liens, mes amours. ✨` }, { quoted: msg });
            } else if (mode === 'off') {
              this.antilinkGroups.delete(remoteJid);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antilink désactivé !* Vous pouvez à nouveau partager des liens. 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'antispam') {
            const mode = args[0]?.toLowerCase();
            if (mode === 'on') {
              this.antispamGroups.add(remoteJid);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antispam activé !* Je vais calmer les bavards trop rapides. ✨` }, { quoted: msg });
            } else if (mode === 'off') {
              this.antispamGroups.delete(remoteJid);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antispam désactivé !* Parlez autant que vous voulez ! 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'antidelete') {
            const mode = args[0]?.toLowerCase();
            if (mode === 'on') {
              this.antidelete = true;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antidelete activé !* Je vais surveiller les messages supprimés. ✨` }, { quoted: msg });
            } else if (mode === 'off') {
              this.antidelete = false;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antidelete désactivé !* Je ne surveille plus rien. 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'antiviewonce') {
            const mode = args[0]?.toLowerCase();
            if (mode === 'on') {
              this.antiviewonce = true;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antiviewonce activé !* Je vais intercepter les messages à vue unique. ✨` }, { quoted: msg });
            } else if (mode === 'off') {
              this.antiviewonce = false;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antiviewonce désactivé !* Je laisse les secrets tranquilles. 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'anticall') {
            const mode = args[0]?.toLowerCase();
            if (mode === 'on') {
              this.anticall = true;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Anticall activé !* Je vais rejeter les appels automatiquement. ✨` }, { quoted: msg });
            } else if (mode === 'off') {
              this.anticall = false;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Anticall désactivé !* Vous pouvez m'appeler. 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'antitoxic') {
            const mode = args[0]?.toLowerCase();
            if (mode === 'on') {
              this.antitoxic = true;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antitoxic activé !* Je surveille les vilains mots. ✨` }, { quoted: msg });
            } else if (mode === 'off') {
              this.antitoxic = false;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antitoxic désactivé !* Soyez libres de vos paroles. 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'antitag') {
            const mode = args[0]?.toLowerCase();
            if (mode === 'on') {
              this.antitag = true;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antitag activé !* Je protège les membres des mentions abusives. ✨` }, { quoted: msg });
            } else if (mode === 'off') {
              this.antitag = false;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Antitag désactivé !* Tout le monde peut taguer. 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'welcome') {
            const mode = args[0]?.toLowerCase();
            if (mode === 'on') {
              this.welcomeGroups.add(remoteJid);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Welcome activé !* Je vais accueillir les nouveaux membres avec amour. ✨` }, { quoted: msg });
            } else if (mode === 'off') {
              this.welcomeGroups.delete(remoteJid);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Welcome désactivé !* Plus de messages de bienvenue. 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'goodbye') {
            const mode = args[0]?.toLowerCase();
            if (mode === 'on') {
              this.goodbyeGroups.add(remoteJid);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Goodbye activé !* Je dirai au revoir à ceux qui nous quittent. ✨` }, { quoted: msg });
            } else if (mode === 'off') {
              this.goodbyeGroups.delete(remoteJid);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Goodbye désactivé !* Plus de messages d'au revoir. 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'kick') {
            const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (users.length > 0) {
              await this.sock?.groupParticipantsUpdate(remoteJid, users, 'remove');
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* J'ai dû faire le ménage. Au revoir ! 👋✨` }, { quoted: msg });
            }
          }

          if (command === prefix + 'add') {
            const number = args[0]?.replace(/[^0-9]/g, '');
            if (number) {
              await this.sock?.groupParticipantsUpdate(remoteJid, [`${number}@s.whatsapp.net`], 'add');
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Bienvenue !* J'ai ajouté un nouveau membre à notre petite famille. 🎀` }, { quoted: msg });
            }
          }

          if (command === prefix + 'kickall') {
            const metadata = await this.sock?.groupMetadata(remoteJid);
            const participants = metadata?.participants.filter(p => !p.admin && p.id !== this.sock?.user?.id) || [];
            const jids = participants.map(p => p.id);
            if (jids.length > 0) {
              await this.sock?.groupParticipantsUpdate(remoteJid, jids, 'remove');
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Grand ménage terminé !* Le groupe est maintenant tout propre. ✨🧹` }, { quoted: msg });
            }
          }

          if (command === prefix + 'promoteall') {
            const metadata = await this.sock?.groupMetadata(remoteJid);
            const participants = metadata?.participants.filter(p => !p.admin) || [];
            const jids = participants.map(p => p.id);
            if (jids.length > 0) {
              await this.sock?.groupParticipantsUpdate(remoteJid, jids, 'promote');
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Tout le monde est admin !* C'est la démocratie ici. 👑✨` }, { quoted: msg });
            }
          }

          if (command === prefix + 'demoteall') {
            const metadata = await this.sock?.groupMetadata(remoteJid);
            const participants = metadata?.participants.filter(p => p.admin && p.id !== metadata.owner && p.id !== this.sock?.user?.id) || [];
            const jids = participants.map(p => p.id);
            if (jids.length > 0) {
              await this.sock?.groupParticipantsUpdate(remoteJid, jids, 'demote');
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Retour à la normale !* Seul le créateur garde sa couronne. 🧚💔` }, { quoted: msg });
            }
          }

          if (command === prefix + 'clear') {
            await this.sock?.chatModify({ delete: true, lastMessages: [{ key: msg.key, messageTimestamp: msg.messageTimestamp }] }, remoteJid);
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Chat nettoyé !* Tout est propre maintenant. ✨🧹` }, { quoted: msg });
          }

          if (command === prefix + 'acceptall') {
            const requests = await this.sock?.groupRequestParticipantsList(remoteJid);
            if (requests && requests.length > 0) {
              for (const req of requests) {
                await this.sock?.groupRequestParticipantsUpdate(remoteJid, [req.jid], 'approve');
              }
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Tout le monde est accepté !* Bienvenue à tous les nouveaux. 🎀` }, { quoted: msg });
            } else {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Il n'y a pas de demandes en attente. ✨` }, { quoted: msg });
            }
          }

          if (command.startsWith(prefix + 'promote')) {
            const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (users.length > 0) {
              await this.sock?.groupParticipantsUpdate(remoteJid, users, 'promote');
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Félicitations !* Nous avons de nouveaux administrateurs. 👑✨` }, { quoted: msg });
            }
          }

          if (command.startsWith(prefix + 'demote')) {
            const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (users.length > 0) {
              await this.sock?.groupParticipantsUpdate(remoteJid, users, 'demote');
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oh...* Certains ont perdu leur couronne. 🧚💔` }, { quoted: msg });
            }
          }

          if (command === prefix + 'mute') {
            await this.sock?.groupSettingUpdate(remoteJid, 'announcement');
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Chut !* Seuls les admins peuvent parler maintenant. Un peu de calme, mes amours. 🤫✨` }, { quoted: msg });
          }

          if (command === prefix + 'unmute') {
            await this.sock?.groupSettingUpdate(remoteJid, 'not_announcement');
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 C'est la fête !* Tout le monde peut à nouveau discuter. 🎀🗣️` }, { quoted: msg });
          }

          if (command === prefix + 'tagall' || command === prefix + 'everyone') {
            const metadata = await this.sock?.groupMetadata(remoteJid);
            const participants = metadata?.participants || [];
            const jids = participants.map(p => p.id);
            const message = args.join(' ') || 'Coucou tout le monde ! 🌸';
            
            let tagText = `*╭─── 🌸 APPEL GÉNÉRAL 🌸 ───╮*\n\n`;
            tagText += `*🧚 Message :* ${message}\n\n`;
            tagText += `*🎀 Membres :*\n`;
            for (let mem of participants) {
              tagText += `*│* 🌸 @${mem.id.split('@')[0]}\n`;
            }
            tagText += `\n*╰──────────────────╯*`;

            await this.sock?.sendMessage(remoteJid, { 
              text: tagText,
              mentions: jids,
              contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: '120363406104843715@newsletter',
                  serverMessageId: 1,
                  newsletterName: 'MINI-XD BOT UPDATES'
                }
              }
            }, { quoted: msg });
            return;
          }

          if (command === prefix + 'hidetag' || command === prefix + 'tag' || command === prefix + 'everyone') {
            const metadata = await this.sock?.groupMetadata(remoteJid);
            const participants = metadata?.participants || [];
            const jids = participants.map(p => p.id);
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const quoted = msg.message.extendedTextMessage?.contextInfo?.participant;
            
            if (command === prefix + 'tag') {
              const target = mentioned[0] || quoted;
              if (target) {
                await this.sock?.sendMessage(remoteJid, { text: `*🌸 Coucou !* @${target.split('@')[0]} tu es demandé(e) ! ✨`, mentions: [target] }, { quoted: msg });
              } else {
                await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Mentionne quelqu'un ou réponds à son message pour que je puisse l'appeler. 🎀` }, { quoted: msg });
              }
              return;
            }

            const message = args.join(' ') || 'Coucou tout le monde ! 🌸';
            await this.sock?.sendMessage(remoteJid, { 
              text: message, 
              mentions: jids 
            }, { quoted: msg });
          }

          if (command.startsWith(prefix + 'warn')) {
            const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (users.length > 0) {
              const user = users[0];
              this.warnings[user] = (this.warnings[user] || 0) + 1;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Attention !* @${user.split('@')[0]} a reçu un avertissement. (${this.warnings[user]}/3) Soyez sages ! ✨`, mentions: [user] }, { quoted: msg });
              if (this.warnings[user] >= 3) {
                await this.sock?.groupParticipantsUpdate(remoteJid, [user], 'remove');
                delete this.warnings[user];
                await this.sock?.sendMessage(remoteJid, { text: `*🌸 Trop d'avertissements !* J'ai dû retirer ce membre. 🧚💔` }, { quoted: msg });
              }
            }
          }

          if (command === prefix + 'listwarn') {
            const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (users.length > 0) {
              const user = users[0];
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Infos Avertissements :* @${user.split('@')[0]} a ${this.warnings[user] || 0} avertissement(s). ✨`, mentions: [user] }, { quoted: msg });
            }
          }

          if (command === prefix + 'resetwarn') {
            const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (users.length > 0) {
              const user = users[0];
              delete this.warnings[user];
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Pardon accordé !* Les avertissements de @${user.split('@')[0]} ont été réinitialisés. 🎀`, mentions: [user] }, { quoted: msg });
            }
          }

          if (command === prefix + 'del') {
            const quoted = msg.message.extendedTextMessage?.contextInfo;
            if (quoted?.stanzaId) {
              await this.sock?.sendMessage(remoteJid, { delete: { remoteJid, fromMe: quoted.participant === this.sock?.user?.id, id: quoted.stanzaId, participant: quoted.participant } });
            }
          }

          if (command === prefix + 'lock') {
            await this.sock?.groupSettingUpdate(remoteJid, 'locked');
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Paramètres verrouillés !* Seuls les admins peuvent modifier le groupe. ✨` }, { quoted: msg });
          }

          if (command === prefix + 'unlock') {
            await this.sock?.groupSettingUpdate(remoteJid, 'unlocked');
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Paramètres déverrouillés !* Tout le monde peut modifier le groupe. 🎀` }, { quoted: msg });
          }

          if (command === prefix + 'link') {
            const inviteCode = await this.sock?.groupInviteCode(remoteJid);
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Voici le lien du groupe :* https://chat.whatsapp.com/${inviteCode} ✨` }, { quoted: msg });
          }

          if (command.startsWith(prefix + 'setname')) {
            const newName = args.join(' ');
            if (newName) {
              await this.sock?.groupUpdateSubject(remoteJid, newName);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Nouveau nom !* Le groupe s'appelle maintenant : ${newName} 🎀` }, { quoted: msg });
            }
          }

          if (command.startsWith(prefix + 'setdesc')) {
            const newDesc = args.join(' ');
            if (newDesc) {
              await this.sock?.groupUpdateDescription(remoteJid, newDesc);
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Description mise à jour !* C'est beaucoup plus joli comme ça. ✨` }, { quoted: msg });
            }
          }

          if (command.startsWith(prefix + 'opentime')) {
            const time = parseInt(args[0]);
            if (!isNaN(time)) {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Programmation !* Le groupe s'ouvrira dans ${time} minute(s). ✨` }, { quoted: msg });
              setTimeout(async () => {
                await this.sock?.groupSettingUpdate(remoteJid, 'not_announcement');
                await this.sock?.sendMessage(remoteJid, { text: `*🌸 Surprise !* Le groupe est maintenant ouvert comme prévu. 🎀` }, { quoted: msg });
              }, time * 60000);
            }
          }

          if (command.startsWith(prefix + 'closetime')) {
            const time = parseInt(args[0]);
            if (!isNaN(time)) {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Programmation !* Le groupe se fermera dans ${time} minute(s). ✨` }, { quoted: msg });
              setTimeout(async () => {
                await this.sock?.groupSettingUpdate(remoteJid, 'announcement');
                await this.sock?.sendMessage(remoteJid, { text: `*🌸 Dodo !* Le groupe est maintenant fermé comme prévu. Bonne nuit ! 🎀🌙` }, { quoted: msg });
              }, time * 60000);
            }
          }

          if (command === prefix + 'setpp' && isGroup && isAdmin) {
            const contextInfo = msg.message.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            if (quoted?.imageMessage) {
              try {
                const buffer = await downloadMediaMessage(
                  { key: { remoteJid, id: contextInfo.stanzaId, participant: contextInfo.participant || remoteJid }, message: quoted } as any,
                  'buffer',
                  {},
                  { logger: pino({ level: 'silent' }) } as any
                );
                await this.sock?.updateProfilePicture(remoteJid, buffer);
                await this.sock?.sendMessage(remoteJid, { text: `*🌸 Photo de profil du groupe mise à jour ! ✨*` }, { quoted: msg });
              } catch (e) {
                await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Erreur lors de la mise à jour de la photo. ✨` }, { quoted: msg });
              }
            } else {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Réponds à une image avec cette commande pour changer la photo du groupe. 🎀` }, { quoted: msg });
            }
          }
        }

        // Global Moderation
        if (command.startsWith(prefix + 'ban')) {
          const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (users.length > 0) {
            this.bans.add(users[0]);
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Banni !* @${users[0].split('@')[0]} ne peut plus m'utiliser. 🧚💔`, mentions: [users[0]] }, { quoted: msg });
          }
        }

        if (command.startsWith(prefix + 'unban')) {
          const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (users.length > 0) {
            this.bans.delete(users[0]);
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Débanni !* @${users[0].split('@')[0]} est à nouveau le bienvenu. 🎀`, mentions: [users[0]] }, { quoted: msg });
          }
        }

        // Tools (Outils) Commands
        if (command === prefix + 'vv') {
          const contextInfo = msg.message.extendedTextMessage?.contextInfo;
          const quoted = contextInfo?.quotedMessage;
          
          if (!quoted) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Réponds à une image ou une vidéo avec *.vv* pour que je puisse la cacher. ✨` }, { quoted: msg });
            return;
          }

          const mediaMsg = quoted.imageMessage || quoted.videoMessage || 
                           quoted.viewOnceMessageV2?.message?.imageMessage || 
                           quoted.viewOnceMessageV2?.message?.videoMessage ||
                           quoted.viewOnceMessage?.message?.imageMessage ||
                           quoted.viewOnceMessage?.message?.videoMessage;

          if (!mediaMsg) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Ce message n'est pas un média (image ou vidéo). 🎀` }, { quoted: msg });
            return;
          }

          try {
            const buffer = await downloadMediaMessage(
              { 
                key: { 
                  remoteJid, 
                  id: contextInfo.stanzaId, 
                  participant: contextInfo.participant || remoteJid 
                }, 
                message: quoted 
              } as any,
              'buffer',
              {},
              { logger: pino({ level: 'silent' }) } as any
            );

            const type = (quoted.imageMessage || quoted.viewOnceMessageV2?.message?.imageMessage || quoted.viewOnceMessage?.message?.imageMessage) ? 'image' : 'video';
            
            const messageContent: any = {
              [type]: buffer,
              viewOnce: true,
              caption: "*🌸 VOICI L'IMAGE / VIDEO CACHÉE 🌸*"
            };

            await this.sock?.sendMessage(remoteJid, messageContent, { quoted: msg });
          } catch (err) {
            console.error('Error in VV command:', err);
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de traiter ce média. 🧚💔` }, { quoted: msg });
          }
        }

        if (command.toLowerCase() === 'statuts' || command.toLowerCase() === prefix + 'statuts') {
          const contextInfo = msg.message.extendedTextMessage?.contextInfo;
          const quoted = contextInfo?.quotedMessage;
          if (quoted) {
            const mediaMsg = quoted.imageMessage || quoted.videoMessage || quoted.audioMessage || quoted.documentMessage;
            if (mediaMsg) {
              const fakeMsg = {
                key: {
                  remoteJid,
                  id: contextInfo.stanzaId,
                  participant: contextInfo.participant
                },
                message: quoted
              };

              const buffer = await downloadMediaMessage(
                fakeMsg as any,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }) } as any
              );
              
              let type = '';
              if (quoted.imageMessage) type = 'image';
              else if (quoted.videoMessage) type = 'video';
              else if (quoted.audioMessage) type = 'audio';
              else if (quoted.documentMessage) type = 'document';

              const messageContent: any = {
                [type]: buffer,
                caption: `*🌸 MINI-XD STATUS DOWNLOAD 🌸*\n\n*🧚 Statut récupéré avec succès ! ✨*`,
                contextInfo: {
                  forwardingScore: 999,
                  isForwarded: true,
                  forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363406104843715@newsletter',
                    serverMessageId: 1,
                    newsletterName: 'MINI-XD BOT UPDATES'
                  }
                }
              };
              if (type === 'audio') {
                delete messageContent.caption;
                messageContent.ptt = true;
              }
              await this.sock?.sendMessage(remoteJid, messageContent, { quoted: msg });
            } else {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Ce n'est pas un statut média. ✨` }, { quoted: msg });
            }
          } else {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Réponds à un statut pour que je puisse le récupérer. 🎀` }, { quoted: msg });
          }
        }

        if (command === prefix + 'sticker' || command === prefix + 's') {
          const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage || msg.message;
          const mediaMsg = quoted?.imageMessage || quoted?.videoMessage || 
                           msg.message?.imageMessage || msg.message?.videoMessage;
          
          if (mediaMsg) {
            const buffer = await downloadMediaMessage(
              { 
                key: { 
                  remoteJid, 
                  id: msg.message.extendedTextMessage?.contextInfo?.stanzaId || msg.key.id, 
                  participant: msg.message.extendedTextMessage?.contextInfo?.participant || msg.key.participant 
                }, 
                message: quoted 
              } as any,
              'buffer',
              {},
              { logger: pino({ level: 'silent' }) } as any
            );
            
            const sticker = new Sticker(buffer, {
              pack: '🌸 MINI-XD BOT 🌸',
              author: 'Samy Charles',
              type: StickerTypes.FULL,
              categories: [],
              id: '12345',
              quality: 50,
              background: '#00000000'
            });
            
            await this.sock?.sendMessage(remoteJid, await sticker.toMessage(), { quoted: msg });
          } else {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Réponds à une image ou une vidéo pour créer un sticker. 🎀` }, { quoted: msg });
          }
        }

        if (command === prefix + 'toimg' || command === prefix + 'tovideo') {
          const contextInfo = msg.message.extendedTextMessage?.contextInfo;
          const quoted = contextInfo?.quotedMessage;
          const stickerMsg = quoted?.stickerMessage;
          
          if (stickerMsg) {
            const buffer = await downloadMediaMessage(
              { key: { remoteJid, id: contextInfo.stanzaId, participant: contextInfo.participant || remoteJid }, message: quoted } as any,
              'buffer',
              {},
              { logger: pino({ level: 'silent' }) } as any
            );
            
            const isAnimated = stickerMsg.isAnimated;
            if (isAnimated) {
              await this.sock?.sendMessage(remoteJid, { 
                video: buffer, 
                caption: `*🌸 MINI-XD STICKER TO VIDEO 🌸*\n\n*🧚 Conversion réussie ! ✨*`,
                gifPlayback: true,
                contextInfo: {
                  forwardingScore: 999,
                  isForwarded: true,
                  forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363406104843715@newsletter',
                    serverMessageId: 1,
                    newsletterName: 'MINI-XD BOT UPDATES'
                  }
                }
              }, { quoted: msg });
            } else {
              await this.sock?.sendMessage(remoteJid, { 
                image: buffer, 
                caption: `*🌸 MINI-XD STICKER TO IMAGE 🌸*\n\n*🧚 Conversion réussie ! ✨*`,
                contextInfo: {
                  forwardingScore: 999,
                  isForwarded: true,
                  forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363406104843715@newsletter',
                    serverMessageId: 1,
                    newsletterName: 'MINI-XD BOT UPDATES'
                  }
                }
              }, { quoted: msg });
            }
          } else if (command === prefix + 'toimg') {
            // Profile picture logic if not a sticker
            const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const target = users[0] || sender;
            try {
              const ppUrl = await this.sock?.profilePictureUrl(target, 'image');
              if (ppUrl) {
                await this.sock?.sendMessage(remoteJid, { image: { url: ppUrl }, caption: `*🌸 Photo de profil récupérée ! ✨*` }, { quoted: msg });
              } else {
                await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Cet utilisateur n'a pas de photo de profil publique. 🎀` }, { quoted: msg });
              }
            } catch (e) {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de récupérer la photo. ✨` }, { quoted: msg });
            }
          } else {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Réponds à un sticker pour que je puisse le convertir. 🎀` }, { quoted: msg });
          }
        }

        if (command.startsWith(prefix + 'autoreact')) {
          const mode = args[0]?.toLowerCase();
          if (mode === 'on') {
            this.autoreact = true;
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Autoreact activé !* Je vais réagir à tous les messages. ✨` }, { quoted: msg });
          } else if (mode === 'off') {
            this.autoreact = false;
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Autoreact désactivé !* Je reste discrète. 🎀` }, { quoted: msg });
          }
        }

        if (command === prefix + 'jid') {
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 JID :* ${remoteJid} ✨` }, { quoted: msg });
        }

        if (command === prefix + 'anime') {
          try {
            const res = await axios.get('https://api.waifu.pics/sfw/waifu');
            await this.sock?.sendMessage(remoteJid, { image: { url: res.data.url }, caption: `*🌸 Voici une petite image d'anime pour toi ! ✨*` }, { quoted: msg });
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de récupérer une image d'anime. 🎀` }, { quoted: msg });
          }
        }

        if (command === prefix + 'alive') {
          const uptime = Date.now() - this.startTime;
          const hours = Math.floor(uptime / 3600000);
          const minutes = Math.floor((uptime % 3600000) / 60000);
          const seconds = Math.floor((uptime % 60000) / 1000);
          const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

          await this.sock?.sendMessage(remoteJid, { 
            text: `*╭─── 🌸 MINI-XD ALIVE 🌸 ───╮*
*│*  👑 *Owner*  : Samy Charles
*│*  ⏳ *Uptime* : ${uptimeStr}
*│*  🎀 *Mode*   : ${this.publicMode ? 'Public' : 'Privé'}
*│*  🧚 *Statut* : Connectée 🌟
*╰──────────────────────╯*

*🧚 Toujours là pour vous servir avec amour et magie. ✨*`,
            contextInfo: {
              forwardingScore: 999,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: '120363406104843715@newsletter',
                serverMessageId: 1,
                newsletterName: 'MINI-XD BOT UPDATES'
              }
            }
          }, { quoted: msg });
        }

        if (command === prefix + 'ping' || command === prefix + 'speed') {
          const start = Date.now();
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 Calcul de la vitesse...*` }, { quoted: msg });
          const end = Date.now();
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 Vitesse :* ${end - start}ms ✨` }, { quoted: msg });
        }

        if (command === prefix + 'translate') {
          const query = args.join(' ');
          if (query) {
            try {
              const res = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=auto|fr`);
              const translation = res.data.responseData.translatedText;
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 TRADUCTION 🌸*\n\n*🧚 Texte :* ${query}\n*✨ Traduction :* ${translation} 🎀` }, { quoted: msg });
            } catch (e) {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Erreur lors de la traduction. ✨` }, { quoted: msg });
            }
          } else {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Donne-moi un texte à traduire chéri(e). 🎀` }, { quoted: msg });
          }
        }

        if (command === prefix + 'owner') {
          const ownerCard = `*╭─── 👑 OWNER 👑 ───╮*
*│*  ✨ *Nom*  : Samy Charles
*│*  🎀 *Âge*  : 15 ans
*│*  🧚 *Num*  : +2250574082069
*│*  🌸 *Pays* : Ivoirien 🇨🇮
*│*  ✨ *Ville*: Abidjan
*│*  🎀 *Rôle* : Développeur MINI-XD
*│*  🧚 *Passion*: Codage & Musique
*│*  🌸 *Status*: Passionné de Bot
*╰──────────────────╯*
*🧚 Fait avec amour par MINI-XD 🧚*`;
          
          await this.sock?.sendMessage(remoteJid, { 
            text: ownerCard,
            contextInfo: {
              forwardingScore: 999,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: '120363406104843715@newsletter',
                serverMessageId: 1,
                newsletterName: 'MINI-XD BOT UPDATES'
              }
            }
          }, { quoted: msg });
        }

        if (command === prefix + 'groupinfo' && isGroup) {
          const metadata = await this.sock?.groupMetadata(remoteJid);
          const info = `*🌸 INFOS DU GROUPE 🌸*\n\n*🎀 Nom :* ${metadata?.subject}\n*🧚 ID :* ${metadata?.id}\n*🌸 Créateur :* @${metadata?.owner?.split('@')[0]}\n*🎀 Membres :* ${metadata?.participants.length}\n*🧚 Description :*\n${metadata?.desc || 'Aucune description'}`;
          await this.sock?.sendMessage(remoteJid, { text: info, mentions: [metadata?.owner || ''] }, { quoted: msg });
        }

        if (command === prefix + 'getpp') {
          const quoted = msg.message.extendedTextMessage?.contextInfo?.participant;
          const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
          const target = mentioned || quoted || sender;
          try {
            const ppUrl = await this.sock?.profilePictureUrl(target, 'image');
            if (ppUrl) {
              await this.sock?.sendMessage(remoteJid, { image: { url: ppUrl }, caption: `*🌸 Voici la photo de profil ! ✨*` }, { quoted: msg });
            } else {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Pas de photo de profil trouvée (elle est peut-être privée). 🎀` }, { quoted: msg });
            }
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de récupérer la photo. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'goodbye' && isGroup && isAdmin) {
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 Au revoir tout le monde !* C'était un plaisir de vous avoir ici. ✨👋` }, { quoted: msg });
        }

        if (command === prefix + 'admins' && isGroup) {
          const metadata = await this.sock?.groupMetadata(remoteJid);
          const admins = metadata?.participants.filter(p => p.admin) || [];
          const adminList = admins.map(a => `@${a.id.split('@')[0]}`).join('\n');
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 ADMINISTRATEURS 🌸*\n\n${adminList}`, mentions: admins.map(a => a.id) }, { quoted: msg });
        }

        if (command === prefix + 'gcpp' && isGroup) {
          try {
            const ppUrl = await this.sock?.profilePictureUrl(remoteJid, 'image');
            if (ppUrl) {
              await this.sock?.sendMessage(remoteJid, { image: { url: ppUrl }, caption: `*🌸 Photo du groupe récupérée ! ✨*` }, { quoted: msg });
            } else {
              await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Ce groupe n'a pas de photo de profil publique. 🎀` }, { quoted: msg });
            }
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de récupérer la photo du groupe. ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'poll') {
          const parts = args.join(' ').split('|');
          if (parts.length >= 3) {
            const question = parts[0];
            const options = parts.slice(1);
            await this.sock?.sendMessage(remoteJid, {
              poll: {
                name: question,
                values: options,
                selectableCount: 1
              }
            }, { quoted: msg });
          } else {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Utilise le format : .poll question|option1|option2 ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'block') {
          const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (users.length > 0) {
            await this.sock?.updateBlockStatus(users[0], 'block');
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Utilisateur bloqué !* ✨` }, { quoted: msg });
          }
        }

        if (command === prefix + 'unblock') {
          const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (users.length > 0) {
            await this.sock?.updateBlockStatus(users[0], 'unblock');
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Utilisateur débloqué !* 🎀` }, { quoted: msg });
          }
        }

        if (command === prefix + 'public') {
          this.publicMode = true;
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 Mode Public activé !* Tout le monde peut m'utiliser. ✨` }, { quoted: msg });
        }

        if (command === prefix + 'private') {
          this.publicMode = false;
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 Mode Privé activé !* Seul mon maître peut m'utiliser. 🎀` }, { quoted: msg });
        }

        if (command === prefix + 'support') {
          await this.sock?.sendMessage(remoteJid, { text: `*🌸 BESOIN D'AIDE ? 🌸*\n\n*🧚 Rejoins notre canal de support pour toutes tes questions ! ✨*\n\n*🎀 Lien :* https://chat.whatsapp.com/votre-lien-support\n*🧚 Fait avec amour par Samy Charles 🌟*` }, { quoted: msg });
        }

        if (command === prefix + 'blocklist') {
          const blocks = await this.sock?.fetchBlocklist();
          if (blocks && blocks.length > 0) {
            const list = blocks.map(b => `*🎀 @${b.split('@')[0]}*`).join('\n');
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 LISTE DES BLOQUÉS 🌸*\n\n${list}`, mentions: blocks }, { quoted: msg });
          } else {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Personne n'est bloqué pour le moment. ✨` }, { quoted: msg });
          }
        }

        // Manga Module
        const mangaCommands = ['waifu', 'neko', 'shinobu', 'megumin', 'cuddle', 'hug', 'kiss', 'pat', 'slap'];
        if (mangaCommands.includes(command.replace(prefix, ''))) {
          const type = command.replace(prefix, '');
          try {
            const res = await axios.get(`https://api.waifu.pics/sfw/${type}`);
            const caption = `*🌸 Voici ton ${type} ! ✨*`;
            if (res.data.url.endsWith('.gif')) {
              await this.sock?.sendMessage(remoteJid, { video: { url: res.data.url }, gifPlayback: true, caption }, { quoted: msg });
            } else {
              await this.sock?.sendMessage(remoteJid, { image: { url: res.data.url }, caption }, { quoted: msg });
            }
          } catch (e) {
            await this.sock?.sendMessage(remoteJid, { text: `*🌸 Oups !* Impossible de récupérer ton ${type}. 🎀` }, { quoted: msg });
          }
        }
      });

    } catch (error: any) {
      console.error('Failed to initialize WhatsApp Bot:', error);
      this.isInitializing = false;
      const delay = error?.message?.includes('internal-server-error') ? 5000 : 10000;
      setTimeout(() => this.init(), delay);
    }
  }

  async getPairingCode(phoneNumber: string): Promise<string> {
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    
    if (!this.sock) {
      await this.init();
    }

    // Wait for socket to be initialized
    let attempts = 0;
    while (!this.sock && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (!this.sock) {
      throw new Error('Socket initialization failed');
    }

    // If already registered, we can't get a pairing code
    if (this.sock.authState.creds.registered) {
      throw new Error('already registered');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pairingCodeRequest = null;
        reject(new Error('Timeout requesting pairing code from WhatsApp'));
      }, 30000);

      this.pairingCodeRequest = {
        phoneNumber: cleanNumber,
        resolve: (code) => {
          clearTimeout(timeout);
          resolve(code);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      };

      // Try to request immediately if possible
      this.sock?.requestPairingCode(cleanNumber)
        .then(code => {
          if (this.pairingCodeRequest) {
            this.pairingCodeRequest.resolve(code);
            this.pairingCodeRequest = null;
          }
        })
        .catch(err => {
          console.error('Initial pairing code request failed, will retry on connection update:', err);
          // Don't reject yet, the connection update might succeed
        });
    });
  }
}

export class BotManager {
  private bots: Map<string, WhatsAppBot> = new Map();

  getBot(userId: string): WhatsAppBot {
    let bot = this.bots.get(userId);
    if (!bot) {
      bot = new WhatsAppBot(userId);
      this.bots.set(userId, bot);
      // Initiate initialization in the background
      bot.init().catch(err => console.error(`Failed to init bot for ${userId}:`, err));
    }
    return bot;
  }

  async initAll() {
    const sessionsDir = path.join(process.cwd(), 'sessions');
    if (fs.existsSync(sessionsDir)) {
      const userIds = fs.readdirSync(sessionsDir);
      for (const userId of userIds) {
        const bot = this.getBot(userId);
        bot.init();
      }
    }
  }
}

export const botManager = new BotManager();
