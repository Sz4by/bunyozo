const express = require('express');
const axios = require('axios');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const WebSocket = require('ws');

// --- BIZTONSÁGI KULCS ---
const BOT_SECRET_KEY = process.env.BOT_SECRET_KEY;
if (!BOT_SECRET_KEY) {
    console.warn('FIGYELEM: A BOT_SECRET_KEY nincs beállítva! A bot nem fog tudni csatlakozni.');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

// --- A PROXY RÉSZ ---
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('Hiányzó "url" paraméter');
    const isManifest = videoUrl.includes('.m3u8') || videoUrl.includes('.txt');
    const origin = new URL(videoUrl).origin;
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': origin
    };
    try {
        let response = await axios.get(videoUrl, {
            responseType: isManifest ? 'text' : 'stream',
            headers: headers, maxRedirects: 0, validateStatus: (status) => (status >= 200 && status < 400)
        });
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            let redirectUrl = response.headers.location;
            if (redirectUrl.startsWith('/')) redirectUrl = `${origin}${redirectUrl}`;
            response = await axios.get(redirectUrl, { responseType: isManifest ? 'text' : 'stream', headers: headers });
        }
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (isManifest) {
            let manifest = response.data.replace(/^(?!#)(.*)$/gm, (match) => 
                `/proxy?url=${encodeURIComponent(new URL(match, videoUrl).href)}`
            );
            res.send(manifest);
        } else {
            response.data.pipe(res);
        }
    } catch (error) {
        if (!res.headersSent) res.status(500).send('Proxy hiba');
    }
});

// --- A WEBOLDAL KISZOLGÁLÁSA ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- WEBSOCKET "RÁDIÓTORONY" ---
const webClients = new Set(); // A csatlakozott böngészők
let authenticatedBot = null; // A csatlakozott bot

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'AUTH' && data.secret === BOT_SECRET_KEY) {
                console.log('Discord Bot sikeresen hitelesítve és csatlakozva.');
                authenticatedBot = ws;
                ws.isBot = true;
                return;
            }

            if (ws.isBot && data.type === 'PLAY_VIDEO') {
                console.log(`[BOT] Play parancs továbbítása: ${data.url}`);
                webClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            }
        } catch (e) {
            console.warn('Ismeretlen WebSocket üzenet:', message);
        }
    });

    ws.on('close', () => {
        if (ws.isBot) {
            console.log('Discord Bot lecsatlakozott.');
            authenticatedBot = null;
        } else {
            webClients.delete(ws);
            console.log(`Web kliens lecsatlakozott. Maradt: ${webClients.size}`);
        }
    });

    if (!ws.isBot) {
        webClients.add(ws);
        console.log(`Web kliens csatlakozott. Jelenleg: ${webClients.size}`);
    }
});

// --- SZERVER INDÍTÁSA ---
server.listen(port, () => {
    console.log(`Szaby Lejátszó központ (Web+Proxy+WebSocket) elindult a ${port} porton`);
});
