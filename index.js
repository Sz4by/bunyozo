const express = require('express');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');

const app = express();
// A Render.com automatikusan beállítja a PORT-ot
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

    try {
        const response = await axios.get(videoUrl, {
            // .m3u8 (szöveg), .ts (bináris)
            responseType: (videoUrl.endsWith('.m3u8') ? 'text' : 'arraybuffer'),
            headers: {
                // Eljátsszuk, hogy egy böngésző vagyunk
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // Továbbítjuk a videó típusát a böngészőnek
        const contentType = response.headers['content-type'];
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (videoUrl.endsWith('.m3u8')) {
            // **A LEGFONTOSABB RÉSZ:** Átírjuk az .m3u8 fájlt
            let manifest = response.data;
            
            // Minden sort, ami egy link (nem # kezdetű), átírunk, 
            // hogy az is a mi proxy-nkon keresztül jöjjön
            manifest = manifest.replace(/^(?!#)(.*)$/gm, (match) => {
                const absoluteUrl = new URL(match, videoUrl).href;
                // Az URL-t átalakítjuk: /proxy?url=[az eredeti videó darab linkje]
                return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            });
            
            res.send(manifest);
        } else {
            // Ha .ts (videó darab) fájl, csak küldjük a bináris adatot
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
