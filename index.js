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

// 2. A proxy végpont, ami letölti és továbbítja a videót
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) {
        return res.status(400).send('Hiányzó "url" paraméter');
    }

    // Megnézzük, hogy HLS stream-e (a korábbi linkjeid)
    const isManifest = videoUrl.includes('.m3u8') || videoUrl.includes('.txt');
    
    // ---- EZ AZ ÚJ RÉSZ ----
    // Lekérjük az eredeti URL "gyökerét" (pl. "https://video1.videa.hu")
    const urlObj = new URL(videoUrl);
    const origin = urlObj.origin;
    // -------------------------

    try {
        const response = await axios.get(videoUrl, {
            responseType: isManifest ? 'text' : 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                
                // ---- EZ AZ ÚJ SOR ----
                // Hozzáadjuk a Referer fejlécet, hogy becsapjuk a szervert
                'Referer': origin
            }
        });

        const contentType = response.headers['content-type'];
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (isManifest) {
            // Átírjuk az .m3u8 vagy .txt tartalmát
            let manifest = response.data;
            manifest = manifest.replace(/^(?!#)(.*)$/gm, (match) => {
                const absoluteUrl = new URL(match, videoUrl).href;
                return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            });
            res.send(manifest);
        } else {
            // .ts, .woff2, vagy a Videa .mp4 fájl
            res.send(response.data);
        }

    } catch (error) {
        console.error('Proxy hiba:', error.message);
        res.status(500).send('Hiba a videó tartalmának letöltése közben');
    }
});

app.listen(port, () => {
    console.log(`HLS proxy szerver elindult a ${port} porton`);
});
