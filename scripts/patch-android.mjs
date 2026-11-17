// يُعدّل مشروع أندرويد بعد إنشائه: أيقونة الإشعار، اسم قناة الإشعار، ورقم الإصدار
import fs from 'node:fs';
const res = 'android/app/src/main/res';

// 1) Notification icon (white vector, required for a non-dismissable tracking notification)
fs.mkdirSync(`${res}/drawable`, { recursive: true });
fs.writeFileSync(`${res}/drawable/ic_tracking.xml`, `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF"
      android:pathData="M12,2C8.13,2 5,5.13 5,9c0,5.25 7,13 7,13s7,-7.75 7,-13c0,-3.87 -3.13,-7 -7,-7zM12,11.5c-1.38,0 -2.5,-1.12 -2.5,-2.5s1.12,-2.5 2.5,-2.5 2.5,1.12 2.5,2.5 -1.12,2.5 -2.5,2.5z"/>
</vector>
`);

// 2) Plugin strings
const sx = `${res}/values/strings.xml`;
let s = fs.readFileSync(sx, 'utf8');
const add = `    <string name="capacitor_background_geolocation_notification_channel_name">تتبع الفترة</string>
    <string name="capacitor_background_geolocation_notification_icon">drawable/ic_tracking</string>
    <string name="capacitor_background_geolocation_notification_color">#00A86B</string>
`;
if (!s.includes('capacitor_background_geolocation_notification_icon')) s = s.replace('</resources>', add + '</resources>');
fs.writeFileSync(sx, s);

// 3) Version code from the build number so every new APK installs over the previous one
const g = 'android/app/build.gradle';
let gr = fs.readFileSync(g, 'utf8');
const run = parseInt(process.env.GITHUB_RUN_NUMBER || '1', 10);
gr = gr.replace(/versionCode\s+\d+/, `versionCode ${run}`).replace(/versionName\s+"[^"]*"/, `versionName "1.0.${run}"`);
fs.writeFileSync(g, gr);

console.log('android patched: versionCode', run);
