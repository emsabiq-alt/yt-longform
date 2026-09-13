# YT Longform Studio

Studio video panjang (longform 16:9) edukasi Bahasa Indonesia. Naskah AI, gambar,
TTS **per scene** yang sinkron dengan subtitle, render FFmpeg, dan auto-upload
**khusus YouTube**. Terpisah total dari proyek `banyaktau`.

## Arsitektur

| Komponen | Lokasi |
|---|---|
| Repo | `emsabiq/yt-longform` (private) |
| Media publik | `https://yt.emsa.pro` → `public_html/yt` |
| Dashboard monitoring | `dashboard-yt.emsa.pro` (Vercel, static, read-only) |
| Aplikasi kontrol lokal | `app/yt_studio.py` (Python Tkinter) |
| Otomatisasi | GitHub Action (jadwal/manual) |

Media berat + FFmpeg jalan di GitHub Action atau lokal, hasilnya diupload via
SFTP ke `public_html/yt`. Dashboard di Vercel hanya membaca `yt.emsa.pro/state/items.json`.

## Setup

```bash
npm install
cp .env.example .env   # isi kredensial
npm run preflight      # cek ffmpeg, key, remote
```

### Menjalankan
- `npm run dev` — server + dashboard lokal di `http://localhost:3050`
- `npm run run:once` — generate satu video panjang lalu upload + publish YouTube
- `npm run rerender -- --id=<item-id>` — render ulang item yang sudah ada
- `npm run localize:youtube -- --video-id=<VIDEO_ID>` — terjemahkan judul/deskripsi video YouTube yang sudah ada
- `npm run localize:youtube:all -- --limit=0` — terjemahkan semua video channel yang belum punya lokalisasi

### Aplikasi lokal (Python)
```bash
cd app
cp config.example.json config.json   # isi token GitHub & state URL
python yt_studio.py                   # atau klik run-app.bat di Windows
```
Tab **Generate** bisa menjalankan pipeline lokal (Node) atau men-trigger GitHub Action.
Tab **Monitor** menampilkan daftar video dari state hosting.

## Sinkronisasi TTS (longform)
Default pembuatan video memakai target 720 detik (12 menit), 26 scene, dan
OpenAI TTS dengan `OPENAI_TTS_SPEED=1.08`. Naskah dipadatkan sesuai target durasi;
durasi video sebenarnya mengikuti hasil audio sehingga target 10–12 menit
perlu dinilai dari hasil render. Target lain antara 300–1200 detik tetap tersedia.

Gaya suara bawaan adalah narator dokumenter yang lincah, jelas, dan bervariasi
sesuai isi. `OPENAI_TTS_INSTRUCTIONS` dapat mengganti gaya ini untuk
`gpt-4o-mini-tts`; model `tts-1` dan `tts-1-hd` hanya menerima pengaturan speed.
Untuk membandingkan pacing, uji `OPENAI_TTS_SPEED=1.08` dan `1.10` dengan naskah
serta voice yang sama sebelum mengganti default. Pengaturan ini berlaku untuk
audio yang baru dibuat.

`npm run preview:speech` membuat dua sampel tersebut di
`generated/audio/pacing-preview/` (memerlukan key OpenAI dan FFprobe).
Workflow manual **YT Speech Pacing Preview** menjalankan perbandingan yang sama
dengan secret produksi dan menyimpan MP3 serta `comparison.json` sebagai artifact;
workflow ini tidak membuat atau mengunggah video ke YouTube.

Setiap scene (image / reaction / summary) punya file TTS sendiri. Durasi visual
mengikuti durasi audio aslinya, dan subtitle memakai timestamp transkripsi per scene.
Hasilnya: suara dan teks selalu sinkron, narasi tidak terpotong, dan reaction
ikut bersuara.

## Deploy

### Hosting media (SFTP)
Buat folder `public_html/yt` dan arahkan subdomain `yt.emsa.pro` ke sana.
Isi `SFTP_REMOTE_DIR` di `.env` / GitHub Secrets.

### Dashboard (Vercel)
```bash
vercel link        # project: dashboard-yt
vercel --prod      # deploy folder public/
```
Set domain `dashboard-yt.emsa.pro` di project Vercel.

### GitHub Secrets yang diperlukan
`PUBLIC_BASE_URL`, `SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`, `SFTP_PASSWORD`,
`SFTP_REMOTE_DIR`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` (opsional),
`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.
Token YouTube sama persis dengan akun banyaktau.

## Metadata multibahasa YouTube

Bahasa utama selalu `id` melalui `YOUTUBE_DEFAULT_LANGUAGE=id`. Setelah upload,
DeepSeek membuat judul dan deskripsi untuk 30 bahasa pada
`YOUTUBE_LOCALIZATION_LANGUAGES`, lalu YouTube Data API menyimpannya sebagai
localizations pada video yang sama. Terjemahan dibagi beberapa batch agar
aman untuk konteks model. Simpan `DEEPSEEK_API_KEY` hanya di `.env` lokal atau
secret CI; jangan pernah commit key ke Git.
