const express = require('express');
const axios = require('axios');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const WebSocket = require('ws');

// --- BIZTONSÁGI KULCS ---
const BOT_SECRET_KEY = process.env.BOT_SECRET_KEY;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

// --- PROXY ENDPOINT ---
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('Hiányzó "url" paraméter');
    
    // Egyszerűsített CORS/Referer kezelés
    let origin;
    try {
        origin = new URL(videoUrl).origin;
    } catch (e) {
        return res.status(400).send('Érvénytelen URL');
    }

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': origin
    };

    try {
        // M3U8 és TXT fájlok szöveges kezelése (hogy a benne lévő linkeket is proxyzzuk)
        const isManifest = videoUrl.includes('.m3u8') || videoUrl.includes('.txt');
        
        let response = await axios.get(videoUrl, {
            responseType: isManifest ? 'text' : 'stream',
            headers: headers, 
            validateStatus: (status) => status < 400
        });

        // Átirányítások követése manuálisan (ha szükséges)
        if (response.status >= 300 && response.headers.location) {
             let newUrl = response.headers.location;
             if (newUrl.startsWith('/')) newUrl = origin + newUrl;
             response = await axios.get(newUrl, { 
                 responseType: isManifest ? 'text' : 'stream', 
                 headers: headers 
             });
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', response.headers['content-type']);

        if (isManifest) {
            // A manifest fájlban lévő linkeket átírjuk, hogy azok is proxy-n menjenek
            const modifiedManifest = response.data.replace(/^(?!#)(.*)$/gm, (match) => {
                const absoluteUrl = new URL(match, videoUrl).href;
                return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            });
            res.send(modifiedManifest);
        } else {
            // Videó stream továbbítása
            response.data.pipe(res);
        }
    } catch (error) {
        console.error('Proxy hiba:', error.message);
        if (!res.headersSent) res.sendStatus(500);
    }
});

// --- FŐOLDAL KISZOLGÁLÁSA ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- WEBSOCKET (Bot vezérléshez) ---
const webClients = new Set();
wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
        try {
            const d = JSON.parse(msg);
            if (d.type === 'AUTH' && d.secret === BOT_SECRET_KEY) ws.isBot = true;
            if (ws.isBot && d.type === 'PLAY_VIDEO') {
                webClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(d)); });
            }
        } catch (e) {}
    });
    if (!ws.isBot) webClients.add(ws);
    ws.on('close', () => webClients.delete(ws));
});

server.listen(port, () => console.log(`Szerver fut: ${port}`));
