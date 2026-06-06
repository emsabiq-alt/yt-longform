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

### Aplikasi lokal (Python)
```bash
cd app
cp config.example.json config.json   # isi token GitHub & state URL
python yt_studio.py                   # atau klik run-app.bat di Windows
```
Tab **Generate** bisa menjalankan pipeline lokal (Node) atau men-trigger GitHub Action.
Tab **Monitor** menampilkan daftar video dari state hosting.

## Sinkronisasi TTS (longform)
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
