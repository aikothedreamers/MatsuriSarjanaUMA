
## v11 — Aptitude Mapping Fix
- HorseACT aptitude values now map correctly: 1=G, 2=F, 3=E, 4=D, 5=C, 6=B, 7=A, 8=S.
- Existing A values remain A; only JSON value 8 is displayed as S.
- Applies to distance and running-style aptitudes.
# MATSURI LIGHT — HorseACT After Match

Website turnamen **Matsuri Light** dengan public page, panel admin, team management, dan After Match / HorseACT race preview.

> **VERSI:** v7  
> **Node.js:** 18+  
> **Mode:** Node.js backend + static frontend

---

# 🔐 ADMIN PANEL — PASSWORD

## Password panel saat ini

**`MatsuriAdmin2026!`**

### Cara masuk Admin

1. Jalankan backend dengan `npm start`.
2. Buka website dari alamat backend, biasanya:

   `http://localhost:3000`

3. Klik logo **ML / MATSURI LIGHT** di kiri atas.
4. Masukkan password:

   `MatsuriAdmin2026!`

5. Setelah berhasil, browser membuat session authentication dan membuka panel admin.

### ⚠️ PENTING UNTUK DEPLOYMENT

Password di atas dicantumkan di README **supaya owner project mudah menemukannya**. Untuk website yang benar-benar dipublikasikan, sebaiknya ganti password dengan password pribadi yang kuat sebelum deployment.

Password **tidak disimpan sebagai plaintext di JavaScript frontend**. Backend menggunakan hash `scrypt` dan session `HttpOnly`.

---

# 🚀 MENJALANKAN WEBSITE DI PC

## 1. Pastikan Node.js terpasang

Project membutuhkan **Node.js 18 atau lebih baru**.

Cek melalui CMD:

```bat
node -v
npm -v
```

## 2. Buka CMD langsung dari folder project

Buka folder:

```text
matsuri-light
```

Klik address bar File Explorer, ketik:

```text
cmd
```

lalu Enter.

## 3. Install dependency

```bat
npm install
```

## 4. Buat file `.env`

```bat
copy .env.example .env
```

Isi `.env` dengan:

```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=ISI_SECRET_RANDOM
ADMIN_PASSWORD_HASH=ISI_HASH_PASSWORD
```

### Generate session secret

```bat
npm run generate:secret
```

### Generate hash password

Untuk password default di atas:

```bat
npm run generate:password -- "MatsuriAdmin2026!"
```

Salin hasil hash ke:

```env
ADMIN_PASSWORD_HASH=...
```

> Jangan upload `.env` ke GitHub. File `.env` hanya untuk server/hosting.

## 5. Jalankan website

```bat
npm start
```

Buka:

```text
http://localhost:3000
```

### Jangan gunakan Live Server untuk authentication

Alamat seperti:

```text
http://127.0.0.1:5500
```

adalah Live Server VS Code dan **tidak menjalankan backend authentication**.

---

# 🛠️ PANEL ADMIN

Admin dapat mengelola:

- Team
- Member/Uma dalam team
- Roster
- After Match
- Import JSON HorseACT
- Race Track Name
- Race JSON Editor
- Apply / Format / Download JSON
- Reset ke default race

## Team roster

Setiap team memiliki:

- **Minimum: 3 member/Uma**
- **Maximum: 5 member/Uma**

Artinya:

```text
3/5  ✅ VALID
4/5  ✅ VALID
5/5  ✅ VALID

1/5  ❌ BELUM VALID
2/5  ❌ BELUM VALID
6/5  ❌ TIDAK DIPERBOLEHKAN
```

Member ditambahkan melalui:

```text
TEAM → MEMBERS
```

---

# 🏁 AFTER MATCH / HORSEACT

Public website memiliki bagian:

```text
RESULTS → AFTER MATCH
```

Data race default berasal dari export HorseACT yang digunakan pada project.

Admin dapat mengimpor race baru melalui panel admin menggunakan file `.json` HorseACT.

Importer membaca struktur seperti:

- `raceHorse`
- `raceCourseSet`
- `raceTrack`
- `raceParam`
- `responseHorseData`
- `horseIndexByFinishOrder`
- `playerTeamMemberArray`
- dan field HorseACT terkait lainnya

Setelah di-import, data race disimpan di browser dan dapat digunakan untuk preview After Match.

---

# 🏟️ RACE TRACK NAME

Race Track Name dapat diubah dari **RACE JSON EDITOR**.

Contoh:

```json
"trackName": "TOKYO"
```

bisa diganti menjadi:

```json
"trackName": "NAKAYAMA"
```

