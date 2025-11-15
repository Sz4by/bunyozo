const express = require('express');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');

const app = express();
const port = process.env.PORT || 3000;

// 1. A lejátszó (index.html) kiszolgálása
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. A proxy végpont
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) {
        return res.status(400).send('Hiányzó "url" paraméter');
    }

    const isManifest = videoUrl.includes('.m3u8') || videoUrl.includes('.txt');
    const origin = new URL(videoUrl).origin;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': origin
    };

    try {
        let response;
        try {
            // Első kérés:
            response = await axios.get(videoUrl, {
                // ---- EZ A VÁLTOZÁS (1) ----
                // Ha manifest (szöveg), akkor 'text', egyébként 'stream'-et kérünk (nem 'arraybuffer'-t)
                responseType: isManifest ? 'text' : 'stream', 
                headers: headers,
                maxRedirects: 0,
                validateStatus: (status) => (status >= 200 && status < 400)
            });
        } catch (error) {
            console.error('Proxy hiba (1. kérés):', error.message);
            return res.status(500).send('Hiba a videó tartalmának letöltése közben (1. kérés)');
        }

        // Átirányítás kezelése
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            let redirectUrl = response.headers.location;
            if (redirectUrl.startsWith('/')) {
                redirectUrl = `${origin}${redirectUrl}`;
            }
            console.log('Átirányítás észlelve, új URL:', redirectUrl);

            // Második kérés (a végleges URL-re)
            response = await axios.get(redirectUrl, {
                // ---- EZ A VÁLTOZÁS (2) ----
                responseType: isManifest ? 'text' : 'stream', // Itt is stream-et kérünk
                headers: headers
            });
        }

        // --- VÁLASZ FELDOLGOZÁSA ---
        const contentType = response.headers['content-type'];
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (isManifest) {
            // Az .m3u8 fájlokat (szöveg) átírjuk és elküldjük
            let manifest = response.data;
            manifest = manifest.replace(/^(?!#)(.*)$/gm, (match) => {
                const absoluteUrl = new URL(match, videoUrl).href;
                return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            });
            res.send(manifest);
        } else {
            // ---- EZ A VÁLTOZÁS (3) ----
            // A videó stream-et (pl. .mp4, .ts) nem töltjük le, hanem
            // egyenesen "átpumpáljuk" (pipe) a felhasználóhoz.
            // Ez tartja alacsonyan a RAM használatot.
            response.data.pipe(res);
        }

    } catch (error) {
        console.error('Proxy hiba (feldolgozás):', error.message);
        if (!res.headersSent) {
            res.status(500).send('Hiba a videó tartalmának feldolgozása közben');
        }
    }
});

app.listen(port, () => {
    console.log(`HLS proxy szerver elindult a ${port} porton`);
});
