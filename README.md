# Sela

Sela adalah prototipe aplikasi web untuk menangkap ide cepat dan mengembangkannya saat pengguna siap.

## Mulai

Buka `index.html` di browser modern. Tidak perlu akun, server, atau instalasi paket.

Saat pertama dibuka, Sela menampilkan splash screen dan panduan menambahkan aplikasi ke layar utama. Panduan otomatis dapat dilewati dan hanya ditampilkan sekali per browser; tombol "Pasang Sela" dapat membukanya lagi kapan saja.
Untuk melihat ulang splash dan panduan saat pengembangan, buka `index.html?intro=1`.

## PWA dan deployment

Sela menyertakan `manifest.webmanifest`, ikon aplikasi, dan service worker untuk cache shell aplikasi. Fitur install dan service worker memerlukan origin HTTPS (atau localhost); membuka `index.html` langsung dari file explorer hanya menjalankan prototipe browser dan tidak dapat memasang PWA. Panduan pemasangan akan menjelaskan batas ini.

Untuk produksi, deploy folder ini ke hosting HTTPS statis seperti GitHub Pages, Netlify, atau Vercel. Service worker menyimpan shell aplikasi untuk membantu pembukaan ulang secara offline; Google Fonts memerlukan koneksi saat pertama kali dimuat.

Halaman `perbandingan.html` membandingkan posisi kartu input sebelum dan sesudah digeser.

## Alur produk

1. Tulis judul ide; konteks singkat dan kategori bersifat opsional.
2. Tanpa masuk akun, ide masuk ke daftar "Baru masuk" dan tersimpan di browser ini.
3. Buka kembali ide kapan saja untuk mengisi masalah/kebutuhan, siapa yang terbantu, dan langkah kecil berikutnya.
4. Pilih tahap ide: baru masuk, lagi dipikirkan, atau selesai dikembangkan.

Daftar awal memuat contoh ide agar alurnya mudah dicoba. Contoh dapat diedit atau dihapus.

## Privasi

Mode lokal menyimpan ide di browser pada perangkat dan profil yang sama. Setelah masuk akun, Sela membaca dan menyimpan ide akun melalui Supabase; ide lokal tetap dipisahkan sampai pengguna secara eksplisit menekan **Gabungkan ide lokal ke akun**. Penggabungan hanya menambahkan ide yang belum ada dan tidak menimpa ide akun. Keluar akun akan kembali menampilkan data lokal.

Sesi akun disimpan di `localStorage`, sehingga jangan masuk di perangkat bersama. Frontend hanya memakai URL Supabase dan anon/publishable key; jangan pernah menaruh `service_role` key di aplikasi browser.

## Mengaktifkan akun dan sinkronisasi

1. Buat proyek di [Supabase](https://supabase.com/), lalu buka **SQL Editor** pada proyek tersebut.
2. Jalankan isi file `supabase-schema.sql`. Tabel `ideas` dan Row Level Security membatasi setiap operasi ke ide milik user yang sedang masuk.
3. Buka **Project Settings → API Keys** (atau dialog **Connect**). Salin Project URL dan publishable key. Legacy anon key juga didukung.
4. Isi nilai `url` dan `publishableKey` pada `supabase-config.js`. File ini memang berisi nilai publik yang digunakan browser; jangan masukkan secret/service-role key.
5. Di pengaturan **Authentication → URL Configuration**, tambahkan URL GitHub Pages Sela sebagai Site URL dan Redirect URL, misalnya `https://sukmaaji11.github.io/ide-sejenak/`.
6. Untuk verifikasi email, pastikan template/layanan email Supabase siap. Pengguna perlu mengonfirmasi email sebelum masuk jika konfirmasi email diaktifkan.
7. Deploy perubahan ke hosting HTTPS, lalu coba buat akun, masuk, simpan ide, dan buka Sela pada perangkat/browser lain.

Tautan **Lupa password?** mengirim email pemulihan dan membuka formulir untuk menetapkan password baru di Sela.
Tanpa konfigurasi Supabase, tombol akun tetap menjelaskan bahwa sinkronisasi belum aktif dan mode lokal tetap dapat digunakan. Jangan membagikan password akun atau secret key. Setelah mengubah file konfigurasi atau skema, deploy ulang situs dan pastikan `supabase-config.js` dapat dimuat.
