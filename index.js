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
    const origin = new URL(videoUrl).origin; // pl. "https://video1.videa.hu"

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': origin
    };

    try {
        // --- EZ AZ ÚJ RÉSZ: KEZELI AZ ÁTIRÁNYÍTÁST ---
        let response;
        try {
            // Első kérés: Nem követjük az átirányítást, elkapjuk (maxRedirects: 0)
            response = await axios.get(videoUrl, {
                responseType: isManifest ? 'text' : 'arraybuffer',
                headers: headers,
                maxRedirects: 0, // FONTOS: Ne kövesse automatikusan
                validateStatus: function (status) {
                    // Elfogadjuk a 3xx (átirányítás) kódokat is hibaként való kezelés nélkül
                    return (status >= 200 && status < 300) || (status >= 300 && status < 400);
                }
            });
        } catch (error) {
            // Ha az első kérés hiba (pl. 404), vagy hálózati hiba
            console.error('Proxy hiba (1. kérés):', error.message);
            return res.status(500).send('Hiba a videó tartalmának letöltése közben (1. kérés)');
        }

        // Ha átirányítást kaptunk (301, 302, 307 stb.)
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            let redirectUrl = response.headers.location;
            
            // Ha a 'location' relatív (pl. /path/video.mp4), akkor az eredeti 'origin'-t használjuk
            if (redirectUrl.startsWith('/')) {
                redirectUrl = `${origin}${redirectUrl}`;
            }
            
            console.log('Átirányítás észlelve, új URL:', redirectUrl);

            // --- Második kérés (a végleges URL-re) ---
            // Most már a helyes 'Referer'-rel kérjük le a végleges helyről
            response = await axios.get(redirectUrl, {
                responseType: isManifest ? 'text' : 'arraybuffer',
                headers: headers // Ugyanazokat a fejléceket használjuk
            });
        }
        // --- ÁTIRÁNYÍTÁS KEZELÉSE VÉGE ---


        // --- VÁLASZ FELDOLGOZÁSA (Ugyanaz, mint eddig) ---
        const contentType = response.headers['content-type'];
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (isManifest) {
            let manifest = response.data;
            manifest = manifest.replace(/^(?!#)(.*)$/gm, (match) => {
                const absoluteUrl = new URL(match, videoUrl).href;
                return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            });
            res.send(manifest);
        } else {
            res.send(response.data);
        }

    } catch (error) {
        console.error('Proxy hiba (feldolgozás):', error.message);
        res.status(500).send('Hiba a videó tartalmának feldolgozása közben');
    }
});

app.listen(port, () => {
    console.log(`HLS proxy szerver elindult a ${port} porton`);
});
