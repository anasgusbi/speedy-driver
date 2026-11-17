// إعدادات الربط مع مشروع Firebase المستقل speedy-driver (نفس مشروع منصة التتبع)
export const CONFIG = {
  apiKey: "AIzaSyAlQw2kZP9RJfMcnfKEL0ixJYDEkB1M60k",
  projectId: "speedy-driver-b622a",
  // رابط Realtime Database — انسخه من Firebase Console ← Realtime Database (أعلى صفحة Data)
  databaseURL: "https://speedy-driver-b622a-default-rtdb.europe-west1.firebasedatabase.app",
  // نطاق وهمي لحسابات المندوبين (رقم الدخول + هذا النطاق = البريد في Firebase)
  driverDomain: "drivers.speedy.com.ly",
  // كل كم ثانية يُرسل الموقع
  sendEverySec: 60,
  // يتوقف التتبع تلقائياً إن نسي المندوب إنهاء الفترة بعد هذا العدد من الساعات بعد نهاية فترته
  autoStopHoursAfterShift: 2
};
