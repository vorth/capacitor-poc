package org.vorthmann.checkrspot;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.exifinterface.media.ExifInterface;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import java.io.IOException;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lets the user choose photos with the system document picker, and reports
 * each one's capture time, GPS position and QR codes. Android's photo picker
 * isn't used because it always removes the location from photos; the
 * document picker keeps it when the app holds ACCESS_MEDIA_LOCATION.
 */
@CapacitorPlugin(
    name = "PhotoImport",
    permissions = @Permission(alias = "mediaLocation", strings = { Manifest.permission.ACCESS_MEDIA_LOCATION })
)
public class PhotoImportPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pickPhotos(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && getPermissionState("mediaLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("mediaLocation", call, "onMediaLocationPermission");
        } else {
            openPicker(call);
        }
    }

    /** Pick photos either way; without the permission they just have no location. */
    @PermissionCallback
    private void onMediaLocationPermission(PluginCall call) {
        openPicker(call);
    }

    private void openPicker(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "onPhotosPicked");
    }

    @ActivityCallback
    private void onPhotosPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        List<Uri> uris = new ArrayList<>();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        // One photo at a time, off the main thread; cancelling picks none.
        executor.execute(() -> {
            JSArray photos = new JSArray();
            for (Uri uri : uris) {
                JSObject progress = new JSObject();
                progress.put("done", photos.length());
                progress.put("total", uris.size());
                notifyListeners("importProgress", progress);
                photos.put(read(uri));
            }
            JSObject ret = new JSObject();
            ret.put("photos", photos);
            call.resolve(ret);
        });
    }

    private JSObject read(Uri picked) {
        JSObject photo = new JSObject();
        photo.put("codes", new JSArray());
        String name = displayName(picked);
        if (name != null) photo.put("name", name);
        Uri uri = originalUri(picked);
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) throw new IOException("Couldn't open the photo");
            ExifInterface exif = new ExifInterface(in);
            putIfPresent(photo, "dateTimeOriginal", exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL));
            putIfPresent(photo, "offsetTimeOriginal", exif.getAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL));
            Long gpsTime = gpsTime(
                exif.getAttribute(ExifInterface.TAG_GPS_DATESTAMP),
                exif.getAttribute(ExifInterface.TAG_GPS_TIMESTAMP)
            );
            if (gpsTime != null) photo.put("gpsTimestamp", gpsTime);
            double[] latLong = exif.getLatLong();
            if (latLong != null) {
                photo.put("latitude", latLong[0]);
                photo.put("longitude", latLong[1]);
            }
            if (exif.hasAttribute(ExifInterface.TAG_GPS_ALTITUDE)) {
                photo.put("altitude", exif.getAltitude(0));
            }
            if (exif.hasAttribute(ExifInterface.TAG_GPS_H_POSITIONING_ERROR)) {
                photo.put("accuracy", exif.getAttributeDouble(ExifInterface.TAG_GPS_H_POSITIONING_ERROR, 0));
            }
        } catch (Exception e) {
            photo.put("error", e.getMessage());
            return photo;
        }
        try {
            photo.put("codes", qrCodes(uri));
        } catch (Exception e) {
            photo.put("error", e.getMessage());
        }
        return photo;
    }

    /**
     * The media store's unredacted version of a picked photo, when there is
     * one and we may read it; otherwise the picked URI, whose location
     * Android may have removed.
     */
    private Uri originalUri(Uri picked) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || getPermissionState("mediaLocation") != PermissionState.GRANTED) {
            return picked;
        }
        try {
            Uri media = MediaStore.getMediaUri(getContext(), picked);
            if (media == null) return picked;
            Uri original = MediaStore.setRequireOriginal(media);
            try (InputStream probe = getContext().getContentResolver().openInputStream(original)) {
                return probe != null ? original : picked;
            }
        } catch (Exception e) {
            return picked;
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception e) {
            // Messages fall back to a generic name.
        }
        return null;
    }

    /** EXIF GPS date ("yyyy:MM:dd") and time ("HH:mm:ss"), which are UTC, as epoch milliseconds. */
    private static Long gpsTime(String date, String time) {
        if (date == null || time == null) return null;
        SimpleDateFormat format = new SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        try {
            Date d = format.parse(date + " " + time);
            return d != null ? d.getTime() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** The distinct QR code payloads found anywhere in the image. */
    private JSArray qrCodes(Uri uri) throws Exception {
        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build();
        BarcodeScanner scanner = BarcodeScanning.getClient(options);
        try {
            InputImage image = InputImage.fromFilePath(getContext(), uri);
            List<Barcode> barcodes = Tasks.await(scanner.process(image));
            List<String> codes = new ArrayList<>();
            for (Barcode b : barcodes) {
                String s = b.getRawValue();
                if (s != null && !codes.contains(s)) codes.add(s);
            }
            return new JSArray(codes);
        } finally {
            scanner.close();
        }
    }

    private static void putIfPresent(JSObject obj, String key, String value) {
        if (value != null) obj.put(key, value);
    }
}