Nama tersebut hanya mengubah label yang ditampilkan pada After Match. `raceTrackId` tetap dapat dipertahankan.

---

# 🐴 AFTER MATCH PROFILE

Saat sebuah Uma dipilih, profile menampilkan:

- Posisi finish
- Finish time
- Post number
- Running style
- Raw stats
- Distance aptitude
- Running style aptitude
- Talent level
- Skill list

Format skill menggunakan **nama skill**, bukan hanya ID.

---

# 🎯 SKILL DATABASE

Project menyediakan:

```text
assets/skills.json
```

Untuk nama skill, sistem memprioritaskan database **GameTora Global Umamusume** dan menggunakan `name_en_global` jika tersedia, kemudian `name_en` sebagai fallback.

Sumber GameTora:

```text
https://gametora.com/umamusume
https://gametora.com/umamusume/skills
https://gametora.com/loc/umamusume/skills.json
```

Icon skill di-resolve melalui backend dan diarahkan ke media GameTora.

Skill ID HorseACT yang merupakan inherited/legacy ID juga dapat dicoba resolve ke base skill ID.

Jika skill belum ditemukan, sistem menggunakan fallback agar layout After Match tidak rusak.

---

# 🖼️ GAMETORA ASSETS

Portrait character di-load dari media GameTora berdasarkan data character/card dari HorseACT.

Project tidak membundel seluruh artwork character GameTora agar ukuran project tetap kecil.

GameTora:

```text
https://gametora.com/umamusume
```

Material Uma Musume di GameTora merupakan material berhak cipta Cygames dan GameTora menyatakan tidak berafiliasi dengan developer.

---

# 📁 STRUKTUR PROJECT

```text
matsuri-light/
│
├── index.html
├── admin.html
├── server.js
├── package.json
├── .env.example
├── .gitignore
│
├── assets/
│   ├── hero-character.png
│   ├── race-preview.json
│   └── skills.json
│
├── css/
│   └── style.css
│
├── js/
│   ├── app.js
│   └── admin.js
│
└── scripts/
    ├── generate-secret.js
    └── generate-password-hash.js
```

---

# 🔒 AUTHENTICATION

Authentication menggunakan backend Node.js.

Flow:

```text
Public Website
      ↓
Klik logo ML
      ↓
Login Password
      ↓
POST /api/login
      ↓
Server verifikasi scrypt hash
      ↓
HttpOnly Session Cookie
      ↓
Admin Panel
```

Akses langsung ke `admin.html` tanpa session authentication akan ditolak oleh backend.

Login juga memiliki rate limit sederhana untuk mengurangi percobaan password berulang.

---

# 🌐 DEPLOYMENT

Project ini cocok untuk hosting yang dapat menjalankan **Node.js 18+**.

Pada hosting production, set environment variable:

```text
NODE_ENV=production
PORT=3000
SESSION_SECRET=...
ADMIN_PASSWORD_HASH=...
```

Jangan commit atau upload:

```text
.env
```

Gunakan HTTPS pada production agar cookie authentication dapat menggunakan flag `Secure`.

---

# 🧪 TROUBLESHOOTING

## Muncul:

```text
Missing ADMIN_PASSWORD_HASH or SESSION_SECRET
```

Berarti `.env` belum dibuat atau belum berisi kedua variable tersebut.

Solusi:

```bat
copy .env.example .env
```

lalu generate secret dan password hash.

## Website terbuka di 127.0.0.1:5500 tetapi admin tidak bekerja

Itu berarti website sedang dijalankan menggunakan Live Server.

Gunakan:

```bat
npm start
```

kemudian buka:

```text
http://localhost:3000
```

## Setelah update file, tampilan masih versi lama

Lakukan hard refresh:

```text
Ctrl + Shift + R
```

---

# 📝 CATATAN OWNER

**Admin password:** `MatsuriAdmin2026!`

**Admin access:** klik logo `ML`

**Backend:** `npm start`

**Local URL:** `http://localhost:3000`

**Roster:** 3–5 Uma per team

**Race editor:** Admin Panel → After Match / HorseACT

**Skill database:** GameTora Global

**Character assets:** GameTora media CDN

---

## QUICK START

Kalau cuma mau menjalankan project setelah download:

```bat
npm install
copy .env.example .env
npm run generate:secret
npm run generate:password -- "MatsuriAdmin2026!"
npm start
```

Kemudian buka:

```text
http://localhost:3000
```

**Klik logo ML → password `MatsuriAdmin2026!` → Admin Panel.**

