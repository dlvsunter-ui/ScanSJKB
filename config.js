// ======== KONFIGURASI FRONTEND ========
// Ganti nilai di bawah ini dengan URL Web App Apps Script Anda
// Contoh: const BACKEND_BASE = "https://script.google.com/macros/s/AKfycbx1234/exec";
const BACKEND_BASE = "https://script.google.com/macros/s/AKfycbyah2NEvBdsadpBpHI7-JGoeoe6cHtgkPKPF-aPxavaHHBuHjuTeEvDMTLoJeTMAz4x/exec"; // <-- ISI dgn URL Web App

// PIN admin
const ADMIN_PIN = "1235";

// Jarak toleransi (meter) utk geofencing proses Berangkat/Sampai
const RADIUS_METERS = 600;

// ====== ABSEN CONFIG ======
const NVDC_NAME = "NVDC SUNTER"; // nama lokasi di master
const ABSEN_ENTER_RADIUS = 500;   // tombol enable saat <= 500m
const ABSEN_EXIT_RADIUS  = 650;   // reset lock saat >= 650m (hysteresis)
