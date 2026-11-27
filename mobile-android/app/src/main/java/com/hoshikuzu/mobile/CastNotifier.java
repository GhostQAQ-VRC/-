package com.hoshikuzu.mobile;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * Local notification for a desktop cast. The in-app overlay remains the primary
 * UI when the page is visible; this only fires while the phone is backgrounded
 * or the screen is off.
 */
final class CastNotifier {
    private static final String CHANNEL_ID = "hoshikuzu_cast";
    private static final String CHANNEL_NAME = "电脑投送";

    private CastNotifier() {
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("电脑把照片投送到手机时提醒");
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    static boolean canNotify(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    static void show(Activity activity, String photoId, String title, String body) {
        if (activity == null || activity.isFinishing()) return;
        if (!canNotify(activity)) return;
        ensureChannel(activity);

        Intent intent = new Intent(activity, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                activity,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String safeTitle = title == null || title.isEmpty() ? "收到一张投送" : title;
        String safeBody = body == null ? "" : body;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(activity, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_camera)
                .setContentTitle(safeTitle)
                .setContentText(safeBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(safeBody))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pending);
        int id = photoId == null ? 1 : Math.abs(photoId.hashCode());
        try {
            NotificationManagerCompat.from(activity).notify(id, builder.build());
        } catch (SecurityException ignored) {
            // Permission was revoked between the check and notify().
        }
    }
}
