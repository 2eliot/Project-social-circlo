package cloud.socialcircleinfo.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private boolean micPermissionRequested = false;
    private boolean notifPermissionRequested = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
    }

    @Override
    public void onResume() {
        super.onResume();

        // Pedir RECORD_AUDIO al reanudar (no en onCreate, que es muy temprano).
        // Capacitor 8.x ya maneja onPermissionRequest en BridgeWebChromeClient,
        // pero el permiso de Android debe estar concedido a nivel SO para que
        // el WebView pueda otorgar RESOURCE_AUDIO_CAPTURE transparentemente.
        if (!micPermissionRequested
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
            micPermissionRequested = true;
            ActivityCompat.requestPermissions(
                this,
                new String[] { Manifest.permission.RECORD_AUDIO },
                1002
            );
        } else if (micPermissionRequested && !notifPermissionRequested) {
            // Micrófono ya resuelto (o ya concedido), pedir notificaciones
            requestNotificationPermission();
        }
    }

    /**
     * Pide POST_NOTIFICATIONS en Android 13+.  Al pedirlo desde Java antes que
     * Capacitor, el plugin de push ve el permiso ya concedido y no muestra un
     * segundo diálogo.  Así el usuario ve: 1) micrófono, 2) notificaciones.
     */
    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            notifPermissionRequested = true;
            ActivityCompat.requestPermissions(
                this,
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                1003
            );
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == 1002) {
            // Micrófono resuelto → pedir notificaciones a continuación
            requestNotificationPermission();
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            CharSequence name = "General";
            String description = "Notificaciones de mensajes, grupos y actividad";
            int importance = NotificationManager.IMPORTANCE_HIGH;
            NotificationChannel channel = new NotificationChannel("default", name, importance);
            channel.setDescription(description);
            channel.setShowBadge(true);

            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onBackPressed() {
        // Usar bridge.getWebView() directamente — Capacitor lo expone
        WebView wv = (WebView) bridge.getWebView();
        if (wv != null && wv.canGoBack()) {
            wv.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