## After Match — Owner Name & Selection Animation
- After Match menampilkan **OWNER // nama trainer/owner** berdasarkan field `trainerName` pada HorseACT JSON, dengan fallback ke `responseHorseData.trainer_name` / `owner_trainer_name`.
- Klik Uma lain pada result list akan menjalankan animasi perpindahan profile agar pergantian data terasa lebih hidup.


## Owner / Trainer identity

HorseACT Practice/Room Match exports can expose the owner's display name through `raceHorse[].trainerName` and, for opponent/ghost records, `responseHorseData.owner_trainer_name`. Matsuri Light prefers the explicit owner field when present and falls back to `trainerName`.

The importer also accepts a real trainer/account ID when a future export contains `owner_trainer_id`, `ownerTrainerId`, `trainer_id`, `trainerId`, or equivalent fields. The UI shows it as **TRAINER ID** only when such a field actually exists. It does **not** mislabel `trainedCharaData.ownerTrainedCharaId` as a trainer/account ID, because that value identifies the trained-character ownership record rather than the trainer account.

In the supplied Practice Room JSON, the owner names are present (for example `KATSU｜A1KO`, `AkeonG`, and `［LGD］YukiO`), while `owner_trainer_id` is not present. Therefore the current file can display the owner name but cannot honestly display a numeric Trainer ID from this export.


## TEAM REGISTRATION — MIDTRANS GOPAY + FONNTE

The public site now includes **REGISTER YOUR TEAM**. A registration creates a Midtrans Snap order with **GoPay enabled**, then the backend waits for Midtrans HTTP notification before marking the registration as `PAID`. This avoids trusting the browser redirect as proof of payment. Midtrans recommends handling payment completion with HTTP notification/webhooks.

### Environment

Copy `.env.example` to `.env` and fill:

- `MIDTRANS_ENV=sandbox` for testing or `production` when live.
- `MIDTRANS_SERVER_KEY` — keep secret; backend only.
- `MIDTRANS_CLIENT_KEY` — public Snap client key.
- `REGISTRATION_FEE_IDR` — the registration fee in rupiah.
- `ADMIN_WHATSAPP_TO` — your WhatsApp destination, e.g. `62812...`.
- `FONNTE_TOKEN` — Fonnte device token; keep it server-side.

Fonnte's send API uses the `Authorization` token header and `/send` endpoint.

### Midtrans dashboard

Set the Midtrans **Payment Notification URL** to:

`https://YOUR-DOMAIN.example/api/midtrans/notification`

Midtrans documents this URL as the endpoint receiving payment status changes. Use HTTPS in production.

### Important

- The browser never receives `MIDTRANS_SERVER_KEY` or `FONNTE_TOKEN`.
- A registration is added to the public Teams list only after the backend receives a verified paid notification.
- The current implementation stores registrations in `data/registrations.json`; back it up with the site data.
- GoPay on Midtrans Snap can present a QRIS flow on desktop and a GoPay deeplink on supported mobile flows.


## Vercel deployment (Registration + Midtrans + GoPay + Fonnte)

The project now includes a Vercel serverless API at `api/[...path].js`. For production on Vercel, registration data and admin sessions use PostgreSQL/Neon instead of `data/registrations.json`, because Vercel function filesystems are not durable storage.

### 1. Connect Neon
In the Vercel project, add the **Neon** integration from the Marketplace/Storage area and provision a database. Vercel/Neon supplies a `DATABASE_URL` environment variable.

### 2. Add Vercel Environment Variables
Add these variables under **Project → Settings → Environment Variables** and redeploy after saving:

- `MIDTRANS_ENV=sandbox`
- `MIDTRANS_SERVER_KEY=...` (Secret)
- `MIDTRANS_CLIENT_KEY=...` (Config)
- `REGISTRATION_FEE_IDR=50000`
- `ADMIN_WHATSAPP_TO=628...` (Config)
- `FONNTE_TOKEN=...` (Secret)
- `ADMIN_PASSWORD_HASH=...` (Secret)
- `SESSION_SECRET=...` (Secret)
- `DATABASE_URL=...` (Secret, if Vercel/Neon did not create it automatically)

Never commit `.env` or paste Midtrans Server Key/Fonnte Token into frontend files.

### 3. Midtrans notification URL
After deployment, set the Midtrans HTTP Notification URL to:

`https://YOUR-DOMAIN.vercel.app/api/midtrans/notification`

The backend verifies the Midtrans signature and amount before changing a registration to `PAID`.

### 4. Test
Open `https://YOUR-DOMAIN.vercel.app/registration.html`, submit a 3–5 Uma roster, and use the Midtrans Sandbox GoPay flow. Once the webhook is received, the paid team appears in the public Teams section and Fonnte sends the payment-confirmed notification.
