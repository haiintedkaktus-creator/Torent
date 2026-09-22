const express = require('express');
const fileUpload = require('express-fileupload');
const WebTorrent = require('webtorrent');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const client = new WebTorrent();

// ==================== ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ====================
const DB_USER = 'haiintedkaktus_db_user';
const DB_PASS = '1ZrA9CaA8nv2byEV';
// Если у вас MongoDB Atlas, замените cluster0.xxxx на ваш кластер или укажите свой хост
const MONGO_URI = `mongodb+srv://${DB_USER}:${DB_PASS}@cluster0.mongodb.net/torrent_service?retryWrites=true&w=majority`;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Успешное подключение к MongoDB!'))
    .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));

// Схема для сохранения истории скачиваний в БД
const DownloadSchema = new mongoose.Schema({
    torrentName: String,
    infoHash: String,
    zipFilename: String,
    createdAt: { type: Date, default: Date.now }
});
const DownloadRecord = mongoose.model('DownloadRecord', DownloadSchema);

// ==================== НАСТРОЙКА СЕРВЕРА ====================
// Создаем необходимые папки, если их нет
['temp', 'downloads', 'archives'].forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
});

app.use(fileUpload());
app.use(express.static('public')); // Раздаем фронтенд из папки public

// Эндпоинт загрузки .torrent файла
app.post('/upload-torrent', (req, res) => {
    if (!req.files || !req.files.torrentFile) {
        return res.status(400).json({ error: 'Файл торрента не выбран.' });
    }

    const torrentFile = req.files.torrentFile;
    const uniqueName = `${Date.now()}_${torrentFile.name}`;
    const uploadPath = path.join(__dirname, 'temp', uniqueName);

    torrentFile.mv(uploadPath, (err) => {
        if (err) return res.status(500).json({ error: err.message });

        console.log(`📥 Запуск скачивания торрента...`);

        client.add(uploadPath, { path: path.join(__dirname, 'downloads', Date.now().toString()) }, (torrent) => {
            console.log(`⚡ Качаем: ${torrent.name}`);

            torrent.on('done', async () => {
                console.log('📦 Скачивание завершено! Запаковываем в ZIP...');
                
                const zipName = `${torrent.infoHash}.zip`;
                const zipPath = path.join(__dirname, 'archives', zipName);
                const output = fs.createWriteStream(zipPath);
                const archive = archiver('zip', { zlib: { level: 5 } });

                output.on('close', async () => {
                    try {
                        // Сохраняем информацию о скачивании в базу данных
                        await DownloadRecord.create({
                            torrentName: torrent.name,
                            infoHash: torrent.infoHash,
                            zipFilename: zipName
                        });
                        console.log('💾 Запись сохранена в базу данных.');
                    } catch (dbErr) {
                        console.error('Ошибка сохранения в БД:', dbErr);
                    }

                    res.json({ 
                        success: true, 
                        downloadUrl: `/download/${zipName}` 
                    });

                    // Удаляем временный .torrent файл
                    fs.unlink(uploadPath, () => {});
                    // Уничтожаем сессию торрента, чтобы освободить память
                    torrent.destroy();
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

// Эндпоинт для скачивания готового ZIP архива
app.get('/download/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'archives', req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).send('Архив не найден или был удален.');
    }
});

// Эндпоинт для просмотра истории скачиваний из БД
app.get('/history', async (req, res) => {
    try {
        const records = await DownloadRecord.find().sort({ createdAt: -1 }).limit(10);
        res.json(records);
    } catch (e) {
        res.status(500).json({ error: 'Не удалось получить историю' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
