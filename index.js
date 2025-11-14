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

    // ---- EZ AZ ÚJ, OKOSABB RÉSZ ----
    // Megnézzük, hogy a link .m3u8 VAGY .txt-e
    const isManifest = videoUrl.endsWith('.m3u8') || videoUrl.endsWith('.txt');

    try {
        const response = await axios.get(videoUrl, {
            // Ha manifest (.m3u8 vagy .txt), akkor szövegként, 
            // egyébként (pl. .ts, .woff2) bináris adatként kérjük le.
            responseType: isManifest ? 'text' : 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const contentType = response.headers['content-type'];
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (isManifest) {
            // **A LEGFONTOSABB RÉSZ:** Átírjuk a manifest (.m3u8 vagy .txt) tartalmát
            let manifest = response.data;
            
            // Minden sort, ami egy link (nem # kezdetű), átírunk, 
            // hogy az is a mi proxy-nkon keresztül jöjjön (legyen az .ts vagy .woff2)
            manifest = manifest.replace(/^(?!#)(.*)$/gm, (match) => {
                const absoluteUrl = new URL(match, videoUrl).href;
                // Az URL-t átalakítjuk: /proxy?url=[az eredeti videó darab linkje]
                return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            });
            
            res.send(manifest);
        } else {
            // Ha .ts vagy .woff2 (videó darab) fájl, csak küldjük a bináris adatot
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
