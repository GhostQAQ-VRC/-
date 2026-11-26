package com.hoshikuzu.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.annotation.RequiresApi;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Isolated so MediaStore.Downloads (API 29) is only resolved when the app is
 * actually running on Android 10+; older devices use NativeDownloader's legacy
 * public Downloads path.
 */
@RequiresApi(Build.VERSION_CODES.Q)
final class MediaStoreSaver {
    private MediaStoreSaver() {
    }

    static String save(Context context, String name, String mime, InputStream input)
            throws IOException {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE,
                mime == null || mime.isEmpty() ? "image/jpeg" : mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOWNLOADS + File.separator + "Hoshikuzu");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (item == null) throw new IOException("无法创建下载文件");
        try (OutputStream output = resolver.openOutputStream(item)) {
            if (output == null) throw new IOException("无法写入下载文件");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.flush();
        } catch (IOException error) {
            resolver.delete(item, null, null);
            throw error;
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(item, values, null, null);
        return "下载/Hoshikuzu/" + name;
    }
}
