const express = require('express');
const fileUpload = require('express-fileupload');
const WebTorrent = require('webtorrent');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const app = express();
const client = new WebTorrent();

// Создаем папки для временных файлов, если их нет
['temp', 'downloads', 'archives'].forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
});

app.use(fileUpload());
app.use(express.static('public')); // Здесь будет лежать фронтенд (интерфейс)

app.post('/upload-torrent', (req, res) => {
    if (!req.files || !req.files.torrentFile) {
        return res.status(400).json({ error: 'Файл торрента не выбран.' });
    }

    const torrentFile = req.files.torrentFile;
    const uploadPath = path.join(__dirname, 'temp', `${Date.now()}_${torrentFile.name}`);

    torrentFile.mv(uploadPath, (err) => {
        if (err) return res.status(500).json({ error: err.message });

        console.log(`Запуск скачивания торрента...`);

        client.add(uploadPath, { path: path.join(__dirname, 'downloads', Date.now().toString()) }, (torrent) => {
            console.log(`Качаем: ${torrent.name}`);

            torrent.on('done', () => {
                console.log('Скачивание завершено! Запаковываем в ZIP...');
                
                const zipName = `${torrent.infoHash}.zip`;
                const zipPath = path.join(__dirname, 'archives', zipName);
                const output = fs.createWriteStream(zipPath);
                const archive = archiver('zip', { zlib: { level: 5 } });

                output.on('close', () => {
                    res.json({ 
                        success: true, 
                        downloadUrl: `/download/${zipName}` 
                    });
                    // Удаляем .torrent файл
                    fs.unlink(uploadPath, () => {});
                });

                archive.on('error', (err) => {
                    res.status(500).json({ error: err.message });
                });

                archive.pipe(output);
                archive.directory(torrent.path, false);
                archive.finalize();
            });

            torrent.on('error', (err) => {
                res.status(500).json({ error: err.message });
            });
        });
    });
});

app.get('/download/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'archives', req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath, () => {
            // Опционально: можно удалить архив после скачивания, чтобы не забивать диск
            // fs.unlink(filePath, () => {});
        });
    } else {
        res.status(404).send('Архив не найден.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
