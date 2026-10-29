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
2. Ide masuk ke daftar "Baru masuk" dan tersimpan di browser.
3. Buka kembali ide kapan saja untuk mengisi masalah/kebutuhan, siapa yang terbantu, dan langkah kecil berikutnya.
4. Pilih tahap ide: baru masuk, lagi dipikirkan, atau selesai dikembangkan.

Daftar awal memuat contoh ide agar alurnya mudah dicoba. Contoh dapat diedit atau dihapus.

## Privasi

Semua ide tersimpan di penyimpanan lokal browser pada perangkat dan profil yang sama. Data tidak disinkronkan atau dikirim ke server. Menghapus data situs/browser dapat menghapus ide.
