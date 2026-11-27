package com.hoshikuzu.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.File;

/**
 * Home-screen "on this day" card. The WebView cannot expose its localStorage to
 * a launcher process, so the local album pushes one preview + caption through
 * the bridge; the widget decodes that app-private preview on demand.
 */
public class OnThisDayWidget extends AppWidgetProvider {
    private static final String PREFS = "hoshikuzu_mobile_widget";
    private static final String KEY_JSON = "on_this_day";
    private static final String PREVIEW_PATTERN =
            "^[0-9a-f]{40}(?:_\\d{3,4}_q\\d{2,3})?\\.webp$";

    static void save(Context context, String json) {
        SharedPreferences preferences = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        preferences.edit().putString(KEY_JSON, json == null ? "" : json).apply();
        updateAll(context);
    }

    static void updateAll(Context context) {
        Context app = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(app);
        ComponentName provider = new ComponentName(app, OnThisDayWidget.class);
        int[] ids = manager.getAppWidgetIds(provider);
        for (int id : ids) {
            manager.updateAppWidget(id, buildViews(app));
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(),
                R.layout.widget_on_this_day);
        JSONObject data = readData(context);
        String previewPath = data == null ? "" : data.optString("previewPath", "");
        String title = data == null ? "" : data.optString("title", "");
        String subtitle = data == null ? "" : data.optString("subtitle", "");

        Bitmap bitmap = decodePreview(context, previewPath);
        if (bitmap != null) {
            views.setImageViewBitmap(R.id.widget_image, bitmap);
        } else {
            views.setImageViewResource(R.id.widget_image, R.mipmap.ic_launcher);
        }
        views.setTextViewText(R.id.widget_title,
                title == null || title.isEmpty()
                        ? context.getString(R.string.widget_empty_title)
                        : title);
        views.setTextViewText(R.id.widget_subtitle,
                subtitle == null || subtitle.isEmpty()
                        ? context.getString(R.string.widget_empty_subtitle)
                        : subtitle);

        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);
        return views;
    }

    private static JSONObject readData(Context context) {
        try {
            String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(KEY_JSON, "");
            if (raw == null || raw.isEmpty()) return null;
            return new JSONObject(raw);
        } catch (Exception error) {
            return null;
        }
    }

    private static Bitmap decodePreview(Context context, String previewPath) {
        if (previewPath == null || !previewPath.matches(PREVIEW_PATTERN)) return null;
        File directory = new File(context.getFilesDir(), "mobile-library/previews");
        File file = new File(directory, previewPath);
        try {
            String base = directory.getCanonicalPath() + File.separator;
            if (!file.getCanonicalPath().startsWith(base)) return null;
        } catch (Exception error) {
            return null;
        }
        if (!file.isFile()) return null;

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (bounds.outWidth / sample > 1200 || bounds.outHeight / sample > 1200) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        try {
            return BitmapFactory.decodeFile(file.getAbsolutePath(), options);
        } catch (Exception error) {
            return null;
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        super.onUpdate(context, manager, appWidgetIds);
        updateAll(context);
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        updateAll(context);
    }
}
