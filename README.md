# GitHub ZIP Uploader CLI

Alat otomatis berbasis Node.js untuk mengekstrak file `.zip` langsung di memori dan mengunggahnya ke repositori GitHub (repo baru maupun repo yang sudah ada) dalam **satu commit tunggal** menggunakan **GitHub Git Data API (Tree & Blob)**.

## Fitur Utama
- **Atomic Single Commit**: Ratusan file dalam ZIP ter-commit sekaligus dalam satu SHA commit (bukan looping commit per file).
- **Auto Root Directory Flattening**: Otomatis mendeteksi jika file zip dibungkus oleh folder tunggal (misal `my-project/...`) dan memotong prefix folder tersebut agar file langsung berada di root repository.
- **Support Binary & Text Files**: Mengunggah gambar, dokumen, maupun script/teks secara tepat dengan encoding Base64.
- **Buat Repo Baru / Repo Lama**: Mendukung pembuatan repository baru (Public/Private) atau push ke repository yang sudah ada.
- **Smart Filtering**: Mengabaikan file sampah seperti `.DS_Store`, `Thumbs.db`, `.git/`, dsb.

## Cara Penggunaan

### 1. Instalasi
Pastikan Node.js (v18+) sudah terpasang. Ekstrak file zip ini, lalu buka terminal di dalam folder:
```bash
npm install
```

### 2. Konfigurasi Token GitHub
1. Salin file `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
2. Dapatkan token GitHub di [GitHub Settings > Developer Settings > Personal access tokens](https://github.com/settings/tokens).
3. Beri izin hak akses (scope) `repo` (Full control of private repositories).
4. Masukkan token ke `.env`:
   ```env
   GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   ```

### 3. Jalankan Program
```bash
npm start
```
atau
```bash
node index.js
```

Ikuti panduan interaktif di terminal:
1. Masukkan lokasi file `.zip` (misal `./project.zip`).
2. Pilih apakah ingin membuat repo baru atau repo yang sudah ada.
3. Tentukan nama repo, status visibilitas (jika baru), branch target, dan commit message.
